"""SamPredictor-compatible FP32 inference without importing torch or torchvision."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


class OnnxPredictor:
    def __init__(self, directory: str) -> None:
        import onnxruntime as ort

        root = Path(directory)
        manifest = json.loads((root / "manifest.json").read_text())
        if manifest.get("format") != 1 or manifest.get("precision") != "float32":
            raise ValueError("Unsupported MobileSAM ONNX manifest")
        for name in ("encoder.onnx", "decoder.onnx"):
            if hashlib.sha256((root / name).read_bytes()).hexdigest() != manifest["files"][name]:
                raise ValueError(f"MobileSAM ONNX checksum mismatch: {name}")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        # Do not retain the encoder's peak allocations in an arena between requests.
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        # Avoid x86 NCHWc layout transforms and per-band packed-weight copies.
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
        options.add_session_config_entry("session.disable_prepacking", "1")
        self.encoder = ort.InferenceSession(str(root / "encoder.onnx"), options, providers=["CPUExecutionProvider"])
        self.decoder = ort.InferenceSession(str(root / "decoder.onnx"), options, providers=["CPUExecutionProvider"])
        self.reset_image()

    def reset_image(self) -> None:
        self.features = None
        self.original_size = None
        self.input_size = None
        self.is_image_set = False

    def set_image(self, image: np.ndarray) -> None:
        self.reset_image()
        height, width = image.shape[:2]
        scale = 1024 / max(height, width)
        resized_height = int(height * scale + 0.5)
        resized_width = int(width * scale + 0.5)
        # Matches SAM ResizeLongestSide / torchvision PIL bilinear preprocessing.
        resized = np.asarray(Image.fromarray(image).resize((resized_width, resized_height), Image.Resampling.BILINEAR), dtype=np.float32)
        resized -= np.array([123.675, 116.28, 103.53], dtype=np.float32)
        resized /= np.array([58.395, 57.12, 57.375], dtype=np.float32)
        tensor = np.zeros((1, 3, 1024, 1024), dtype=np.float32)
        tensor[0, :, :resized_height, :resized_width] = resized.transpose(2, 0, 1)
        del resized
        self.features = self.encoder.run(["embeddings"], {"image": tensor})[0]
        self.original_size = (height, width)
        self.input_size = (resized_height, resized_width)
        self.is_image_set = True

    def predict(self, *, point_coords: np.ndarray, point_labels: np.ndarray, multimask_output: bool = True):
        if not self.is_image_set or self.features is None:
            raise RuntimeError("Call set_image before predict")
        coords = np.array(point_coords, dtype=np.float32, copy=True)
        coords[:, 0] *= self.input_size[1] / self.original_size[1]
        coords[:, 1] *= self.input_size[0] / self.original_size[0]
        # SAM adds a not-a-point token when points are supplied without a box.
        coords = np.concatenate([coords, np.zeros((1, 2), dtype=np.float32)], axis=0)[None]
        labels = np.concatenate([np.asarray(point_labels, dtype=np.float32), [-1]]).astype(np.float32)[None]
        masks, scores, logits = self.decoder.run(None, {
            "image_embeddings": self.features,
            "point_coords": coords,
            "point_labels": labels,
            "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
            "has_mask_input": np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array(self.original_size, dtype=np.float32),
        })
        selection = slice(1, None) if multimask_output else slice(0, 1)
        return masks[0, selection] > 0.0, scores[0, selection], logits[0, selection]
