# Deployment Guide

This document describes how to deploy LichenDR to production:
**Next.js on Vercel** + **Python/FastAPI + MobileSAM on Render**.

---

## Architecture

```
Browser
  │  original image (direct upload)
  ▼ (HTTPS + user session)
Private Supabase Storage
  ▲                         │ short-lived signed original read
  │ image ID only           ▼
Vercel — Next.js + Sharp/libvips
  │  private 2048 px analysis proxy + signed manifest
  ▼
Private Supabase Storage
  │ short-lived signed proxy read
  ▼
Render — FastAPI + MobileSAM
  HTTPS + Authorization: ******
  │
  ▼
In-process model: MobileSAM vit_t (CPU)
```

The browser uploads the original directly to the private `lichen-images` bucket
and sends Vercel only the database image ID. Vercel checks the user and image
through the existing RLS session, streams the original to temporary storage, and
uses Sharp/libvips to correct EXIF orientation and generate a JPEG analysis proxy
whose longest side is at most 2048 px. If the bundled libvips cannot decode a
compatible HEIC, the server uses the bounded `heic-decode` fallback automatically.
The original is never overwritten.

The proxy is stored at a deterministic versioned path below
`<user-id>/analysis-proxies/<image-id>/`. Its HMAC-authenticated manifest is
stored as custom metadata on the JPEG object, so the image-only bucket never
receives an unsupported JSON object and retries can reuse the existing proxy.
Vercel sends Render only a short-lived signed URL for the proxy together with
the original and proxy dimensions. Render validates those dimensions, runs the
request serially, and maps reported geometry back to the oriented original
coordinate system. The original therefore never crosses the 4.5 MB Vercel
Function request limit, and neither signed URLs nor `VISION_SERVICE_TOKEN`
reach the browser.

---

## MobileSAM checkpoint

| Attribute | Value |
|-----------|-------|
| Source    | https://github.com/ChaoningZhang/MobileSAM |
| Commit    | `f706ad9c4eb7f219c00d9050e46328518ffb65d2` |
| Package   | `git+https://github.com/ChaoningZhang/MobileSAM.git@f706ad9c4eb7f219c00d9050e46328518ffb65d2` |
| URL       | https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt |
| Architecture | `vit_t` |
| Size      | 38.8 MB |
| SHA-256   | `6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f` |
| Licence   | Apache 2.0 |

The checkpoint is **not committed to Git**. It is downloaded automatically when the
Docker container starts (see `services/vision/docker-entrypoint.sh`).

**Verify after the first pull:**

```bash
sha256sum services/vision/checkpoints/mobile_sam.pt
# expected: 6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f
```

---

## Generating a secure token

Both Vercel and Render need the **same** `VISION_SERVICE_TOKEN`. Generate it once:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Store the output somewhere safe (password manager). **Do not commit it.**

---

## Vercel setup

### Project settings

| Setting | Value |
|---------|-------|
| Production Branch | `v1-modular` |
| Root Directory | `apps/web` |
| Framework Preset | Next.js |

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**.
Apply to Production, Preview and Development (or as appropriate).

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable (anon) key |
| `VISION_SERVICE_URL` | The Render service URL (see below), e.g. `https://lichendr-vision.onrender.com` |
| `VISION_SERVICE_TOKEN` | The shared secret generated above |

> **`VISION_SERVICE_TOKEN` must NOT start with `NEXT_PUBLIC_`.** It is read
> server-side only and is never included in the browser bundle.

### Redeployment and verification

1. After saving the environment variables, trigger a new deployment from the
   Vercel dashboard or by pushing to `v1-modular`.
2. Once deployed, visit `https://<your-vercel-domain>/api/vision/health` from
   a browser. You should receive `{"status":"ok","model_loaded":true,...}`.
   If the vision service is still warming up you may get `model_loaded: false`
   until Render finishes loading MobileSAM.

### Sharp runtime packaging

The analysis-proxy routes require the linux-x64 Sharp native addon and its
matching libvips shared library. Both packages are pinned explicitly in
`apps/web/package.json`, and `next.config.ts` includes them in the serverless
output trace. The `postbuild` check imports Sharp, transforms an image, and
fails the deployment if either native runtime package is absent from the
analysis-proxy function trace.

---

## Render setup

### Creating the Web Service

Option A — via `render.yaml` (recommended):

1. In the Render dashboard click **New → Blueprint**.
2. Connect your repository and select the `v1-modular` branch.
3. Render will detect `render.yaml` at the repository root.
4. Review the configuration and click **Apply**.

Option B — manually:

1. In the Render dashboard click **New → Web Service**.
2. Connect your repository.
3. Fill in the following fields:

