"""Reproducible zero-shot baseline.

Documented, fixed procedure — no tuned thresholds, no invented confidence:

1. every label in `LABELS` is rendered with every template in
   `PROMPT_TEMPLATES`, producing 3 x 2 = 6 prompts in a fixed order;
2. each prompt is encoded and L2-normalised;
3. the prompts of a label are averaged and the average is L2-normalised again
   (standard open_clip prompt ensembling);
4. the score of a crop for a label is the cosine similarity between the
   L2-normalised crop embedding and that label embedding.

The resulting numbers are RAW SCORES. They are not probabilities, they are not
calibrated, and they are never compared against a certainty threshold. The
worker only ranks the three labels and returns the ordered raw scores; the human
reviewer decides. A suggestion is always returned as `pending`.

The evidence available so far (64 training photographs, 16 held-out photographs
with only 2 bark negatives, 20 regression photographs, and a known false
positive on a control crop without lichen) is far too small to claim general
accuracy, and it was collected on whole photographs, not on MobileSAM crops.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from constants import LABELS, PROMPT_TEMPLATES


@dataclass(frozen=True)
class LabelScore:
    label: str
    raw_score: float


def build_prompts() -> list[str]:
    """The 6 prompts, label-major, in a fixed reproducible order."""

    return [template.format(label=label) for label in LABELS for template in PROMPT_TEMPLATES]


def aggregate_prompt_embeddings(prompt_embeddings: np.ndarray) -> np.ndarray:
    """Average the per-label prompt embeddings and re-normalise them."""

    features = np.asarray(prompt_embeddings, dtype=np.float32)
    templates = len(PROMPT_TEMPLATES)
    expected = len(LABELS) * templates
    if features.ndim != 2 or features.shape[0] != expected:
        raise ValueError(f"Se esperaban {expected} embeddings de prompt.")
    grouped = features.reshape(len(LABELS), templates, features.shape[1]).mean(axis=1)
    norms = np.linalg.norm(grouped, axis=1, keepdims=True)
    if np.any(norms == 0) or not np.all(np.isfinite(norms)):
        raise ValueError("La agregación de prompts produjo un vector degenerado.")
    return grouped / norms


def cosine_scores(image_embeddings: np.ndarray, label_embeddings: np.ndarray) -> np.ndarray:
    """Cosine similarity between L2-normalised embeddings: a plain dot product."""

    images = np.asarray(image_embeddings, dtype=np.float32)
    if images.ndim == 1:
        images = images[None, :]
    labels = np.asarray(label_embeddings, dtype=np.float32)
    if images.shape[1] != labels.shape[1]:
        raise ValueError("Las dimensiones de imagen y texto no coinciden.")
    return images @ labels.T


def rank_scores(scores: np.ndarray, labels: tuple[str, ...] = LABELS) -> list[LabelScore]:
    """Order one row of raw scores from highest to lowest. No thresholds."""

    row = np.asarray(scores, dtype=np.float32).reshape(-1)
    if row.shape[0] != len(labels):
        raise ValueError("El número de puntuaciones no coincide con el de etiquetas.")
    if not np.all(np.isfinite(row)):
        raise ValueError("Las puntuaciones contienen valores no finitos.")
    ordered = sorted(
        (LabelScore(label=label, raw_score=float(value)) for label, value in zip(labels, row)),
        key=lambda item: item.raw_score,
        reverse=True,
    )
    return ordered
