"""MobileSAM model loader, session manager and inference."""
from __future__ import annotations

import base64
import ctypes
import gc
import io
import logging
import os
import secrets
import threading
import time
from contextlib import nullcontext
from collections import OrderedDict

import numpy as np
import cv2
from PIL import Image, ImageOps

torch = None
if os.environ.get("VISION_RUNTIME", "torch") != "onnx":
    try:
        import torch
    except ImportError:  # Allows validation/rectification tests without the model runtime.
        pass

logger = logging.getLogger(__name__)

MAX_SESSIONS = 3
SESSION_TTL_SECONDS = 15 * 60  # 15 minutes
MAX_OUTPUT_DIMENSION = 2048
MAX_MODEL_DIMENSION = 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_DECODED_PIXELS = 20_000_000
ACCEPTED_MIMES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MODEL_NAME = "MobileSAM vit_t"
MODEL_VERSION: str | None = None

_model_lock = threading.Lock()
_inference_lock = threading.Lock()
_sessions_lock = threading.Lock()

# Shared MobileSAM predictor (loaded once)
_predictor: object | None = None
_model_loaded: bool = False


def current_rss_mb() -> float:
    """Return the process resident set size without adding a runtime dependency."""
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        with open("/proc/self/statm", encoding="ascii") as status:
            resident_pages = int(status.read().split()[1])
        return resident_pages * page_size / (1024 * 1024)
    except (OSError, ValueError, IndexError):
        try:
            import psutil
            return psutil.Process().memory_info().rss / (1024 * 1024)
        except ImportError:
            return 0.0


def log_rss(stage: str) -> None:
    logger.info("Memory RSS [%s]: %.1f MB", stage, current_rss_mb())


