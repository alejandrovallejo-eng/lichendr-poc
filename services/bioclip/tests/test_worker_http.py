"""HTTP surface of the local worker: flag, auth, limits and queue.

These tests never load BioCLIP: they check the guard rails around it.
"""

from __future__ import annotations

import base64
import importlib
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import constants  # noqa: E402


def png_bytes(width: int = 64, height: int = 64) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 120, 120)).save(buffer, format="PNG")
    return buffer.getvalue()


def encoded_png(**kwargs) -> str:
    return base64.b64encode(png_bytes(**kwargs)).decode("ascii")


def load_app(monkeypatch: pytest.MonkeyPatch, **environment: str):
    for name in (
        "BIOCLIP_WORKER_ENABLED",
        "BIOCLIP_MODEL_DIR",
        "BIOCLIP_HEAD_PATH",
        "BIOCLIP_HEAD_SHA256",
        "BIOCLIP_WORKER_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    module = importlib.import_module("app")
    return importlib.reload(module)


def test_disabled_by_default_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(monkeypatch)
    with TestClient(module.app) as client:
        assert client.get("/health").json()["enabled"] is False
        response = client.post(
            "/suggest-regions",
            json={"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]},
        )
    assert response.status_code == 503
    assert response.json()["detail"] == "worker_disabled"


def test_token_is_required_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch,
        BIOCLIP_WORKER_ENABLED="1",
        BIOCLIP_MODEL_DIR="/nonexistent-model-dir",
        BIOCLIP_WORKER_TOKEN="local-token",
    )
    with TestClient(module.app) as client:
        body = {"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]}
        assert client.post("/suggest-regions", json=body).status_code == 401
        wrong = client.post(
            "/suggest-regions", json=body, headers={"Authorization": "Bearer " + "otro-valor"}
        )
        assert wrong.status_code == 401
        # Correct token: rejected later, because the encoder is not present.
        right = client.post(
            "/suggest-regions", json=body, headers={"Authorization": "Bearer " + "local-token"}
        )
        assert right.status_code == 503
        assert right.json()["detail"] == "encoder_unavailable"


def test_missing_encoder_is_reported_not_downloaded(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    with TestClient(module.app) as client:
        health = client.get("/health").json()
    assert health["encoderLoaded"] is False
    assert "download_model.py" in health["encoderError"]
    assert health["backend"] == "zeroshot"


def test_invalid_head_is_surfaced_and_never_silently_ignored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    broken = tmp_path / "broken.npz"
    broken.write_bytes(b"not an npz")
    module = load_app(
        monkeypatch,
        BIOCLIP_WORKER_ENABLED="1",
        BIOCLIP_MODEL_DIR="/nonexistent-model-dir",
        BIOCLIP_HEAD_PATH=str(broken),
    )
    with TestClient(module.app) as client:
        health = client.get("/health").json()
    assert health["headLoaded"] is False
    assert health["headError"]
    assert health["backend"] == "zeroshot"


def test_payload_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    module._state["encoder"] = object()
    with TestClient(module.app) as client:
        module._state["encoder"] = object()
        too_many = client.post(
            "/suggest-regions",
            json={
                "regions": [
                    {"regionId": f"r{index}", "cropPngBase64": encoded_png()}
                    for index in range(constants.MAX_REGIONS_PER_REQUEST + 1)
                ]
            },
        )
        assert too_many.status_code == 422

        duplicated = client.post(
            "/suggest-regions",
            json={
                "regions": [
                    {"regionId": "same", "cropPngBase64": encoded_png()},
                    {"regionId": "same", "cropPngBase64": encoded_png()},
                ]
            },
        )
        assert duplicated.status_code == 400
        assert duplicated.json()["detail"] == "duplicate_region_id"

        not_base64 = client.post(
            "/suggest-regions",
            json={"regions": [{"regionId": "r1", "cropPngBase64": "not base64 !!"}]},
        )
        assert not_base64.status_code == 400

        not_an_image = client.post(
            "/suggest-regions",
            json={
                "regions": [
                    {
                        "regionId": "r1",
                        "cropPngBase64": base64.b64encode(b"plain text").decode("ascii"),
                    }
                ]
            },
        )
        assert not_an_image.status_code == 400

        oversized = client.post(
            "/suggest-regions",
            json={
                "regions": [
                    {
                        "regionId": "r1",
                        "cropPngBase64": base64.b64encode(
                            b"\x89PNG\r\n\x1a\n" + b"0" * (constants.MAX_CROP_BYTES + 1)
                        ).decode("ascii"),
                    }
                ]
            },
        )
        assert oversized.status_code == 413

        bad_preprocess = client.post(
            "/suggest-regions",
            json={
                "regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}],
                "preprocess": "center_crop_everything",
            },
        )
        assert bad_preprocess.status_code == 400

        huge_body = client.post(
            "/suggest-regions",
            content=b"{}",
            headers={
                "content-type": "application/json",
                "content-length": str(constants.MAX_REQUEST_BYTES + 1),
            },
        )
        assert huge_body.status_code == 413


def test_queue_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    with TestClient(module.app) as client:
        module._state["encoder"] = object()
        module._queue_depth = constants.MAX_QUEUE_DEPTH
        response = client.post(
            "/suggest-regions",
            json={"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]},
        )
        module._queue_depth = 0
    assert response.status_code == 429
    assert response.json()["detail"] == "queue_full"


def test_only_one_inference_runs_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    assert module._inference_gate._value == 1
