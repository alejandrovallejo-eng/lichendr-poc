# Vision Service — MobileSAM

A FastAPI service that runs **MobileSAM vit_t** on CPU for both the advanced editor and the automatic four-view workflow.

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

### Automatic frame endpoints

- `POST /template/validate`: validates JPEG/PNG/HEIC/HEIF signatures and the four expected `DICT_5X5_50` IDs.
- `POST /rectify`: applies the physical frame homography and returns the exact 400 × 2000 inner window.
- `POST /analyze-view`: uses multipart `action=detect|confirm_corners|analyze_confirmed`. Detection either returns a validated result or a four-corner proposal; confirmation returns a rectification for review; only the final reviewed action runs MobileSAM and calculates metrics.
- `GET /processing/status`: reports readiness and confirms that inference is sequential.

Every frame response reports detected/missing IDs, rejected candidates, successful pyramid level and variant, method, confidence, reprojection error and a specific rejection reason. The automatic labels `LQ-001`, `LQ-002`, … are provisional visual morphotypes. They are not taxonomic identifications. A view with critical blur, exposure, resolution or homography errors returns `repeat_photo` without a silent coverage percentage.

## Constraints

- CPU-only (no CUDA).
- Maximum 3 concurrent sessions; LRU eviction; 15-minute TTL.
- One inference at a time (threading lock).
- Images are never persisted to disk.
