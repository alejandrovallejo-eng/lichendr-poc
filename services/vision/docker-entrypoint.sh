#!/usr/bin/env sh
# docker-entrypoint.sh — download MobileSAM checkpoint if absent, then start server.
set -eu

CHECKPOINT_DIR="/app/checkpoints"
CHECKPOINT_FILE="${CHECKPOINT_DIR}/mobile_sam.pt"
# Official MobileSAM weights — Apache-2.0 licence
# Source : https://github.com/ChaoningZhang/MobileSAM/releases/tag/v1.0
# Version: MobileSAM v1.0, vit_t architecture
# SHA-256: verify manually on first pull (see docs/DEPLOYMENT.md)
CHECKPOINT_URL="${MOBILESAM_CHECKPOINT_URL:-https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt}"
# Minimum expected size: ~9 MB (9_000_000 bytes)
MIN_BYTES=9000000

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
echo "Checkpoint OK — $(( ACTUAL_BYTES / 1024 / 1024 )) MB"

PORT="${PORT:-8000}"
WORKERS="${UVICORN_WORKERS:-1}"

exec uvicorn app:app \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --workers "${WORKERS}" \
    --log-level info \
    --timeout-keep-alive 75
