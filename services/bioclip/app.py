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
    REQUEST_TIMEOUT_SECONDS,
)
from encoder import PREPROCESS_MODES, EncoderUnavailable, load_encoder
from head import HeadValidationError, load_trained_head
from suggest import suggest

Image.MAX_IMAGE_PIXELS = MAX_CROP_PIXELS

ENABLED = os.environ.get("BIOCLIP_WORKER_ENABLED") == "1"
MODEL_DIR = os.environ.get("BIOCLIP_MODEL_DIR", "")
HEAD_PATH = os.environ.get("BIOCLIP_HEAD_PATH", "")
HEAD_SHA256 = os.environ.get("BIOCLIP_HEAD_SHA256", "")
WORKER_TOKEN = os.environ.get("BIOCLIP_WORKER_TOKEN", "")

_inference_gate = asyncio.Semaphore(1)
_queue_depth = 0
_state: dict = {"encoder": None, "head": None, "head_error": None, "encoder_error": None}


class RegionInput(BaseModel):
    regionId: str = Field(min_length=1, max_length=128)
    cropPngBase64: str = Field(min_length=1)


class SuggestRequest(BaseModel):
    regions: list[RegionInput] = Field(min_length=1, max_length=MAX_REGIONS_PER_REQUEST)
    preprocess: str = "whole_crop_pad"


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
    yield


app = FastAPI(title="LichenDR BioCLIP worker", lifespan=lifespan)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_REQUEST_BYTES:
                return JSONResponse({"detail": "request_too_large"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "invalid_content_length"}, status_code=400)
    return await call_next(request)


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

    crops = [_decode_crop(region.cropPngBase64) for region in payload.regions]
    region_ids = [region.regionId for region in payload.regions]
    if len(set(region_ids)) != len(region_ids):
        raise HTTPException(status_code=400, detail="duplicate_region_id")

    if _queue_depth >= MAX_QUEUE_DEPTH:
        raise HTTPException(status_code=429, detail="queue_full")

    _queue_depth += 1
    started = time.monotonic()
    try:
        async with _inference_gate:
            batch = await asyncio.wait_for(
                asyncio.to_thread(
                    suggest,
                    encoder,
                    crops,
                    region_ids,
                    preprocess_mode=payload.preprocess,
                    trained_head=_state["head"],
                ),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="inference_timeout") from None
    except (ValueError, HeadValidationError):
        raise HTTPException(status_code=422, detail="inference_rejected") from None
    finally:
        _queue_depth -= 1

    return {
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


def _decode_crop(encoded: str) -> Image.Image:
    if len(encoded) > MAX_CROP_BYTES * 4 // 3 + 4:
        raise HTTPException(status_code=413, detail="crop_too_large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid_crop_encoding") from None
    if not raw or len(raw) > MAX_CROP_BYTES:
        raise HTTPException(status_code=413, detail="crop_too_large")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        if image.format not in {"PNG", "JPEG", "WEBP"}:
            raise HTTPException(status_code=415, detail="unsupported_crop_format")
        if image.width * image.height > MAX_CROP_PIXELS:
            raise HTTPException(status_code=413, detail="crop_too_many_pixels")
        return image.convert("RGB")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - any decoding failure is a rejection
        raise HTTPException(status_code=400, detail="invalid_crop") from None
