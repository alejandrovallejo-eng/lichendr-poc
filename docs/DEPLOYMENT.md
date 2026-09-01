# Deployment Guide

This document describes how to deploy LichenDR to production:
**Next.js on Vercel** + **Python/FastAPI + MobileSAM on Render**.

---

## Architecture

```
Browser
  │
  ▼ (HTTPS)
Vercel — Next.js (apps/web)
  │  server-side only — token never reaches the browser
  ▼ (HTTPS + Authorization: ******
Render — FastAPI + MobileSAM (services/vision)
  │
  ▼
In-process model: MobileSAM vit_t (CPU)
```

Supabase is used separately for Auth, Postgres and Storage; it is not relayed through Render.

---

## MobileSAM checkpoint

| Attribute | Value |
|-----------|-------|
| Source    | https://github.com/ChaoningZhang/MobileSAM |
| URL       | https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt |
| Version   | MobileSAM v1.0, architecture `vit_t` |
| Size      | ~9.7 MB |
| Licence   | Apache 2.0 |

The checkpoint is **not committed to Git**. It is downloaded automatically when the
Docker container starts (see `services/vision/docker-entrypoint.sh`).

**Verify the SHA-256 after the first pull:**

```bash
sha256sum services/vision/checkpoints/mobile_sam.pt
```

Compare the output with the value published at
https://github.com/ChaoningZhang/MobileSAM/releases and record it here once confirmed.

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
| `PORT` | `8000` (Render injects this automatically; the entrypoint reads it) |
| `UVICORN_WORKERS` | `1` (do not increase on the Free plan) |

### Obtaining the service URL

Once the service is deployed, copy the URL shown at the top of the Render
service page (format: `https://lichendr-vision.onrender.com`). Set this as
`VISION_SERVICE_URL` in Vercel.

### Cold start on the Free plan

The Render Free plan **spins down** after ~15 minutes of inactivity. The next
request will wake the service, but the first response may take 30–120 seconds
(download checkpoint + load model). During this time the Next.js routes return
`503` and the application shows the manual fallback flow.

---

## Memory and timing measurements

> **These figures must be measured; do not assume they are accurate.**
> Run `scripts/measure-vision-docker.sh` (see below) to obtain real numbers.

Render Free provides approximately **512 MB RAM**.

MobileSAM `vit_t` is approximately 9.7 MB on disk. In practice, after loading
into PyTorch (CPU), peak RSS is roughly 400–600 MB depending on the OS and
Python version. **This is at the limit of or exceeds Render Free.**

### How to measure locally

```bash
# Build the image
docker build -t lichendr-vision services/vision/

# Start with a memory limit matching Render Free
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

Record and update the table below:

| Metric | Value |
|--------|-------|
| Memory before model load | — MB |
| Memory with MobileSAM loaded | — MB |
| Peak memory during inference | — MB |
| Container start time | — s |
| Time to first `/ready` | — s |
| First inference time | — ms |
| Subsequent inference time | — ms |
| Docker image size | — MB |

### Recommendation

If peak memory exceeds ~480 MB the service will be killed by Render Free's OOM
killer. In that case:

- Upgrade to the **Render Starter plan** ($7/month, 512 MB guaranteed + burst).
- Or upgrade to **Standard** ($25/month, 2 GB RAM) for reliable production use.

**Do not select or pay for any plan without first measuring actual memory usage.**
