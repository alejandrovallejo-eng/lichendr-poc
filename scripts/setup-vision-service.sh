#!/usr/bin/env bash
# setup-vision-service.sh — set up the MobileSAM Python service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${REPO_ROOT}/services/vision"
VENV_DIR="${SERVICE_DIR}/.venv"
CHECKPOINT_DIR="${SERVICE_DIR}/checkpoints"
CHECKPOINT_FILE="${CHECKPOINT_DIR}/mobile_sam.pt"
CHECKPOINT_URL="https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt"

# ── Detect Python ────────────────────────────────────────────────────────────
PYTHON=""
for candidate in python3.11 python3.10 python3.9 python3 python; do
    if command -v "${candidate}" &>/dev/null; then
        VERSION=$("${candidate}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        MAJOR="${VERSION%%.*}"
        MINOR="${VERSION##*.}"
        if [ "${MAJOR}" -ge 3 ] && [ "${MINOR}" -ge 9 ]; then
            PYTHON="${candidate}"
            echo "Using Python ${VERSION} (${PYTHON})"
            break
        fi
    fi
done

if [ -z "${PYTHON}" ]; then
    echo "ERROR: Python 3.9+ not found. Install Python 3.9 or newer." >&2
    exit 1
fi

# ── Virtual environment ──────────────────────────────────────────────────────
if [ ! -d "${VENV_DIR}" ]; then
    echo "Creating virtual environment at ${VENV_DIR} …"
    "${PYTHON}" -m venv "${VENV_DIR}"
fi

PIP="${VENV_DIR}/bin/pip"
PYTHON_VENV="${VENV_DIR}/bin/python"

echo "Upgrading pip …"
"${PYTHON_VENV}" -m pip install --quiet --upgrade pip

# ── PyTorch CPU-only ─────────────────────────────────────────────────────────
echo "Installing PyTorch (CPU-only) …"
"${PIP}" install --quiet \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# ── MobileSAM ────────────────────────────────────────────────────────────────
echo "Installing MobileSAM from official repository …"
"${PIP}" install --quiet \
    "git+https://github.com/ChaoningZhang/MobileSAM.git"

# ── Other dependencies ───────────────────────────────────────────────────────
echo "Installing remaining dependencies …"
"${PIP}" install --quiet \
    "fastapi==0.115.6" \
    "uvicorn[standard]==0.32.1" \
    "python-multipart==0.0.20" \
    "Pillow==11.1.0" \
    "pillow-heif==0.21.0" \
    "numpy==2.2.1" \
    "opencv-python-headless==4.10.0.84" \
    "pydantic==2.10.4" \
    "timm"

# ── Checkpoint ───────────────────────────────────────────────────────────────
mkdir -p "${CHECKPOINT_DIR}"

if [ ! -f "${CHECKPOINT_FILE}" ]; then
    echo "Downloading mobile_sam.pt …"
    if command -v curl &>/dev/null; then
        curl -fL --retry 3 -o "${CHECKPOINT_FILE}" "${CHECKPOINT_URL}"
    elif command -v wget &>/dev/null; then
        wget -q --tries=3 -O "${CHECKPOINT_FILE}" "${CHECKPOINT_URL}"
    else
        echo "ERROR: neither curl nor wget found. Cannot download checkpoint." >&2
        exit 1
    fi
else
    echo "Checkpoint already present at ${CHECKPOINT_FILE}"
fi

# Verify checkpoint is non-empty
CHECKPOINT_SIZE=$(wc -c < "${CHECKPOINT_FILE}" 2>/dev/null || echo 0)
if [ "${CHECKPOINT_SIZE}" -lt 1000000 ]; then
    echo "ERROR: ${CHECKPOINT_FILE} appears empty or corrupt (${CHECKPOINT_SIZE} bytes)." >&2
    rm -f "${CHECKPOINT_FILE}"
    exit 1
fi
echo "Checkpoint OK — $(( CHECKPOINT_SIZE / 1024 / 1024 )) MB"

# ── Sanity import check ───────────────────────────────────────────────────────
echo "Verifying Python imports …"
"${PYTHON_VENV}" - <<'PYCHECK'
import torch
import mobile_sam
from mobile_sam import SamPredictor, sam_model_registry
import fastapi, uvicorn, PIL, numpy, cv2, pydantic
print("All imports OK")
print(f"  torch={torch.__version__}")
print(f"  mobile_sam OK")
print(f"  fastapi={fastapi.__version__}")
PYCHECK

echo ""
echo "Setup complete."
echo "  Checkpoint: ${CHECKPOINT_FILE}"
echo "  Venv:       ${VENV_DIR}"
echo ""
echo "Start with:  bash scripts/dev-with-vision.sh"
