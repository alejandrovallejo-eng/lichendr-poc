"""Optional loader for the reviewer's trained linear head.

The trained head lives ONLY on the reviewer's Mac. It is not in this repository
and it is not accessible to the agent that wrote this code, so nothing here
fabricates weights or claims that a head has been integrated. The worker runs
zero-shot without it and always records which backend produced a suggestion.

Real artefact contract, verified by the reviewer on the local file:

    weights       float, shape (d, 3)      d = 768 for BioCLIP 2
    feature_mean  float, shape (d,)
    intercept     float, shape (3,)
    centroids     float, shape (3, d)
    labels        3 strings, ['lichen', 'moss', 'bark'] in that order

Embeddings are L2-normalised before use, and:

    ridge_scores    = (X - feature_mean) @ weights + intercept
    centroid_scores = X @ centroids.T

Both are raw scores. They are NOT probabilities and are never turned into one.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from constants import ENCODER_EMBED_DIM, HEAD_LABELS

REQUIRED_KEYS = ("weights", "feature_mean", "intercept", "centroids", "labels")
CLASS_COUNT = len(HEAD_LABELS)
MAX_HEAD_BYTES = 32 * 1024 * 1024


class HeadValidationError(ValueError):
    """Raised when an NPZ file does not match the documented contract."""


@dataclass(frozen=True)
class TrainedHead:
    """A validated linear head. Immutable once loaded."""

    weights: np.ndarray
    feature_mean: np.ndarray
    intercept: np.ndarray
    centroids: np.ndarray
    labels: tuple[str, ...]
    embed_dim: int
    sha256: str
    path: str

    def ridge_scores(self, embeddings: np.ndarray) -> np.ndarray:
        features = _as_batch(embeddings, self.embed_dim)
        return (features - self.feature_mean) @ self.weights + self.intercept

    def centroid_scores(self, embeddings: np.ndarray) -> np.ndarray:
        features = _as_batch(embeddings, self.embed_dim)
        return features @ self.centroids.T


def sha256_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_trained_head(
    path: str | Path,
    *,
    encoder_embed_dim: int = ENCODER_EMBED_DIM,
    expected_sha256: str | None = None,
) -> TrainedHead:
    """Load and strictly validate an NPZ head. Never executes pickled objects."""

    head_path = Path(path).expanduser()
    if not head_path.is_file():
        raise HeadValidationError(f"El archivo de cabeza no existe: {head_path}")
    size = head_path.stat().st_size
    if size <= 0 or size > MAX_HEAD_BYTES:
        raise HeadValidationError("El archivo de cabeza tiene un tamaño inaceptable.")

    digest = sha256_of_file(head_path)
    if expected_sha256 is not None and digest.lower() != expected_sha256.strip().lower():
        raise HeadValidationError("El SHA-256 de la cabeza no coincide con el esperado.")

    try:
        # allow_pickle=False: an NPZ is untrusted input and must never be able to
        # execute code while being read.
        with np.load(head_path, allow_pickle=False) as archive:
            keys = set(archive.files)
            missing = [key for key in REQUIRED_KEYS if key not in keys]
            if missing:
                raise HeadValidationError(f"Faltan claves en la cabeza: {', '.join(missing)}")
            unexpected = sorted(keys - set(REQUIRED_KEYS))
            if unexpected:
                raise HeadValidationError(
                    f"La cabeza contiene claves desconocidas: {', '.join(unexpected)}",
                )
            raw = {key: archive[key] for key in REQUIRED_KEYS}
    except HeadValidationError:
        raise
    except Exception as error:  # noqa: BLE001 - any parse failure is a rejection
        raise HeadValidationError("El archivo de cabeza no es un NPZ legible sin pickle.") from error

    labels = _validate_labels(raw["labels"])
    weights = _numeric(raw["weights"], "weights")
    feature_mean = _numeric(raw["feature_mean"], "feature_mean")
    intercept = _numeric(raw["intercept"], "intercept")
    centroids = _numeric(raw["centroids"], "centroids")

    if weights.ndim != 2 or weights.shape[1] != CLASS_COUNT:
        raise HeadValidationError("`weights` debe tener forma (d, 3).")
    embed_dim = int(weights.shape[0])
    if embed_dim != encoder_embed_dim:
        raise HeadValidationError(
            f"La cabeza fue entrenada con d={embed_dim}; el encoder produce {encoder_embed_dim}.",
        )
    if feature_mean.shape != (embed_dim,):
        raise HeadValidationError("`feature_mean` debe tener forma (d,).")
    if intercept.shape != (CLASS_COUNT,):
        raise HeadValidationError("`intercept` debe tener forma (3,).")
    if centroids.shape != (CLASS_COUNT, embed_dim):
        raise HeadValidationError("`centroids` debe tener forma (3, d).")

    return TrainedHead(
        weights=weights,
        feature_mean=feature_mean,
        intercept=intercept,
        centroids=centroids,
        labels=labels,
        embed_dim=embed_dim,
        sha256=digest,
        path=str(head_path),
    )


def _validate_labels(value: np.ndarray) -> tuple[str, ...]:
    if value.ndim != 1 or value.shape[0] != CLASS_COUNT:
        raise HeadValidationError("`labels` debe contener exactamente 3 clases.")
    if value.dtype.kind not in {"U", "S"}:
        raise HeadValidationError("`labels` debe contener texto.")
    labels = tuple(
        item.decode("utf-8") if isinstance(item, bytes) else str(item) for item in value.tolist()
    )
    if labels != HEAD_LABELS:
        raise HeadValidationError(
            "`labels` debe ser exactamente ['lichen', 'moss', 'bark'] en ese orden; "
            f"se recibió {list(labels)}.",
        )
    return labels


def _numeric(value: np.ndarray, name: str) -> np.ndarray:
    if value.dtype.kind not in {"f", "i", "u"}:
        raise HeadValidationError(f"`{name}` debe ser numérico.")
    array = np.asarray(value, dtype=np.float32)
    if not np.all(np.isfinite(array)):
        raise HeadValidationError(f"`{name}` contiene valores no finitos.")
    return array


def _as_batch(embeddings: np.ndarray, embed_dim: int) -> np.ndarray:
    features = np.asarray(embeddings, dtype=np.float32)
    if features.ndim == 1:
        features = features[None, :]
    if features.ndim != 2 or features.shape[1] != embed_dim:
        raise HeadValidationError("Los embeddings no coinciden con la dimensión de la cabeza.")
    if not np.all(np.isfinite(features)):
        raise HeadValidationError("Los embeddings contienen valores no finitos.")
    return features