def release_unused_memory() -> None:
    """Release unreachable Python objects and return free glibc pages when possible."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (AttributeError, OSError):
        pass


def _release_predictor_image(predictor: object) -> None:
    reset_image = getattr(predictor, "reset_image", None)
    if callable(reset_image):
        reset_image()
        return
    for attr, value in (
        ("features", None),
        ("original_size", None),
        ("input_size", None),
        ("is_image_set", False),
    ):
        setattr(predictor, attr, value)


def _load_mobilesam(checkpoint_path: str) -> object:
    """Load MobileSAM and return a SamPredictor."""
    if os.environ.get("VISION_RUNTIME", "torch") == "onnx":
        from onnx_predictor import OnnxPredictor
        return OnnxPredictor(os.environ.get("MOBILESAM_ONNX_DIR", "/app/onnx"))
    if torch is None:
        raise RuntimeError("PyTorch is not installed.")
    from mobile_sam import SamPredictor, sam_model_registry  # type: ignore[import]

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
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
        logger.info("Loading MobileSAM vit_t (%s) …", os.environ.get("VISION_RUNTIME", "torch"))
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
    image_pil = _resize_proportional(Image.fromarray(image_rgb), MAX_MODEL_DIMENSION)
    resized = np.asarray(image_pil)
    width, height = image_pil.size
    candidates: list[dict] = []
    log_rss("automatic inference before embedding")
    with _inference_lock:
        try:
            with torch.inference_mode() if torch is not None else nullcontext():
                _predictor.set_image(resized)  # type: ignore[union-attr]
                log_rss("automatic inference after embedding")
                for row in range(5):
                    for column in range(2):
                        point_coords = np.array(
                            [[(column + 0.5) / 2 * width, (row + 0.5) / 5 * height]],
                            dtype=np.float32,
                        )
                        point_labels = np.array([1], dtype=np.int32)
                        masks, scores, logits = _predictor.predict(  # type: ignore[union-attr]
                            point_coords=point_coords,
                            point_labels=point_labels,
                            multimask_output=True,
                        )
                        selected = int(np.argmax(scores))
                        mask = masks[selected].astype(np.uint8)
                        if mask.shape != (original_height, original_width):
                            mask = cv2.resize(mask, (original_width, original_height), interpolation=cv2.INTER_NEAREST)
                        candidates.append({"mask": mask.astype(bool), "score": float(scores[selected])})
                        del logits, masks, scores, point_coords, point_labels, mask
        finally:
            _release_predictor_image(_predictor)
            release_unused_memory()
            log_rss("automatic inference after cleanup")
    return candidates


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

class _Session:
    __slots__ = (
        "session_id",
        "predictor_state",
        "width",
        "height",
        "model_width",
        "model_height",
        "created_at",
        "last_used",
    )

    def __init__(
        self,
        session_id: str,
        predictor_state: object,
        width: int,
        height: int,
        model_width: int,
        model_height: int,
    ) -> None:
        self.session_id = session_id
        self.predictor_state = predictor_state  # numpy image stored in predictor
        self.width = width
        self.height = height
        self.model_width = model_width
        self.model_height = model_height
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
        oldest_key, _ = _sessions.popitem(last=False)
        logger.info("Evicted LRU session %s.", oldest_key)


def _open_image_bytes(data: bytes, mime: str) -> Image.Image:
    """Decode image bytes to a PIL RGB image. Handles HEIC/HEIF via pillow-heif."""
    if mime in ("image/heic", "image/heif"):
        try:
            from pillow_heif import register_heif_opener  # type: ignore[import]
            register_heif_opener()
        except ImportError as exc:
            raise ValueError("pillow-heif not installed; cannot decode HEIC/HEIF.") from exc

    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > MAX_DECODED_PIXELS:
            raise ValueError("Decoded image is too large.")
        if mime == "image/jpeg":
            source.draft("RGB", (MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION))
        ImageOps.exif_transpose(source, in_place=True)
        source.thumbnail(
            (MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION),
            Image.Resampling.LANCZOS,
            reducing_gap=3.0,
        )
        image = source if source.mode == "RGB" else source.convert("RGB")
        image.load()
        return image.copy()


def _resize_proportional(image: Image.Image, max_dim: int) -> Image.Image:
    w, h = image.size
    largest = max(w, h)
    if largest <= max_dim:
        return image
    scale = max_dim / largest
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    return image.resize((new_w, new_h), Image.LANCZOS)


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

    with _sessions_lock:
        _evict_expired()
        _evict_lru_if_full()

    log_rss("prepare before decode")
    image_pil = _open_image_bytes(image_bytes, mime_lower)
    width, height = image_pil.size  # PIL: (w, h)
    model_pil = _resize_proportional(image_pil, MAX_MODEL_DIMENSION)
    model_width, model_height = model_pil.size
    image_np = np.asarray(model_pil)  # HxWx3 uint8 RGB
    log_rss("prepare before embedding")

    with _inference_lock:
        try:
            with torch.inference_mode() if torch is not None else nullcontext():
                _predictor.set_image(image_np)  # type: ignore[union-attr]
                features = _capture_predictor_features(_predictor)
                log_rss("prepare after embedding")
        finally:
            _release_predictor_image(_predictor)

    t1 = time.perf_counter()
    prepare_ms = (t1 - t0) * 1000.0

    session_id = secrets.token_urlsafe(24)

    with _sessions_lock:
        _evict_expired()
        _evict_lru_if_full()
        _sessions[session_id] = _Session(
            session_id,
            features,
            width,
            height,
            model_width,
            model_height,
        )

    del image_np, model_pil, image_pil
    release_unused_memory()
    log_rss("prepare after cleanup")
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
        model_width = session.model_width
        model_height = session.model_height

    t0 = time.perf_counter()
    log_rss("segment before inference")

    with _inference_lock:
        try:
            _restore_predictor_features(_predictor, features)
            point_coords = np.array(
                [[p["x"] * model_width, p["y"] * model_height] for p in points],
                dtype=np.float32,
            )
            point_labels = np.array([p["label"] for p in points], dtype=np.int32)

            with torch.inference_mode() if torch is not None else nullcontext():
                masks, scores, logits = _predictor.predict(  # type: ignore[union-attr]
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=True,
                )
                log_rss("segment after inference")
            del logits, point_coords, point_labels
        finally:
            _release_predictor_image(_predictor)
        # masks: (3, H, W) bool numpy, scores: (3,) float numpy

    t1 = time.perf_counter()
    segment_ms = (t1 - t0) * 1000.0

    # Build candidates
    candidates = []
    for i in range(masks.shape[0]):
        mask_bool = masks[i]  # H×W bool
        if mask_bool.shape != (height, width):
            mask_bool = cv2.resize(
                mask_bool.astype(np.uint8),
                (width, height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
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
        del mask_bool

    # Recommended = highest IoU score
    recommended_index = int(np.argmax(scores))

    del masks, scores
    release_unused_memory()
    log_rss("segment after cleanup")
    return candidates, recommended_index, segment_ms


def delete_session(session_id: str) -> None:
    with _sessions_lock:
        _sessions.pop(session_id, None)
    release_unused_memory()


# ---------------------------------------------------------------------------
# Predictor feature capture / restore helpers
# ---------------------------------------------------------------------------

def _capture_predictor_features(predictor: object) -> dict:
    """Retain one image embedding without duplicating its tensors."""
    state: dict = {}
    for attr in ("features", "original_size", "input_size", "is_image_set"):
        val = getattr(predictor, attr, None)
        state[attr] = val
    return state


def _restore_predictor_features(predictor: object, state: dict) -> None:
    """Restore previously captured feature state without duplicating tensors."""
    for attr, val in state.items():
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
