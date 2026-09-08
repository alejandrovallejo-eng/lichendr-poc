"""Strict validation of the optional trained-head NPZ.

The real head is on the reviewer's Mac and is not available here, so these tests
build synthetic NPZ files that follow — or deliberately break — the documented
contract. They prove the loader's rules, never biological accuracy.
"""

from __future__ import annotations

import pickle
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from head import HeadValidationError, load_trained_head, sha256_of_file  # noqa: E402

DIM = 768
LABELS = np.array(["lichen", "moss", "bark"])


def write_head(path: Path, **overrides) -> Path:
    payload = {
        "weights": np.zeros((DIM, 3), dtype=np.float32),
        "feature_mean": np.zeros(DIM, dtype=np.float32),
        "intercept": np.zeros(3, dtype=np.float32),
        "centroids": np.zeros((3, DIM), dtype=np.float32),
        "labels": LABELS,
    }
    payload.update(overrides)
    np.savez(path, **payload)
    return path


def test_valid_head_loads_and_reports_hash(tmp_path: Path) -> None:
    path = write_head(tmp_path / "head.npz")
    head = load_trained_head(path)
    assert head.labels == ("lichen", "moss", "bark")
    assert head.embed_dim == DIM
    assert head.weights.shape == (DIM, 3)
    assert head.centroids.shape == (3, DIM)
    assert head.sha256 == sha256_of_file(path)


def test_scores_follow_the_documented_formulas(tmp_path: Path) -> None:
    weights = np.zeros((DIM, 3), dtype=np.float32)
    weights[0, 0] = 2.0
    centroids = np.zeros((3, DIM), dtype=np.float32)
    centroids[1, 0] = 3.0
    feature_mean = np.zeros(DIM, dtype=np.float32)
    feature_mean[0] = 0.5
    intercept = np.array([1.0, 0.0, -1.0], dtype=np.float32)
    head = load_trained_head(
        write_head(
            tmp_path / "head.npz",
            weights=weights,
            centroids=centroids,
            feature_mean=feature_mean,
            intercept=intercept,
        )
    )
    embedding = np.zeros((1, DIM), dtype=np.float32)
    embedding[0, 0] = 1.0
    ridge = head.ridge_scores(embedding)
    centroid = head.centroid_scores(embedding)
    assert ridge[0, 0] == pytest.approx((1.0 - 0.5) * 2.0 + 1.0)
    assert centroid[0, 1] == pytest.approx(3.0)


def test_rejects_wrong_dimension(tmp_path: Path) -> None:
    path = write_head(
        tmp_path / "head.npz",
        weights=np.zeros((512, 3), dtype=np.float32),
        feature_mean=np.zeros(512, dtype=np.float32),
        centroids=np.zeros((3, 512), dtype=np.float32),
    )
    with pytest.raises(HeadValidationError, match="d=512"):
        load_trained_head(path)


def test_rejects_wrong_class_count(tmp_path: Path) -> None:
    path = write_head(
        tmp_path / "head.npz",
        weights=np.zeros((DIM, 4), dtype=np.float32),
        intercept=np.zeros(4, dtype=np.float32),
    )
    with pytest.raises(HeadValidationError):
        load_trained_head(path)


def test_rejects_reordered_or_translated_labels(tmp_path: Path) -> None:
    for labels in (
        np.array(["moss", "lichen", "bark"]),
        np.array(["lichen", "moss", "bare tree bark"]),
        np.array(["liquen", "musgo", "corteza"]),
    ):
        path = write_head(tmp_path / "head.npz", labels=labels)
        with pytest.raises(HeadValidationError):
            load_trained_head(path)


def test_rejects_non_finite_values(tmp_path: Path) -> None:
    weights = np.zeros((DIM, 3), dtype=np.float32)
    weights[3, 1] = np.nan
    path = write_head(tmp_path / "head.npz", weights=weights)
    with pytest.raises(HeadValidationError, match="no finitos"):
        load_trained_head(path)


def test_rejects_missing_and_unexpected_keys(tmp_path: Path) -> None:
    incomplete = tmp_path / "incomplete.npz"
    np.savez(incomplete, weights=np.zeros((DIM, 3), dtype=np.float32))
    with pytest.raises(HeadValidationError, match="Faltan claves"):
        load_trained_head(incomplete)

    extra = write_head(tmp_path / "extra.npz", surprise=np.zeros(3, dtype=np.float32))
    with pytest.raises(HeadValidationError, match="desconocidas"):
        load_trained_head(extra)


def test_rejects_pickled_payload(tmp_path: Path) -> None:
    path = tmp_path / "pickled.npz"
    np.savez(path, weights=np.array([{"malicious": True}], dtype=object), labels=LABELS)
    with pytest.raises(HeadValidationError):
        load_trained_head(path)


def test_rejects_sha256_mismatch(tmp_path: Path) -> None:
    path = write_head(tmp_path / "head.npz")
    with pytest.raises(HeadValidationError, match="SHA-256"):
        load_trained_head(path, expected_sha256="0" * 64)


def test_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(HeadValidationError, match="no existe"):
        load_trained_head(tmp_path / "absent.npz")


def test_rejects_non_npz_file(tmp_path: Path) -> None:
    path = tmp_path / "fake.npz"
    path.write_bytes(pickle.dumps({"weights": [1, 2, 3]}))
    with pytest.raises(HeadValidationError):
        load_trained_head(path)
