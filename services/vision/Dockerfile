# PyTorch is used only to export and verify the unchanged FP32 MobileSAM graphs.
FROM python:3.11-slim AS exporter
RUN apt-get update && apt-get install -y --no-install-recommends git curl libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN pip install --no-cache-dir torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt requirements-build.txt ./
RUN pip install --no-cache-dir -r requirements-build.txt
RUN pip install --no-cache-dir --no-deps "git+https://github.com/ChaoningZhang/MobileSAM.git@f706ad9c4eb7f219c00d9050e46328518ffb65d2"
RUN curl -fL --retry 3 -o mobile_sam.pt https://github.com/ChaoningZhang/MobileSAM/raw/f706ad9c4eb7f219c00d9050e46328518ffb65d2/weights/mobile_sam.pt
COPY export_onnx.py ./
RUN python export_onnx.py mobile_sam.pt /build/onnx

# Never copy the exporter's torch, torchvision or timm into the web service.
FROM python:3.11-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import importlib.util; assert importlib.util.find_spec('torch') is None"
COPY --from=exporter /build/onnx /app/onnx
COPY app.py frame.py model.py onnx_predictor.py schemas.py verify_real_inference.py ./
ENV VISION_RUNTIME=onnx MOBILESAM_ONNX_DIR=/app/onnx MALLOC_ARENA_MAX=2 MALLOC_TRIM_THRESHOLD_=131072 MALLOC_MMAP_THRESHOLD_=131072
# Gate the actual Linux runtime, not a mock: fail the build above 450 MiB.
RUN python -c "from PIL import Image; Image.effect_noise((1536,2048),64).convert('RGB').save('/tmp/inference-check.jpg')" \
    && python verify_real_inference.py /tmp/inference-check.jpg --repeat 3 --max-peak-mb 450 \
    && rm /tmp/inference-check.jpg
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && addgroup --system vision && adduser --system --ingroup vision vision \
    && chown -R vision:vision /app
USER vision
EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
