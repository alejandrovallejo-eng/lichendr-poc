#!/usr/bin/env sh
# docker-entrypoint.sh — download MobileSAM checkpoint if absent, then start server.
set -eu

# Graphs are checked and baked into the Docker image; no runtime download.
if [ "${VISION_RUNTIME:-torch}" = "onnx" ]; then
    exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}" \
        --workers 1 --log-level info --timeout-keep-alive 75
fi

CHECKPOINT_DIR="/app/checkpoints"
CHECKPOINT_FILE="${CHECKPOINT_DIR}/mobile_sam.pt"
# Official MobileSAM weights — Apache-2.0 licence
# Source commit: f706ad9c4eb7f219c00d9050e46328518ffb65d2
# Architecture: vit_t
CHECKPOINT_URL="${MOBILESAM_CHECKPOINT_URL:-https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt}"
EXPECTED_SHA256="6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f"
# Minimum expected size: ~38 MB (38_000_000 bytes)
MIN_BYTES=38000000

mkdir -p "${CHECKPOINT_DIR}"

if [ ! -f "${CHECKPOINT_FILE}" ]; then
    echo "Downloading MobileSAM checkpoint from ${CHECKPOINT_URL} …"
    curl -fL --retry 3 --retry-delay 5 -o "${CHECKPOINT_FILE}" "${CHECKPOINT_URL}"
fi

ACTUAL_BYTES=$(wc -c < "${CHECKPOINT_FILE}" 2>/dev/null || echo 0)
if [ "${ACTUAL_BYTES}" -lt "${MIN_BYTES}" ]; then
    echo "ERROR: checkpoint at ${CHECKPOINT_FILE} is too small (${ACTUAL_BYTES} bytes). Corrupt download?" >&2
    rm -f "${CHECKPOINT_FILE}"
    exit 1
fi

ACTUAL_SHA256=$(sha256sum "${CHECKPOINT_FILE}" | awk '{print $1}')
if [ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]; then
    echo "ERROR: checkpoint SHA-256 mismatch (expected ${EXPECTED_SHA256}, got ${ACTUAL_SHA256})." >&2
    rm -f "${CHECKPOINT_FILE}"
    exit 1
fi
echo "Checkpoint OK — $(( ACTUAL_BYTES / 1024 / 1024 )) MB, SHA-256 verified"

PORT="${PORT:-8000}"
if [ "${UVICORN_WORKERS:-1}" != "1" ]; then
    echo "Ignoring UVICORN_WORKERS=${UVICORN_WORKERS}; one worker is required for the 512 MB memory budget." >&2
fi
WORKERS=1

exec uvicorn app:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --workers "${WORKERS}" \
    --log-level info \
    --timeout-keep-alive 75
