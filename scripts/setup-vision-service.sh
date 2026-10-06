#!/usr/bin/env bash
# Optional local ONNX worker. Hosted Render + Cloud Run use npm run dev:full.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(cd "${SCRIPT_DIR}/../services/vision" && pwd)"
PYTHON="${VISION_PYTHON_BIN:-python3.11}"
if ! command -v "${PYTHON}" >/dev/null 2>&1 || ! "${PYTHON}" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)'; then
  echo 'VISION_PYTHON_BIN must point to Python 3.11.' >&2; exit 1
fi
RUNTIME="${SERVICE_DIR}/.venv"
EXPORTER="${SERVICE_DIR}/.venv-export"
for environment in "${RUNTIME}" "${EXPORTER}"; do
  if [ ! -d "${environment}" ]; then "${PYTHON}" -m venv "${environment}"; fi
  "${environment}/bin/python" -c 'import sys; assert sys.version_info[:2] == (3,11), "Existing environment must use Python 3.11"'
done
"${RUNTIME}/bin/python" -m pip install -r "${SERVICE_DIR}/requirements.txt"
"${RUNTIME}/bin/python" -c 'import importlib.util; assert importlib.util.find_spec("torch") is None, "Use a fresh runtime environment without Torch"'
"${EXPORTER}/bin/python" -m pip install -r "${SERVICE_DIR}/requirements-build.txt"
if [ "$(uname -s)" = Darwin ]; then
  "${EXPORTER}/bin/python" -m pip install torch==2.2.2 torchvision==0.17.2
else
  "${EXPORTER}/bin/python" -m pip install torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cpu
fi
"${EXPORTER}/bin/python" -m pip install --no-deps 'git+https://github.com/ChaoningZhang/MobileSAM.git@f706ad9c4eb7f219c00d9050e46328518ffb65d2'
mkdir -p "${SERVICE_DIR}/checkpoints"
CHECKPOINT="${SERVICE_DIR}/checkpoints/mobile_sam.pt"
if [ ! -f "${CHECKPOINT}" ]; then
  curl -fL --retry 3 -o "${CHECKPOINT}" 'https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt'
fi
"${PYTHON}" - "${CHECKPOINT}" <<'PY'
import hashlib, sys
with open(sys.argv[1], 'rb') as f: digest = hashlib.file_digest(f, 'sha256').hexdigest()
assert digest == '6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f', 'Checkpoint verification failed'
PY
"${EXPORTER}/bin/python" "${SERVICE_DIR}/export_onnx.py" "${CHECKPOINT}" "${SERVICE_DIR}/onnx"
echo 'ONNX worker prepared. Configure VISION_SERVICE_TOKEN and SUPABASE_STORAGE_HOST before starting.'
echo 'Start with: bash scripts/dev-with-vision.sh'
