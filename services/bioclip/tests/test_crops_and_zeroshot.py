"""Crop geometry and zero-shot aggregation rules (no model weights involved)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from constants import LABELS, PROMPT_TEMPLATES  # noqa: E402
from crops import (  # noqa: E402
    Box,
    apply_exif_orientation_to_box,
    deduplicate,
    expand_with_context,
    intersection_over_union,
    mask_bounding_box,
    scale_to_max_side,
)
from zeroshot import (  # noqa: E402
    aggregate_prompt_embeddings,
    build_prompts,
    cosine_scores,
    rank_scores,
)


def test_bounding_box_covers_every_positive_pixel() -> None:
    mask = [
        [0, 0, 0, 0],
        [0, 1, 1, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 0],
    ]
    assert mask_bounding_box(mask) == Box(1, 1, 2, 2)
    assert mask_bounding_box([[0, 0], [0, 0]]) is None


def test_context_expansion_never_cuts_the_region() -> None:
    box = Box(10, 10, 40, 20)
    expanded = expand_with_context(box, 200, 200)
    assert expanded.x <= box.x
    assert expanded.y <= box.y
    assert expanded.x + expanded.width >= box.x + box.width
    assert expanded.y + expanded.height >= box.y + box.height


def test_region_touching_the_border_keeps_its_extremes() -> None:
    box = Box(0, 0, 20, 200)
    expanded = expand_with_context(box, 100, 200)
    assert expanded.x == 0
    assert expanded.y == 0
    assert expanded.height == 200
    assert expanded.x + expanded.width >= 20


def test_small_region_grows_to_the_minimum_side() -> None:
    expanded = expand_with_context(Box(50, 50, 4, 4), 200, 200)
    assert expanded.width >= 48
    assert expanded.height >= 48


def test_duplicates_are_collapsed_but_distinct_regions_survive() -> None:
    first = Box(0, 0, 100, 100)
    almost = Box(1, 1, 100, 100)
    other = Box(300, 300, 100, 100)
    assert intersection_over_union(first, almost) > 0.9
    assert deduplicate([first, almost, other]) == [first, other]


def test_large_region_is_downscaled_not_truncated() -> None:
    scale = scale_to_max_side(Box(0, 0, 4096, 2048))
    assert scale == pytest.approx(1024 / 4096)
    assert scale_to_max_side(Box(0, 0, 100, 100)) == 1.0


def test_exif_orientation_six_rotates_coordinates() -> None:
    box = Box(10, 20, 30, 40)
    rotated = apply_exif_orientation_to_box(box, 6, 100, 200)
    assert rotated == Box(200 - 20 - 40, 10, 40, 30)
    assert apply_exif_orientation_to_box(box, 1, 100, 200) == box
    with pytest.raises(ValueError):
        apply_exif_orientation_to_box(box, 99, 100, 200)


def test_prompt_set_is_exact_and_reproducible() -> None:
    prompts = build_prompts()
    assert prompts == [
        "a photo of lichen.",
        "a close-up photo of lichen.",
        "a photo of moss.",
        "a close-up photo of moss.",
        "a photo of bare tree bark.",
        "a close-up photo of bare tree bark.",
    ]
    assert len(prompts) == len(LABELS) * len(PROMPT_TEMPLATES)
    assert build_prompts() == prompts


def test_prompt_aggregation_averages_then_renormalises() -> None:
    embeddings = np.zeros((6, 4), dtype=np.float32)
    embeddings[0] = [1, 0, 0, 0]
    embeddings[1] = [0, 1, 0, 0]
    embeddings[2] = [0, 0, 1, 0]
    embeddings[3] = [0, 0, 1, 0]
    embeddings[4] = [0, 0, 0, 1]
    embeddings[5] = [0, 0, 0, 1]
    aggregated = aggregate_prompt_embeddings(embeddings)
    assert aggregated.shape == (3, 4)
    assert np.allclose(np.linalg.norm(aggregated, axis=1), 1.0)
    assert np.allclose(aggregated[0], [0.7071068, 0.7071068, 0, 0])


def test_scores_are_plain_cosines_and_never_probabilities() -> None:
    images = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    labels = np.array([[1.0, 0.0], [0.0, 1.0], [0.7071068, 0.7071068]], dtype=np.float32)
    scores = cosine_scores(images, labels)
    assert scores.shape == (2, 3)
    assert scores[0, 0] == pytest.approx(1.0)
    # No softmax anywhere: rows do not sum to one.
    assert not np.allclose(scores.sum(axis=1), 1.0)


def test_ranking_orders_labels_without_thresholds() -> None:
    ordered = rank_scores(np.array([0.1, 0.3, 0.2], dtype=np.float32))
    assert [item.label for item in ordered] == ["moss", "bare tree bark", "lichen"]
    with pytest.raises(ValueError):
        rank_scores(np.array([np.nan, 0.0, 0.0], dtype=np.float32))
