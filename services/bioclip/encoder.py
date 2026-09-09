"""Frozen BioCLIP 2 encoder, loaded once from verified local files.

The encoder is never downloaded here: `download_model.py` must have run first
and the weights are re-verified (size + SHA-256) before they are loaded. The
architecture comes from the official `open_clip_config.json` shipped with the
checkpoint; no remote code is fetched or executed.

Two preprocessing pipelines are available and the one used is recorded with
every result:

``whole_crop_pad`` (default)
    The whole crop is resized preserving its aspect ratio and padded to a
    square. Nothing is cut, so a lichen patch touching the edge of a region is
    never lost — which is exactly what an accidental centre crop would do.

``standard_center_crop``
    The stock CLIP transform (resize shortest side + centre crop). It is kept
    because the reviewer's trained head was fitted on photographs preprocessed
    this way; a head must be evaluated with the pipeline it was trained with.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from constants import (
    ENCODER_ARCHITECTURE,
    ENCODER_MICROBATCH_SIZE,
    ENCODER_CONFIG_FILENAME,
    ENCODER_EMBED_DIM,
    ENCODER_ID,
    ENCODER_WEIGHTS_BYTES,
    ENCODER_WEIGHTS_FILENAME,
    ENCODER_WEIGHTS_SHA256,
)
from head import sha256_of_file

PREPROCESS_MODES = ("whole_crop_pad", "standard_center_crop")
DEFAULT_IMAGE_SIZE = 224
OPENAI_MEAN = (0.48145466, 0.4578275, 0.40821073)
OPENAI_STD = (0.26862954, 0.26130258, 0.27577711)
PAD_COLOR = (124, 116, 104)  # OPENAI_MEAN in 8-bit, i.e. a neutral pad.

_lock = threading.Lock()
_loaded: "LoadedEncoder | None" = None


class EncoderUnavailable(RuntimeError):
    """Raised when the encoder cannot be loaded from local, verified files."""


@dataclass
class LoadedEncoder:
    model: object
    tokenizer: object
    image_size: int
    embed_dim: int
    weights_sha256: str
    encoder_id: str = ENCODER_ID


def verify_local_encoder(directory: Path) -> str:
    """Verify the pinned weights on disk and return their digest."""

    weights = Path(directory).expanduser() / ENCODER_WEIGHTS_FILENAME
    if not weights.is_file():
        raise EncoderUnavailable(
            f"Faltan los pesos del encoder en {weights}. Ejecuta download_model.py primero.",
        )
    size = weights.stat().st_size
    if size != ENCODER_WEIGHTS_BYTES:
        raise EncoderUnavailable(
            f"El encoder mide {size} bytes; se esperaban {ENCODER_WEIGHTS_BYTES}.",
        )
    digest = sha256_of_file(weights)
    if digest != ENCODER_WEIGHTS_SHA256:
        raise EncoderUnavailable("El SHA-256 del encoder no coincide con la revisión fijada.")
    return digest


def load_encoder(directory: str | Path) -> LoadedEncoder:
    """Load the encoder once per process. Subsequent calls reuse it."""

    global _loaded
    with _lock:
        if _loaded is not None:
            return _loaded

        path = Path(directory).expanduser()
        digest = verify_local_encoder(path)

        try:
            import open_clip  # noqa: PLC0415 - heavy import, only when enabled
            import torch  # noqa: PLC0415
        except ImportError as error:  # pragma: no cover - depends on local env
            raise EncoderUnavailable(
                "Faltan torch/open_clip. Instala services/bioclip/requirements.txt.",
            ) from error

        config_path = path / ENCODER_CONFIG_FILENAME
        image_size = DEFAULT_IMAGE_SIZE
        if config_path.is_file():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            model_cfg = config.get("model_cfg", {})
            embed_dim = int(model_cfg.get("embed_dim", ENCODER_EMBED_DIM))
            if embed_dim != ENCODER_EMBED_DIM:
                raise EncoderUnavailable(
                    f"El config declara embed_dim={embed_dim}; se esperaba {ENCODER_EMBED_DIM}.",
                )
            vision_cfg = model_cfg.get("vision_cfg", {})
            declared_size = vision_cfg.get("image_size", image_size)
            if isinstance(declared_size, (list, tuple)):
                declared_size = declared_size[0]
            image_size = int(declared_size)

        model = open_clip.create_model(
            ENCODER_ARCHITECTURE,
            pretrained=str(path / ENCODER_WEIGHTS_FILENAME),
        )
        model.eval()
        for parameter in model.parameters():
            parameter.requires_grad_(False)
        torch.set_grad_enabled(False)

        tokenizer = open_clip.get_tokenizer(ENCODER_ARCHITECTURE)
        _loaded = LoadedEncoder(
            model=model,
            tokenizer=tokenizer,
            image_size=image_size,
            embed_dim=ENCODER_EMBED_DIM,
            weights_sha256=digest,
        )
        return _loaded


def preprocess_crop(image: Image.Image, mode: str, image_size: int) -> np.ndarray:
    """Return a CHW float32 tensor for one crop, without losing its extremes."""

    if mode not in PREPROCESS_MODES:
        raise ValueError(f"Unknown preprocessing mode: {mode}")
    rgb = image.convert("RGB")
    if mode == "whole_crop_pad":
        width, height = rgb.size
        scale = image_size / max(width, height)
        resized = rgb.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.BICUBIC,
        )
        canvas = Image.new("RGB", (image_size, image_size), PAD_COLOR)
        canvas.paste(
            resized,
            ((image_size - resized.width) // 2, (image_size - resized.height) // 2),
        )
        prepared = canvas
    else:
        width, height = rgb.size
        scale = image_size / min(width, height)
        resized = rgb.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.BICUBIC,
        )
        left = (resized.width - image_size) // 2
        top = (resized.height - image_size) // 2
        prepared = resized.crop((left, top, left + image_size, top + image_size))

    array = np.asarray(prepared, dtype=np.float32) / 255.0
    array = (array - np.asarray(OPENAI_MEAN, dtype=np.float32)) / np.asarray(
        OPENAI_STD, dtype=np.float32
    )
    return np.transpose(array, (2, 0, 1))


def l2_normalize(matrix: np.ndarray) -> np.ndarray:
    """L2-normalise the rows of a matrix, as the pilot documents everywhere."""

    features = np.asarray(matrix, dtype=np.float32)
    if features.ndim == 1:
        features = features[None, :]
    norms = np.linalg.norm(features, axis=1, keepdims=True)
    if not np.all(np.isfinite(norms)) or np.any(norms == 0):
        raise ValueError("Un embedding tiene norma cero o no finita.")
    return features / norms


def encode_images(
    encoder: LoadedEncoder,
    crops: list[Image.Image],
    mode: str,
    microbatch_size: int = ENCODER_MICROBATCH_SIZE,
) -> np.ndarray:
    """Encode crops into L2-normalised embeddings (one row per crop).

    The crops are fed to the encoder in microbatches instead of as one whole
    batch: a full request of large regions would otherwise allocate the entire
    preprocessed tensor and its activations at once, and the measured peak of
    this pilot is already around 2.2-3.3 GiB of RSS on CPU.
    """

    import torch  # noqa: PLC0415

    if microbatch_size < 1:
        raise ValueError("El tamaño de microlote debe ser al menos 1.")
    chunks: list[np.ndarray] = []
    for start in range(0, len(crops), microbatch_size):
        window = crops[start : start + microbatch_size]
        batch = np.stack([preprocess_crop(crop, mode, encoder.image_size) for crop in window])
        with torch.inference_mode():
            features = encoder.model.encode_image(torch.from_numpy(batch))
        chunks.append(np.asarray(features.detach().cpu().numpy(), dtype=np.float32))
        del batch, features
    return l2_normalize(np.concatenate(chunks, axis=0))


def encode_texts(encoder: LoadedEncoder, prompts: list[str]) -> np.ndarray:
    """Encode prompts into L2-normalised embeddings (one row per prompt)."""

    import torch  # noqa: PLC0415

    tokens = encoder.tokenizer(prompts)
    with torch.inference_mode():
        features = encoder.model.encode_text(tokens)
    return l2_normalize(features.detach().cpu().numpy())
