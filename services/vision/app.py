"""FastAPI application for MobileSAM vision service."""
from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from model import (
    automatic_segment_image,
    delete_session,
    is_model_loaded,
    load_model,
    MODEL_NAME,
    prepare_session,
    segment_session,
)
from frame import (
    ALGORITHM_VERSION,
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    FrameValidationError,
    TEMPLATE_VERSION,
    analyze_rectification,
    confirmed_rectification,
    detection_payload,
    decode_image,
    inspect_frame,
    rectify_detected_frame,
    rectify_frame,
)
from schemas import (
    DeleteSessionResponse,
    HealthResponse,
    PrepareResponse,
    SegmentRequest,
    SegmentResponse,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

CHECKPOINT_PATH = os.environ.get(
    "MOBILESAM_CHECKPOINT",
    os.path.join(os.path.dirname(__file__), "checkpoints", "mobile_sam.pt"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    load_model(CHECKPOINT_PATH)
    yield


app = FastAPI(title="Vision Service", lifespan=lifespan)

# Only allow same-origin (Next.js server-side proxy calls from 127.0.0.1)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Internal server error."})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=is_model_loaded(),
        backend="cpu",
        model=MODEL_NAME,
    )


@app.post("/prepare", response_model=PrepareResponse)
async def prepare(
    image: UploadFile = File(...),
) -> PrepareResponse:
    content_type = (image.content_type or "").split(";")[0].strip().lower()
    accepted = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
    if content_type not in accepted:
        raise HTTPException(status_code=415, detail=f"Unsupported media type: {content_type}")

    raw = await image.read()

    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 20 MB limit.")

    # Validate that the bytes look like a real image (magic-byte check)
    _validate_image_magic(raw, content_type)

    try:
        session_id, width, height, prepare_ms = prepare_session(raw, content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return PrepareResponse(
        sessionId=session_id,
        width=width,
        height=height,
        prepareMs=prepare_ms,
    )


@app.post("/segment", response_model=SegmentResponse)
async def segment(body: SegmentRequest) -> SegmentResponse:
    try:
        candidates, recommended_index, segment_ms = segment_session(
            body.sessionId,
            [p.model_dump() for p in body.points],
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return SegmentResponse(
        sessionId=body.sessionId,
        recommendedIndex=recommended_index,
        candidates=candidates,  # type: ignore[arg-type]
        segmentMs=segment_ms,
    )


@app.delete("/sessions/{session_id}", response_model=DeleteSessionResponse)
async def delete_session_route(session_id: str) -> DeleteSessionResponse:
    if len(session_id) < 8 or len(session_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid session ID.")
    delete_session(session_id)
    return DeleteSessionResponse(status="deleted", sessionId=session_id)


@app.post("/template/validate")
async def validate_template(image: UploadFile = File(...)) -> dict:
    raw = await image.read()
    try:
        rgb, _ = decode_image(raw, image.content_type or "")
        rectification = rectify_frame(rgb)
    except FrameValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    return {
        "valid": True,
        "templateVersion": "LICHENDR-FRAME-0.2",
        "reprojectionErrorPx": round(rectification.reprojection_error_px, 4),
        "qualityFlags": rectification.quality_flags,
        "frameDetection": rectification.frame_detection,
    }


@app.post("/rectify")
async def rectify(image: UploadFile = File(...)) -> dict:
    raw = await image.read()
    try:
        rgb, _ = decode_image(raw, image.content_type or "")
        result = rectify_frame(rgb)
    except FrameValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    from frame import _encode_image
    return {
        "templateVersion": "LICHENDR-FRAME-0.2",
        "width": 400,
        "height": 2000,
        "reprojectionErrorPx": round(result.reprojection_error_px, 4),
        "qualityFlags": result.quality_flags,
        "rectifiedImageDataUrl": _encode_image(result.canonical_rgb, "JPEG"),
        "frameDetection": result.frame_detection,
    }


@app.post("/analyze-view")
async def analyze_view_route(
    image: UploadFile = File(...),
    action: str = Form("detect"),
    corners: str | None = Form(None),
    manual_mode: str = Form("manual_confirmed"),
) -> dict:
    raw = await image.read()
    try:
        rgb, metadata = decode_image(raw, image.content_type or "")
        detection = inspect_frame(rgb)
        if action == "detect":
            if not detection.missing_ids and detection.rejection_reason is None:
                rectification = rectify_detected_frame(rgb, detection)
                masks = automatic_segment_image(rectification.canonical_rgb)
                return analyze_rectification(rectification, metadata, masks)
            if detection.proposal is None:
                normalized = None
            else:
                normalized = detection.proposal.corners / [rgb.shape[1] - 1, rgb.shape[0] - 1]
            return {
                "template_version": TEMPLATE_VERSION,
                "algorithm_version": ALGORITHM_VERSION,
                "canonical_width": CANONICAL_WIDTH,
                "canonical_height": CANONICAL_HEIGHT,
                "pixels_per_cm": 40,
                "reprojection_error_px": (
                    round(detection.reprojection_error_px, 4)
                    if detection.reprojection_error_px is not None else None
                ),
                "quality_flags": (
                    ["frame_confirmation_required", "manual_selection_required"]
                    if normalized is None else ["frame_confirmation_required"]
                ),
                "quality_score": round(detection.confidence, 3),
                "critical_errors": [],
                "status": "needs_confirmation",
                "rectified_image_data_url": None,
                "preserved_metadata": metadata,
                "model_name": MODEL_NAME,
                "source": detection.method,
                "metrics": None,
                "frame_detection": detection_payload(detection, rgb.shape[1], rgb.shape[0]),
                "corner_proposal": (
                    [
                        {"x": round(float(point[0]), 7), "y": round(float(point[1]), 7)}
                        for point in normalized
                    ]
                    if normalized is not None else None
                ),
                "source_width": rgb.shape[1],
                "source_height": rgb.shape[0],
            }
        if action not in {"confirm_corners", "analyze_confirmed"}:
            raise FrameValidationError("invalid_action", "La acción solicitada no es válida.")
        submitted_corners = _parse_corners(corners)
        rectification = confirmed_rectification(rgb, submitted_corners, detection, manual_mode)
        if action == "confirm_corners":
            from frame import _encode_image
            critical = sorted(set(rectification.quality_flags) & {
                "blur",
                "overexposure",
                "underexposure",
                "insufficient_resolution",
                "high_reprojection_error",
            })
            return {
                "template_version": TEMPLATE_VERSION,
                "algorithm_version": ALGORITHM_VERSION,
                "canonical_width": CANONICAL_WIDTH,
                "canonical_height": CANONICAL_HEIGHT,
                "pixels_per_cm": 40,
                "reprojection_error_px": (
                    round(rectification.reprojection_error_px, 4)
                    if rectification.reprojection_error_px is not None else None
                ),
                "quality_flags": sorted(set(rectification.quality_flags)),
                "quality_score": round(rectification.quality_score, 3),
                "critical_errors": critical,
                "status": "rectification_review",
                "rectified_image_data_url": _encode_image(rectification.canonical_rgb, "JPEG"),
                "preserved_metadata": metadata,
                "model_name": MODEL_NAME,
                "source": f"mobile_sam_cielab:{rectification.frame_detection['classification']}",
                "metrics": None,
                "frame_detection": rectification.frame_detection,
                "corner_proposal": submitted_corners,
                "source_width": rgb.shape[1],
                "source_height": rgb.shape[0],
            }
        if any(flag in {
            "blur",
            "overexposure",
            "underexposure",
            "insufficient_resolution",
            "high_reprojection_error",
        } for flag in rectification.quality_flags):
            result = analyze_rectification(rectification, metadata, [])
            result["corner_proposal"] = submitted_corners
            return result
        masks = automatic_segment_image(rectification.canonical_rgb)
        result = analyze_rectification(rectification, metadata, masks)
        result["corner_proposal"] = submitted_corners
        return result
    except FrameValidationError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="El modelo de visión no está disponible.") from exc


@app.get("/processing/status")
async def processing_status() -> dict:
    return {
        "status": "ready" if is_model_loaded() else "model_unavailable",
        "sequentialInference": True,
        "model": MODEL_NAME,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MAGIC: dict[str, list[bytes]] = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG"],
    "image/webp": [b"RIFF"],
    "image/heic": [b"ftyp"],
    "image/heif": [b"ftyp"],
}


def _validate_image_magic(raw: bytes, mime: str) -> None:
    signatures = _MAGIC.get(mime, [])
    if mime in {"image/heic", "image/heif"}:
        if len(raw) < 12 or raw[4:8] != b"ftyp":
            raise HTTPException(status_code=422, detail="Image content does not match declared MIME type.")
        return
    if not any(raw.startswith(sig) for sig in signatures):
        raise HTTPException(status_code=422, detail="Image content does not match declared MIME type.")


def _parse_corners(raw: str | None) -> list[dict[str, float]]:
    if raw is None or len(raw) > 2048:
        raise FrameValidationError("invalid_corners", "Faltan las cuatro esquinas confirmadas.")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise FrameValidationError("invalid_corners", "Las esquinas confirmadas no contienen JSON válido.") from exc
    if not isinstance(value, list) or len(value) != 4:
        raise FrameValidationError("invalid_corners", "Debes confirmar exactamente cuatro esquinas.")
    result: list[dict[str, float]] = []
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("x"), (int, float)) or not isinstance(item.get("y"), (int, float)):
            raise FrameValidationError("invalid_corners", "Las coordenadas de las esquinas no son válidas.")
        result.append({"x": float(item["x"]), "y": float(item["y"])})
    return result
