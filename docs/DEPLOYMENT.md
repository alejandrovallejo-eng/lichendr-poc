# Deployment Guide

This document describes how to deploy LichenDR to production:
**Next.js on Vercel** + **MobileSAM on Render** + **BioCLIP on private Cloud Run**.

Local AI authentication, feature flags and real workflow verification are
documented in [AI_SETUP.md](AI_SETUP.md).

Database provisioning, real connection checks, migration state and local Auth
callbacks are documented in [DATABASE_SETUP.md](DATABASE_SETUP.md). The local
frontend now uses the existing hosted database with visual-preview mode disabled;
this does not deploy the frontend changes to Vercel.

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

The checkpoint is **not committed to Git**. It is downloaded automatically when
the Docker image builds. The current ONNX runtime includes verified graphs
in the image and does not download weights at startup; the optional Torch
entrypoint still downloads the checkpoint when absent.

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
| Source branch | `v1-modular` |
| Production Branch currently configured | `production-paused` (manual release) |
| Root Directory | `apps/web` |
| Framework Preset | Next.js |

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Scope
each value to the environment that owns its resource; do not share the Production
Supabase URL/key with Preview.

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable (anon) key |
| `VISION_SERVICE_URL` | The Render service URL (see below), e.g. `https://lichendr-vision.onrender.com` |
| `VISION_SERVICE_TOKEN` | The shared secret generated above |

### Preview authentication

The Supabase Production Auth allowlist contains the Production callback and one
specific Vercel branch Preview callback. For authenticated review of PR #27, use
the stable **Preview** link in the Vercel/GitHub PR comment. A commit-specific
deployment URL has a different hostname; Supabase falls back to the Production
Site URL when that hostname is not allowlisted. Check the callback host against
**Authentication → URL Configuration** before using Google sign-in from another
Preview URL. Do not add a broad `*.vercel.app` redirect pattern.

Review each Preview scope before testing: historical branches may use different databases. The final Production uses the owner-selected working database `taqdmdghdqnczioxhajb`. The former Production database `nioqaweibbtwxwpipqpe` is preserved. This working environment contains real data and the shared vision
service. Restrict tests to clearly marked records and avoid changing existing
Production data. For ongoing team use, move Preview to a dedicated non-production
Supabase project and a separately configured vision service before enabling
general data-entry testing there.

The current Supabase Free plan does not include scheduled project backups. Before
relying on Production for team data, arrange a backup plan that covers both the
database and private Storage objects, and test a restore. Database backups alone
do not include Storage file bytes.

> **`VISION_SERVICE_TOKEN` must NOT start with `NEXT_PUBLIC_`.** It is read
> server-side only and is never included in the browser bundle.

### Redeployment and verification

1. Push to `v1-modular` to run GitHub Actions and build Preview. The hosted
   project's Production Branch is currently `production-paused`; a push to
   `v1-modular` does not publish Production. Once checks pass, open that exact
   deployment in Vercel, choose **Redeploy → Production**, leave existing build
   cache unchecked, and confirm Redeploy. This rebuilds with the Production
   variables and assigns the final domain.
   Do not simply reassign a Preview deployment's domain: its compiled variables
   may differ. Vercel rejects setting `v1-modular` as Production Branch while
   branch-specific Preview BioCLIP variables use that same branch. Keep this
   manual release path until Preview branch configuration is separated.
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
(load the model graphs). The Next.js analysis route checks readiness
and performs one automatic retry before returning a recoverable error.

---

## Memory and timing measurements

The older PyTorch/CUDA RSS measurements do not describe the current deployed
runtime. Docker now exports the pinned MobileSAM checkpoint to FP32 ONNX at
build time; the final runtime includes neither Torch nor Torchvision.

The build runs three real inference cycles on Linux and fails if the complete
process peak exceeds 450 MiB. This is a regression check, not a guarantee for
all input images or calibration workloads. Keep one worker and the existing
serialization and input guards.

See [services/vision/LOW_MEMORY.md](../services/vision/LOW_MEMORY.md) for numerical
comparison with the original model, local memory measurements and reproduction
commands. Measure the actual container and verify `/prepare` and `/segment`
before selecting a hosting plan. `/ready` alone does not prove successful
inference. Verify the application routes with the workflow command in
[AI_SETUP.md](AI_SETUP.md).

## Final application configuration

From `apps/web`, use `npm run dev:full` locally. Production uses:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://taqdmdghdqnczioxhajb.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing publishable key for that project |
| `LICHENDR_PREVIEW_ONLY` | absent or `0` |
| `VISION_SERVICE_URL` | `https://lichendr-vision-preview.onrender.com` |
| `VISION_SERVICE_TOKEN` | Existing Render signing/service secret, server only |
| `NEXT_PUBLIC_MOBILESAM_ASSISTANCE` | absent or `1` |
| `NEXT_PUBLIC_BIOCLIP_SUGGESTIONS` | `1` |
| `BIOCLIP_WORKER_URL` | `https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app` |
| `BIOCLIP_WORKER_TOKEN` | Existing private worker secret, server only |
| `BIOCLIP_PREPROCESS_MODE` | `standard_center_crop` |
| `BIOCLIP_GOOGLE_IAM` | `1` |
| `BIOCLIP_GOOGLE_DEVELOPER_AUTH` | absent or `0` |

The existing Vercel/Google identity federation authorizes this project’s exact
Preview and Production subjects. Do not copy local SDK credentials or make the
worker public. The resource names retain `preview`; verify actual authorization
and resource scopes rather than inferring isolation from those names.

Environment changes require a new deployment. Verify the deployed commit,
Supabase callback hostname, actual four-view workflow and authenticated
exports, not just `/ready`. Use the owner-scoped TAR and recovery procedure in
[BACKUPS.md](BACKUPS.md). The CI workflow runs offline tests and a production
build without administrative credentials; integration checks require explicit
execution against the configured application.
