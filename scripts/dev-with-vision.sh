#!/usr/bin/env bash
# dev-with-vision.sh — start Vision Service and Next.js together
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/services/vision"
VENV_DIR="${SERVICE_DIR}/.venv"
WEB_DIR="${REPO_ROOT}/apps/web"

VISION_PID=""
NEXTJS_PID=""

cleanup() {
    echo ""
    echo "Shutting down …"
    [ -n "${VISION_PID}" ] && kill "${VISION_PID}" 2>/dev/null || true
    [ -n "${NEXTJS_PID}" ] && kill "${NEXTJS_PID}" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}

trap cleanup INT TERM EXIT

# ── Guard: prevent duplicate processes ───────────────────────────────────────
if lsof -iTCP:8000 -sTCP:LISTEN -t &>/dev/null 2>&1; then
    echo "ERROR: Port 8000 is already in use. Stop the existing process first." >&2
    exit 1
fi

if lsof -iTCP:3000 -sTCP:LISTEN -t &>/dev/null 2>&1; then
    echo "ERROR: Port 3000 is already in use. Stop the existing process first." >&2
    exit 1
fi

# ── Verify setup ─────────────────────────────────────────────────────────────
if [ ! -f "${VENV_DIR}/bin/uvicorn" ]; then
    echo "Vision service not set up. Running setup …"
    bash "${SCRIPT_DIR}/setup-vision-service.sh"
fi

# ── Start Vision Service ─────────────────────────────────────────────────────
echo "Starting Vision Service on 127.0.0.1:8000 …"
"${VENV_DIR}/bin/uvicorn" app:app \
    --host 127.0.0.1 \
    --port 8000 \
    --app-dir "${SERVICE_DIR}" \
    --workers 1 \
    --log-level info &
VISION_PID=$!

# Wait for /health to respond
echo -n "Waiting for Vision Service …"
for i in $(seq 1 60); do
    if curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
        echo " ready."
        break
    fi
    if [ "${i}" -eq 60 ]; then
        echo " TIMEOUT — Vision Service did not start in 60 s." >&2
        exit 1
    fi
    echo -n "."
    sleep 1
done

# ── Start Next.js ─────────────────────────────────────────────────────────────
echo "Starting Next.js on 0.0.0.0:3000 …"
cd "${WEB_DIR}"
npm run dev -- --hostname 0.0.0.0 --port 3000 &
NEXTJS_PID=$!

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Open your browser at:  http://localhost:3000"
echo "  Vision service listens ONLY on 127.0.0.1:8000"
echo "  Do NOT expose port 8000 publicly."
echo "═══════════════════════════════════════════════════════"
echo ""

wait "${NEXTJS_PID}"
