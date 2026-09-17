"""Local BioCLIP 2 suggestion worker.

Isolated on purpose:

* it is a separate service from `services/vision` (the 512 MB ONNX MobileSAM
  container), which keeps running without PyTorch or BioCLIP;
* it is disabled unless `BIOCLIP_WORKER_ENABLED=1`;
* it binds to 127.0.0.1 by default and is meant to run on the reviewer's Mac.
  No tunnel is opened and the worker is not published anywhere;
* the model is loaded once, one inference runs at a time, the waiting queue is
  bounded, and every request has a timeout plus byte/pixel/region limits.

Hosting for a shared deployment is an open decision documented in
`services/bioclip/README.md`; nothing here contracts or deploys anything.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import os
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

from constants import (
    ENCODER_ID,
    MAX_CROP_BYTES,
    MAX_CROP_PIXELS,
    MAX_QUEUE_DEPTH,
    MAX_REGIONS_PER_REQUEST,
    MAX_REQUEST_BYTES,
    MAX_TOTAL_CROP_BYTES,
    MAX_TOTAL_CROP_PIXELS,
    REQUEST_TIMEOUT_SECONDS,
)
from encoder import PREPROCESS_MODES, EncoderUnavailable, load_encoder
from head import HeadValidationError, load_trained_head
from suggest import suggest
from experimental import load_experimental

Image.MAX_IMAGE_PIXELS = MAX_CROP_PIXELS

ENABLED = os.environ.get("BIOCLIP_WORKER_ENABLED") == "1"
MODEL_DIR = os.environ.get("BIOCLIP_MODEL_DIR", "")
HEAD_PATH = os.environ.get("BIOCLIP_HEAD_PATH", "")
HEAD_SHA256 = os.environ.get("BIOCLIP_HEAD_SHA256", "")
WORKER_TOKEN = os.environ.get("BIOCLIP_WORKER_TOKEN", "")
EXPERIMENTAL_DIR = os.environ.get("BIOCLIP_EXPERIMENTAL_DIR", "")

_inference_gate = asyncio.Semaphore(1)
_queue_depth = 0
_state: dict = {"encoder": None, "head": None, "head_error": None, "encoder_error": None}


class RegionInput(BaseModel):
    regionId: str = Field(min_length=1, max_length=128)
    cropPngBase64: str = Field(min_length=1)


class SuggestRequest(BaseModel):
    regions: list[RegionInput] = Field(min_length=1, max_length=MAX_REGIONS_PER_REQUEST)
    preprocess: str = "whole_crop_pad"
    experimental: bool = Field(default=False, strict=True)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    if ENABLED:
        # Load once, at start-up, never per request and never during a build.
        try:
            _state["encoder"] = load_encoder(MODEL_DIR or "~/.lichendr/bioclip-2")
        except EncoderUnavailable as error:
            _state["encoder_error"] = str(error)
        if HEAD_PATH:
            try:
                _state["head"] = load_trained_head(
                    HEAD_PATH,
                    expected_sha256=HEAD_SHA256 or None,
                )
            except HeadValidationError as error:
                # An invalid head must never silently downgrade to zero-shot
                # without saying so: the reason is reported by /health.
                _state["head_error"] = str(error)
        if EXPERIMENTAL_DIR:
            try:
                _state["experimental"] = load_experimental(EXPERIMENTAL_DIR)
            except HeadValidationError:
                _state["experimental"] = None
    yield


app = FastAPI(title="LichenDR BioCLIP worker", lifespan=lifespan)


class BodySizeLimitMiddleware:
    """Reject oversized bodies by the bytes actually received.

    `Content-Length` is only a declaration and it is absent from a chunked
    request, so checking that header alone does not bound anything. The real
    body is counted as it streams and the request is rejected as soon as the
    limit is passed, before anything is decoded.

    The overflow cannot be signalled by raising: FastAPI wraps body reading in a
    broad `except Exception` and would turn it into a generic 400. So the
    receive channel is closed and the response is replaced with an explicit 413.
    """

    def __init__(self, app, max_bytes: int = MAX_REQUEST_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:  # noqa: ANN001
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.decode("latin-1").lower(): value for key, value in scope.get("headers", [])}
        declared = headers.get("content-length")
        if declared is not None:
            try:
                if int(declared.decode("latin-1")) > self.max_bytes:
                    await self._reject(send, 413, "request_too_large")
                    return
            except ValueError:
                await self._reject(send, 400, "invalid_content_length")
                return

        state = {"received": 0, "exceeded": False, "replaced": False}

        async def counting_receive():
            message = await receive()
            if message.get("type") == "http.request":
                state["received"] += len(message.get("body", b""))
                if state["received"] > self.max_bytes:
                    state["exceeded"] = True
                    return {"type": "http.disconnect"}
            return message

        async def limiting_send(message):  # noqa: ANN001
            if not state["exceeded"]:
                await send(message)
                return
            if state["replaced"]:
                return
            if message.get("type") == "http.response.start":
                state["replaced"] = True
                await self._reject(send, 413, "request_too_large")

        await self.app(scope, counting_receive, limiting_send)

    @staticmethod
    async def _reject(send, status: int, detail: str) -> None:  # noqa: ANN001
        response = JSONResponse({"detail": detail}, status_code=status)
        await response({"type": "http"}, _empty_receive, send)  # type: ignore[misc]


async def _empty_receive():
    return {"type": "http.request", "body": b"", "more_body": False}


app.add_middleware(BodySizeLimitMiddleware)


def _require_token(authorization: str | None) -> None:
    if not WORKER_TOKEN:
        return
    expected = "Bearer " + WORKER_TOKEN
    if authorization is None or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict:
    encoder = _state["encoder"]
    head = _state["head"]
    return {
        "enabled": ENABLED,
        "encoderLoaded": encoder is not None,
        "encoderId": ENCODER_ID,
        "encoderError": _state["encoder_error"],
        "backend": "ridge_head" if head is not None else "zeroshot",
        "headLoaded": head is not None,
        "headSha256": head.sha256 if head is not None else None,
        "headError": _state["head_error"],
        "queueDepth": _queue_depth,
        "maxQueueDepth": MAX_QUEUE_DEPTH,
        "maxRegionsPerRequest": MAX_REGIONS_PER_REQUEST,
        "experimentalAvailable": _state.get("experimental") is not None,
    }


@app.post("/suggest-regions")
async def suggest_regions(
    payload: SuggestRequest,
    authorization: str | None = Header(default=None),
) -> dict:
    global _queue_depth
    if not ENABLED:
        raise HTTPException(status_code=503, detail="worker_disabled")
    _require_token(authorization)
    encoder = _state["encoder"]
    if encoder is None:
        raise HTTPException(status_code=503, detail="encoder_unavailable")
    if payload.preprocess not in PREPROCESS_MODES:
        raise HTTPException(status_code=400, detail="invalid_preprocess")
    if payload.experimental and (_state.get("experimental") is None or payload.preprocess != "standard_center_crop"):
        raise HTTPException(status_code=503, detail="experimental_unavailable")
    # A head that was configured but failed validation must NOT silently fall
    # back to zero-shot: the caller asked for the trained head, so the request
    # is rejected with an explicit reason that the route forwards to the UI.
    if HEAD_PATH and _state["head"] is None:
        raise HTTPException(status_code=503, detail="head_invalid")

    region_ids = [region.regionId for region in payload.regions]
    if len(set(region_ids)) != len(region_ids):
        raise HTTPException(status_code=400, detail="duplicate_region_id")

    # --- Admission ----------------------------------------------------------
    # Everything cheap happens BEFORE decoding: queue depth, aggregate encoded
    # bytes and aggregate pixels (read from the image headers, which does not
    # rasterise anything). Decoding first would let a rejected request allocate
    # hundreds of megabytes.
    if _queue_depth >= MAX_QUEUE_DEPTH:
        raise HTTPException(status_code=429, detail="queue_full")

    admitted = [_admit_crop(region.cropPngBase64) for region in payload.regions]
    total_bytes = sum(len(item.raw) for item in admitted)
    if total_bytes > MAX_TOTAL_CROP_BYTES:
        raise HTTPException(status_code=413, detail="request_too_large")
    total_pixels = sum(item.width * item.height for item in admitted)
    if total_pixels > MAX_TOTAL_CROP_PIXELS:
        raise HTTPException(status_code=413, detail="request_too_many_pixels")

    _queue_depth += 1
    started = time.monotonic()
    try:
        batch = await _run_inference(
            encoder,
            admitted,
            region_ids,
            preprocess_mode=payload.preprocess,
            experimental=payload.experimental,
        )
    finally:
        _queue_depth -= 1

    return {
        **({"experimental": batch.experimental} if batch.experimental is not None else {}),
        "backend": batch.backend,
        "encoderId": batch.encoder_id,
        "encoderSha256": batch.encoder_sha256,
        "headSha256": batch.head_sha256,
        "preprocess": batch.preprocess_mode,
        "versions": batch.versions,
        "elapsedMs": round((time.monotonic() - started) * 1000, 1),
        "notice": (
            "Puntuaciones crudas, no probabilidades. Toda sugerencia queda pendiente "
            "de revisión humana."
        ),
        "suggestions": [
            {
                "regionId": item.region_id,
                "status": item.status,
                "topLabel": item.top_label,
                "topLabelEs": item.top_label_es,
                "ranking": item.ranking,
                "backend": item.backend,
            }
            for item in batch.suggestions
        ],
    }


async def _run_inference(
    encoder,  # noqa: ANN001
    admitted: list["AdmittedCrop"],
    region_ids: list[str],
    *,
    preprocess_mode: str,
    experimental: bool = False,
):
    """Run exactly one inference at a time, timeouts included.

    The gate is a real gate. `asyncio.wait_for` only cancels the *waiting*: the
    thread started by `asyncio.to_thread` keeps running to completion. Releasing
    the semaphore on timeout therefore admitted a second inference while the
    first one was still using the model and the memory — the concurrency of 1
    this worker promises was not held.

    So: the deadline covers the queue wait as well as the inference, the task is
    shielded from the timeout cancellation, and the gate is released only by the
    done callback, when the thread has really finished.
    """

    deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
    try:
        await asyncio.wait_for(
            _inference_gate.acquire(),
            timeout=max(0.0, deadline - time.monotonic()),
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="inference_timeout") from None

    task = asyncio.ensure_future(
        asyncio.to_thread(
            _decode_and_suggest,
            encoder,
            admitted,
            region_ids,
            preprocess_mode,
            _state["head"],
            *([_state["experimental"]] if experimental else []),
        )
    )
    # Released when the work actually ends, never when a caller gives up.
    task.add_done_callback(lambda _task: _inference_gate.release())

    try:
        return await asyncio.wait_for(
            asyncio.shield(task),
            timeout=max(0.0, deadline - time.monotonic()),
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="inference_timeout") from None
    except (ValueError, HeadValidationError):
        raise HTTPException(status_code=422, detail="inference_rejected") from None


def _decode_and_suggest(encoder, admitted, region_ids, preprocess_mode, head, experimental_head=None):  # noqa: ANN001
    """Decode inside the worker thread and hand the crops to the encoder."""

    crops = [_decode_admitted(item) for item in admitted]
    return suggest(
        encoder,
        crops,
        region_ids,
        preprocess_mode=preprocess_mode,
        trained_head=head,
        experimental_head=experimental_head,
    )


@dataclass(frozen=True)
class AdmittedCrop:
    """A crop that passed admission: real bytes and header-declared size."""

    raw: bytes
    width: int
    height: int


def _admit_crop(encoded: str) -> AdmittedCrop:
    """Validate a crop without rasterising it.

    Base64 is decoded (cheap, bounded by the already enforced body limit) and
    only the image *header* is parsed, so the pixel budget is known before any
    decoding happens.
    """

    if len(encoded) > MAX_CROP_BYTES * 4 // 3 + 4:
        raise HTTPException(status_code=413, detail="crop_too_large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid_crop_encoding") from None
    if not raw or len(raw) > MAX_CROP_BYTES:
        raise HTTPException(status_code=413, detail="crop_too_large")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image_format = image.format
            width, height = image.size
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - any header failure is a rejection
        raise HTTPException(status_code=400, detail="invalid_crop") from None
    if image_format not in {"PNG", "JPEG", "WEBP"}:
        raise HTTPException(status_code=415, detail="unsupported_crop_format")
    if width <= 0 or height <= 0 or width * height > MAX_CROP_PIXELS:
        raise HTTPException(status_code=413, detail="crop_too_many_pixels")
    return AdmittedCrop(raw=raw, width=width, height=height)


def _decode_admitted(crop: AdmittedCrop) -> Image.Image:
    """Rasterise an already admitted crop."""

    try:
        image = Image.open(io.BytesIO(crop.raw))
        image.verify()
        image = Image.open(io.BytesIO(crop.raw))
        return image.convert("RGB")
    except Exception:  # noqa: BLE001 - any decoding failure is a rejection
        raise ValueError("El recorte no se pudo decodificar.") from None
