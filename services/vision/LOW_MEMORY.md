# MobileSAM low-memory runtime

The previous 1024px/one-worker fix was insufficient: Render's 512 MiB instance
reached 410 MiB before decoding and was killed during `/prepare` embedding.
`/ready` alone is not an inference or memory test.

Docker now exports the pinned MobileSAM checkpoint to FP32 ONNX at build time.
The final service contains neither torch nor torchvision. Convolution and
token-wise MLP bands bound temporary allocations without changing attention,
weights, 1024px encoder geometry, prompt coordinates or output mask dimensions.
Export checks each banded block against the original, verifies both graphs,
and compares their numerical outputs. No quantization is applied.

Before deploying, Docker runs three real inference cycles on Linux and fails
if the complete Python process peak exceeds 450 MiB. This is a regression gate,
not a guarantee for every image or unrelated OpenCV/calibration operation.
One worker and the existing serialization, session limits and input guards remain.

Local macOS ARM64 validation with a real 2048px working JPEG from the user's
original: five cycles, 417.8 MiB peak, no torch imported. Compared with original
PyTorch 2.2.2: embedding max absolute error 3.10e-6; three mask IoUs
0.99998553, 1.0, 1.0; score max error 7.16e-7.
These figures are local measurements, not Render measurements.

Reproduce with `VISION_RUNTIME=onnx MOBILESAM_ONNX_DIR=/path/to/onnx python
verify_real_inference.py working.jpg --repeat 5 --max-peak-mb 450`.
Use `--prepare-fixture working.jpg` in a separate process to reproduce the
browser's bounded JPEG, preserving the original file.

The annotation editor polls readiness for a bounded cold start before sending
the image, stops the busy state on failure, and offers retry with existing
points. It does not blindly repeat inference requests after a failure.

Final acceptance still requires `/prepare` and `/segment` success with the
real photo on Render, and inspecting the returned mask in the application.
Local tests do not establish scientific identification or measurement validity.
