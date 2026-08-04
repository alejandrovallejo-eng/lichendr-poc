"""FastAPI application for MobileSAM vision service."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from model import (
    delete_session,
    is_model_loaded,
    load_model,
    MODEL_NAME,
    prepare_session,
    segment_session,
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MAGIC: dict[str, list[bytes]] = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG"],
    "image/webp": [b"RIFF"],
    "image/heic": [],  # no reliable magic byte; trust content-type
    "image/heif": [],
}


def _validate_image_magic(raw: bytes, mime: str) -> None:
    signatures = _MAGIC.get(mime, [])
    if not signatures:
        return
    if not any(raw.startswith(sig) for sig in signatures):
        raise HTTPException(status_code=422, detail="Image content does not match declared MIME type.")