| Field | Value |
|-------|-------|
| Name | `lichendr-vision` |
| Branch | `v1-modular` |
| Root Directory | *(leave empty — Dockerfile path is set below)* |
| Runtime | Docker |
| Dockerfile Path | `./services/vision/Dockerfile` |
| Docker Context | `./services/vision` |
| Region | Oregon (or closest to your users) |
| Plan | Free (see memory note below) |

### Health check

Render is configured to poll `/health`. The service is considered healthy when
the endpoint returns `200`. The `/ready` endpoint returns `503` until MobileSAM
has finished loading, which typically takes 10–60 seconds on first start.

### Environment variables for Render

Set these in **Render → Service → Environment**:

| Variable | Value |
|----------|-------|
| `VISION_SERVICE_TOKEN` | The shared secret generated above |
| `SUPABASE_STORAGE_HOST` | Exact host from the Supabase URL, e.g. `xxxx.supabase.co` (no scheme or path) |
| `PORT` | `8000` (Render injects this automatically; the entrypoint reads it) |
| `UVICORN_WORKERS` | `1` (do not increase on the Free plan) |

### Obtaining the service URL

Once the service is deployed, copy the URL shown at the top of the Render
service page (format: `https://lichendr-vision.onrender.com`). Set this as
`VISION_SERVICE_URL` in Vercel.

### Cold start on the Free plan

The Render Free plan **spins down** after ~15 minutes of inactivity. The next
request will wake the service, but the first response may take 30–120 seconds
(download checkpoint + load model). The Next.js analysis route checks readiness
and performs one automatic retry before returning a recoverable error.

---

## Memory and timing measurements

> These figures were measured on a Linux x86_64 host (Python 3.12, PyTorch 2.13 with CUDA
> libraries installed — the CUDA runtime inflates RSS; a CPU-only Docker container will
> be lower but the inference workload figures are representative).

Render Free provides approximately **512 MB RAM**.

| Metric | Measured value | Notes |
|--------|---------------|-------|
| Baseline RSS (Python + imports) | 10 MB | |
| RSS after MobileSAM loaded | **776 MB** | Includes CUDA runtime overhead |
| Peak RSS during inference | **1131 MB** | `prepare` (feature extraction) |
| Model load time | 2.5 s | From `load_model()` call |
| First `prepare` call | 2482 ms | Image encoding + feature extraction |
| First `segment` call | 153 ms | |
| Subsequent `prepare` calls | ~2491 ms | No warm-up effect for CPU |
| Subsequent `segment` calls | ~143 ms | |
| MobileSAM checkpoint size on disk | 38.8 MB | |

> **Important caveat**: The measurement above used PyTorch with CUDA libraries, which adds
> ~700 MB of shared-library RSS that would not be present in a CPU-only image.
> With the CPU-only Docker image, post-load RSS is estimated at **350–500 MB** and
> peak inference RSS at **500–750 MB** — still at or above the Render Free limit.

### Render Free assessment: ⚠️ INSUFFICIENT

Render Free provides ~512 MB RAM. Even with a CPU-only PyTorch build, the service is
**likely to be killed by the OOM killer** during or shortly after the first inference.

### Recommended plans

| Plan | RAM | Monthly cost | Assessment |
|------|-----|-------------|------------|
| Free | ~512 MB | $0 | ❌ Very likely OOM killed |
| Starter | 512 MB guaranteed | $7 | ⚠️ Tight, may OOM on peak |
| Standard | 2 GB | $25 | ✅ Comfortable headroom |

**Do not select or pay for any plan without first measuring the actual Docker container.**

### How to measure the actual CPU-only container

```bash
# Build the image (CPU-only PyTorch)
docker build -t lichendr-vision services/vision/

# Start with memory limit matching Render Free
docker run --rm -d --name lichendr-vision-test \
  -p 8000:8000 \
  -e VISION_SERVICE_TOKEN=test-token-local \
  --memory=512m \
  lichendr-vision

# Wait for /ready
until curl -sf http://localhost:8000/ready; do sleep 2; done

# Measure memory after model load
docker stats --no-stream lichendr-vision-test

# Run one inference (replace frame.jpg with a real photo)
curl -s -X POST http://localhost:8000/analyze-view \
  -H "Authorization: ******" \
  -F "image=@frame.jpg" | python3 -m json.tool | head -10

# Measure peak memory after inference
docker stats --no-stream lichendr-vision-test

# Image size
docker image inspect lichendr-vision --format '{{.Size}}' | \
  awk '{printf "%.0f MB\n", $1/1024/1024}'

docker stop lichendr-vision-test
```
