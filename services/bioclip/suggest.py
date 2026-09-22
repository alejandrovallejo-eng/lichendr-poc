"""Turn crops into reviewable suggestions.

Everything this module returns is a *suggestion pending human review*. It never
accepts a region, never converts a label into a semantic segmentation of the
crop, and never reports a certainty. A region can mix substrates: labelling it
`lichen` does not prove that every pixel inside its mask is lichen, and the
MobileSAM score describes mask quality, not the presence of lichen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
from PIL import Image

from constants import (
    HEAD_LABEL_TO_PROMPT_LABEL,
    LABEL_DISPLAY_ES,
    LABELS,
    PREPROCESS_VERSION,
    SUGGESTION_SCHEMA_VERSION,
    ZEROSHOT_VERSION,
)
from encoder import LoadedEncoder, encode_images, encode_texts
from head import TrainedHead
from experimental import ExperimentalHead, ENCODER_SHA, encode_experimental
from zeroshot import aggregate_prompt_embeddings, build_prompts, cosine_scores, rank_scores


@dataclass(frozen=True)
class RegionSuggestion:
    region_id: str
    # Always `pending`: only a human can accept, exclude or relabel a region.
    status: str
    top_label: str
    top_label_es: str
    ranking: list[dict]
    backend: str


@dataclass(frozen=True)
class SuggestionBatch:
    suggestions: list[RegionSuggestion]
    backend: str
    encoder_id: str
    encoder_sha256: str
    preprocess_mode: str
    head_sha256: str | None = None
    versions: dict = field(default_factory=dict)
    experimental: dict | None = None


_text_cache: dict[str, np.ndarray] = {}


def label_embeddings(encoder: LoadedEncoder) -> np.ndarray:
    """Encode and aggregate the 6 fixed prompts once per process."""

    key = f"{encoder.weights_sha256}:{ZEROSHOT_VERSION}"
    cached = _text_cache.get(key)
    if cached is None:
        cached = aggregate_prompt_embeddings(encode_texts(encoder, build_prompts()))
        _text_cache[key] = cached
    return cached


def suggest(
    encoder: LoadedEncoder,
    crops: Sequence[Image.Image],
    region_ids: Sequence[str],
    *,
    preprocess_mode: str,
    trained_head: TrainedHead | None = None,
    experimental_head: ExperimentalHead | None = None,
) -> SuggestionBatch:
    if len(crops) != len(region_ids):
        raise ValueError("Cada recorte necesita su identificador de región.")
    if not crops:
        return SuggestionBatch(
            suggestions=[],
            backend="zeroshot",
            encoder_id=encoder.encoder_id,
            encoder_sha256=encoder.weights_sha256,
            preprocess_mode=preprocess_mode,
            versions=_versions(),
        )

    if experimental_head is not None and (preprocess_mode != "standard_center_crop" or encoder.weights_sha256 != ENCODER_SHA):
        raise ValueError("Experimental comparison requires its verified encoder and preprocessing")
    embeddings = encode_images(encoder, list(crops), preprocess_mode)

    if trained_head is not None:
        backend = "ridge_head"
        scores = trained_head.ridge_scores(embeddings)
        labels = tuple(HEAD_LABEL_TO_PROMPT_LABEL[label] for label in trained_head.labels)
        head_sha256: str | None = trained_head.sha256
    else:
        backend = "zeroshot"
        scores = cosine_scores(embeddings, label_embeddings(encoder))
        labels = LABELS
        head_sha256 = None

    suggestions: list[RegionSuggestion] = []
    for index, region_id in enumerate(region_ids):
        ranking = rank_scores(scores[index], labels)
        suggestions.append(
            RegionSuggestion(
                region_id=region_id,
                status="pending",
                top_label=ranking[0].label,
                top_label_es=LABEL_DISPLAY_ES[ranking[0].label],
                ranking=[
                    {
                        "label": item.label,
                        "labelEs": LABEL_DISPLAY_ES[item.label],
                        # Raw score. NOT a probability, NOT calibrated.
                        "rawScore": item.raw_score,
                    }
                    for item in ranking
                ],
                backend=backend,
            )
        )

    return SuggestionBatch(
        suggestions=suggestions,
        backend=backend,
        encoder_id=encoder.encoder_id,
        encoder_sha256=encoder.weights_sha256,
        preprocess_mode=preprocess_mode,
        head_sha256=head_sha256,
        versions=_versions(),
        experimental=experimental_head.compare(encode_experimental(encoder, crops), list(region_ids)) if experimental_head is not None else None,
    )


def _versions() -> dict:
    return {
        "schema": SUGGESTION_SCHEMA_VERSION,
        "preprocess": PREPROCESS_VERSION,
        "zeroshot": ZEROSHOT_VERSION,
    }
