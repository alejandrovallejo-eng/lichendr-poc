# Vision Service — MobileSAM

A minimal FastAPI service that runs **MobileSAM vit_t** on CPU and exposes three endpoints consumed exclusively by the Next.js server-side proxy.

## Architecture

```
Browser ──► Next.js (:3000) ──► Vision Service (:8000, 127.0.0.1 only)
```

The browser never talks directly to this service.

## Setup

```bash
bash scripts/setup-vision-service.sh
```

The script will:
1. Create `services/vision/.venv`
2. Install PyTorch (CPU-only) and all Python dependencies
3. Download `mobile_sam.pt` (~38 MB) into `services/vision/checkpoints/`

## Running (development)

```bash
bash scripts/dev-with-vision.sh
```

This starts both this service on `127.0.0.1:8000` and Next.js on `0.0.0.0:3000`.

## API

### `GET /health`
Returns service status, model readiness, backend and model name.

### `POST /prepare`
Accepts a multipart image file (JPEG, PNG, WebP, HEIC, HEIF, max 20 MB).
Strips EXIF, resizes to ≤ 1024 px, runs `SamPredictor.set_image`.
Returns `{ sessionId, width, height, prepareMs }`.

### `POST /segment`
```json
{ "sessionId": "...", "points": [{ "x": 0.5, "y": 0.5, "label": 1 }] }
```
x/y are normalised [0–1]. label 1 = positive, 0 = negative.
Returns up to three in-memory PNG data URL candidates, dimensions, scores, `areaPixels`, the true constant model name (`MobileSAM vit_t`) and recommended index. Boolean mask matrices are never returned to the browser.

### `DELETE /sessions/{sessionId}`
Frees the session immediately.

## Constraints

- CPU-only (no CUDA).
- Maximum 3 concurrent sessions; LRU eviction; 15-minute TTL.
- One inference at a time (threading lock).
- Images are never persisted to disk.
