"""MobileSAM model loader, session manager and inference."""
from __future__ import annotations

import base64
import io
import logging
import secrets
import threading
import time
from collections import OrderedDict
from typing import TYPE_CHECKING

import numpy as np
import cv2
from PIL import Image, ImageOps

try:
    import torch
except ImportError:  # Allows validation/rectification tests without the model runtime.
    torch = None  # type: ignore[assignment]

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

MAX_SESSIONS = 3
SESSION_TTL_SECONDS = 15 * 60  # 15 minutes
MAX_IMAGE_DIMENSION = 2048
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB
ACCEPTED_MIMES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MODEL_NAME = "MobileSAM vit_t"
MODEL_VERSION: str | None = None

_model_lock = threading.Lock()
_inference_lock = threading.Lock()
_sessions_lock = threading.Lock()

# Shared MobileSAM predictor (loaded once)
_predictor: object | None = None
_model_loaded: bool = False


def _load_mobilesam(checkpoint_path: str) -> object:
    """Load MobileSAM and return a SamPredictor."""
    if torch is None:
        raise RuntimeError("PyTorch is not installed.")
    from mobile_sam import SamPredictor, sam_model_registry  # type: ignore[import]

    model = sam_model_registry["vit_t"](checkpoint=checkpoint_path)
    model.eval()
    model.to("cpu")
    predictor = SamPredictor(model)
    return predictor


def load_model(checkpoint_path: str) -> None:
    """Load the model into the global singleton. Thread-safe."""
    global _predictor, _model_loaded
    with _model_lock:
        if _model_loaded:
            return
        logger.info("Loading MobileSAM vit_t from %s …", checkpoint_path)
        started = time.monotonic()
        try:
            _predictor = _load_mobilesam(checkpoint_path)
        except Exception:
            logger.exception("MobileSAM vit_t failed to load after %.1f s.", time.monotonic() - started)
            raise
        _model_loaded = True
        logger.info("MobileSAM vit_t loaded on CPU in %.1f s.", time.monotonic() - started)


def is_model_loaded() -> bool:
    return _model_loaded


def automatic_segment_image(image_rgb: np.ndarray) -> list[dict]:
    """Generate automatic MobileSAM candidates from a fixed, reproducible prompt grid."""
    if not _model_loaded or _predictor is None:
        raise RuntimeError("Model not loaded.")
    original_height, original_width = image_rgb.shape[:2]
    image_pil = _resize_proportional(Image.fromarray(image_rgb), MAX_IMAGE_DIMENSION)
    resized = np.asarray(image_pil)
    width, height = image_pil.size
    candidates: list[dict] = []
    with _inference_lock:
        _predictor.set_image(resized)  # type: ignore[union-attr]
        for row in range(5):
            for column in range(2):
                point_coords = np.array(
                    [[(column + 0.5) / 2 * width, (row + 0.5) / 5 * height]],
                    dtype=np.float32,
                )
                if torch is None:
                    raise RuntimeError("PyTorch is not installed.")
                with torch.inference_mode():
                    masks, scores, _ = _predictor.predict(  # type: ignore[union-attr]
                        point_coords=point_coords,
                        point_labels=np.array([1], dtype=np.int32),
                        multimask_output=True,
                    )
                selected = int(np.argmax(scores))
                mask = masks[selected].astype(np.uint8)
                if mask.shape != (original_height, original_width):
                    mask = cv2.resize(mask, (original_width, original_height), interpolation=cv2.INTER_NEAREST)
                candidates.append({"mask": mask.astype(bool), "score": float(scores[selected])})
    return candidates


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

class _Session:
    __slots__ = ("session_id", "predictor_state", "width", "height", "created_at", "last_used")

    def __init__(self, session_id: str, predictor_state: object, width: int, height: int) -> None:
        self.session_id = session_id
        self.predictor_state = predictor_state  # numpy image stored in predictor
        self.width = width
        self.height = height
        self.created_at = time.monotonic()
        self.last_used = time.monotonic()


# OrderedDict maintains insertion order; we evict LRU
_sessions: OrderedDict[str, _Session] = OrderedDict()


def _evict_expired() -> None:
    now = time.monotonic()
    expired = [sid for sid, sess in _sessions.items() if now - sess.last_used > SESSION_TTL_SECONDS]
    for sid in expired:
        _sessions.pop(sid, None)
        logger.info("Session %s expired (TTL).", sid)


def _evict_lru_if_full() -> None:
    while len(_sessions) >= MAX_SESSIONS:
        oldest_key, _ = next(iter(_sessions.items()))
        _sessions.pop(oldest_key)
        logger.info("Evicted LRU session %s.", oldest_key)


def _open_image_bytes(data: bytes, mime: str) -> Image.Image:
    """Decode image bytes to a PIL RGB image. Handles HEIC/HEIF via pillow-heif."""
    if mime in ("image/heic", "image/heif"):
        try:
            from pillow_heif import register_heif_opener  # type: ignore[import]
            register_heif_opener()
        except ImportError as exc:
            raise ValueError("pillow-heif not installed; cannot decode HEIC/HEIF.") from exc

    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def _resize_proportional(image: Image.Image, max_dim: int) -> Image.Image:
    w, h = image.size
    largest = max(w, h)
    if largest <= max_dim:
        return image
    scale = max_dim / largest
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    return image.resize((new_w, new_h), Image.LANCZOS)


