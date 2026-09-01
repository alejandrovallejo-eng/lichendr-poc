# ── Stage 1: build dependencies ─────────────────────────────────────────────
FROM python:3.11-slim AS builder

# System packages required by OpenCV and Pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Install PyTorch CPU-only (index.pytorch.org) then MobileSAM then other deps.
# Using --no-cache-dir to minimise layer size.
RUN pip install --no-cache-dir \
        torch==2.2.2 torchvision==0.17.2 \
        --index-url https://download.pytorch.org/whl/cpu \
    || pip install --no-cache-dir torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu \
    || pip install --no-cache-dir torch torchvision

RUN pip install --no-cache-dir \
        "git+https://github.com/ChaoningZhang/MobileSAM.git@v1.0"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


# ── Stage 2: runtime image ──────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

WORKDIR /app

# Copy application code (no checkpoints – downloaded at container start)
COPY app.py frame.py model.py schemas.py ./

# Entrypoint that downloads the checkpoint if absent, verifies its size,
# then starts uvicorn bound to 0.0.0.0:$PORT.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Non-root user for least-privilege execution
RUN addgroup --system vision && adduser --system --ingroup vision vision
RUN chown -R vision:vision /app
USER vision

EXPOSE 8000

ENTRYPOINT ["/docker-entrypoint.sh"]