def _strip_exif(image: Image.Image) -> Image.Image:
    """Return a copy of the image with all EXIF metadata removed."""
    clean = Image.new(image.mode, image.size)
    clean.putdata(list(image.getdata()))
    return clean


def prepare_session(image_bytes: bytes, mime: str) -> tuple[str, int, int, float]:
    """
    Validate, decode, resize, set image on predictor.

    Returns (session_id, width, height, prepare_ms).
    Raises ValueError for invalid input.
    """
    if not _model_loaded or _predictor is None:
        raise RuntimeError("Model not loaded.")

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds 20 MB limit.")

    mime_lower = mime.split(";")[0].strip().lower()
    if mime_lower not in ACCEPTED_MIMES:
        raise ValueError(f"Unsupported MIME type: {mime_lower}")

    t0 = time.perf_counter()

    image_pil = _open_image_bytes(image_bytes, mime_lower)
    image_pil = _resize_proportional(image_pil, MAX_IMAGE_DIMENSION)
    image_pil = _strip_exif(image_pil)
    image_np = np.asarray(image_pil)  # HxWx3 uint8 RGB

    width, height = image_pil.size  # PIL: (w, h)

    with _inference_lock:
        _predictor.set_image(image_np)  # type: ignore[union-attr]
        # Capture the internal feature state (stored inside the predictor object)
        # We keep a reference so we can restore it per-session.
        # MobileSAM/SAM predictor stores features in attributes; copy them.
        features = _capture_predictor_features(_predictor)

    t1 = time.perf_counter()
    prepare_ms = (t1 - t0) * 1000.0

    session_id = secrets.token_urlsafe(24)

    with _sessions_lock:
        _evict_expired()
        _evict_lru_if_full()
        _sessions[session_id] = _Session(session_id, features, width, height)

    return session_id, width, height, prepare_ms


def segment_session(
    session_id: str,
    points: list[dict],  # [{"x": float, "y": float, "label": int}, ...]
) -> tuple[list[dict], int, float]:
    """
    Run MobileSAM predictor.predict for given points.

    Returns (candidates, recommended_index, segment_ms).
    Each candidate includes its in-memory PNG, dimensions, score, area and model metadata.
    """
    if not _model_loaded or _predictor is None:
        raise RuntimeError("Model not loaded.")

    with _sessions_lock:
        _evict_expired()
        session = _sessions.get(session_id)
        if session is None:
            raise KeyError(f"Session {session_id!r} not found or expired.")
        session.last_used = time.monotonic()
        features = session.predictor_state
        width = session.width
        height = session.height

    t0 = time.perf_counter()

    with _inference_lock:
        _restore_predictor_features(_predictor, features)

        point_coords = np.array([[p["x"] * width, p["y"] * height] for p in points], dtype=np.float32)
        point_labels = np.array([p["label"] for p in points], dtype=np.int32)

        if torch is None:
            raise RuntimeError("PyTorch is not installed.")
        with torch.inference_mode():
            masks, scores, _ = _predictor.predict(  # type: ignore[union-attr]
                point_coords=point_coords,
                point_labels=point_labels,
                multimask_output=True,
            )
        # masks: (3, H, W) bool numpy, scores: (3,) float numpy

    t1 = time.perf_counter()
    segment_ms = (t1 - t0) * 1000.0

    # Build candidates
    candidates = []
    for i in range(masks.shape[0]):
        mask_bool = masks[i]  # H×W bool
        data_url = _mask_to_png_data_url(mask_bool)
        mask_height, mask_width = mask_bool.shape
        candidates.append({
            "id": f"{session_id}-{i}",
            "score": float(scores[i]),
            "maskDataUrl": data_url,
            "width": mask_width,
            "height": mask_height,
            "areaPixels": int(np.count_nonzero(mask_bool)),
            "modelName": MODEL_NAME,
            "modelVersion": MODEL_VERSION,
        })

    # Recommended = highest IoU score
    recommended_index = int(np.argmax(scores))

    return candidates, recommended_index, segment_ms


def delete_session(session_id: str) -> None:
    with _sessions_lock:
        _sessions.pop(session_id, None)


# ---------------------------------------------------------------------------
# Predictor feature capture / restore helpers
# ---------------------------------------------------------------------------

def _capture_predictor_features(predictor: object) -> dict:
    """Shallow-copy the image-embedding tensors from predictor."""
    state: dict = {}
    for attr in ("features", "original_size", "input_size", "is_image_set"):
        val = getattr(predictor, attr, None)
        if torch is not None and isinstance(val, torch.Tensor):
            state[attr] = val.clone()
        else:
            state[attr] = val
    return state


def _restore_predictor_features(predictor: object, state: dict) -> None:
    """Restore previously captured feature state into predictor."""
    for attr, val in state.items():
        if torch is not None and isinstance(val, torch.Tensor):
            setattr(predictor, attr, val.clone())
        else:
            setattr(predictor, attr, val)


# ---------------------------------------------------------------------------
# Mask → PNG data URL
# ---------------------------------------------------------------------------

def _mask_to_png_data_url(mask_bool: np.ndarray) -> str:
    """Encode a boolean mask as a compact grayscale PNG data URL (white=1, black=0)."""
    h, w = mask_bool.shape
    pixels = (mask_bool.astype(np.uint8) * 255)
    image = Image.fromarray(pixels, mode="L")

    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("ascii")
    return f"data:image/png;base64,{b64}"
