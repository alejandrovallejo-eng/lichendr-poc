"""HTTP surface of the local worker: flag, auth, limits and queue.

These tests never load BioCLIP: they check the guard rails around it.
"""

from __future__ import annotations

import base64
import importlib
import io
import sys
import threading
import time
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


class _FakeBatch:
    """Minimal stand-in for a SuggestionBatch: these tests never load BioCLIP."""

    backend = "zeroshot"
    encoder_id = "fake-encoder"
    encoder_sha256 = "0" * 64
    head_sha256 = None
    preprocess_mode = "whole_crop_pad"
    versions: dict = {}
    suggestions: list = []


def test_a_timed_out_request_never_admits_a_second_inference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: the gate must hold until the inference really finishes.

    `asyncio.wait_for` only cancels the *waiting*; the thread started by
    `asyncio.to_thread` keeps running. Releasing the semaphore on timeout used
    to admit a second inference while the first one was still running, so the
    worker peaked at 2 concurrent inferences while promising 1.
    """

    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    module._state["encoder"] = object()

    lock = threading.Lock()
    running = 0
    peak = 0

    def slow_suggest(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        try:
            time.sleep(0.25)
            return _FakeBatch()
        finally:
            with lock:
                running -= 1

    monkeypatch.setattr(module, "suggest", slow_suggest)
    monkeypatch.setattr(module, "REQUEST_TIMEOUT_SECONDS", 0.03)

    body = {"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]}
    with TestClient(module.app) as client:
        first = client.post("/suggest-regions", json=body)
        second = client.post("/suggest-regions", json=body)

    assert first.status_code == 504
    assert first.json()["detail"] == "inference_timeout"
    # The second request also gives up, because the deadline includes the wait
    # in the queue: it must never jump ahead of the running inference.
    assert second.status_code == 504
    assert second.json()["detail"] == "inference_timeout"

    # Let the shielded threads finish before asserting.
    time.sleep(0.6)
    assert peak == 1, f"se ejecutaron {peak} inferencias simultáneas"
    assert running == 0
    assert module._queue_depth == 0


def test_the_gate_is_released_when_the_inference_really_ends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    module._state["encoder"] = object()

    def slow_suggest(*args, **kwargs):  # noqa: ANN002, ANN003
        time.sleep(0.15)
        return _FakeBatch()

    monkeypatch.setattr(module, "suggest", slow_suggest)
    monkeypatch.setattr(module, "REQUEST_TIMEOUT_SECONDS", 0.03)

    body = {"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]}
    with TestClient(module.app) as client:
        assert client.post("/suggest-regions", json=body).status_code == 504
        time.sleep(0.4)
        # Once the abandoned inference ends, the worker accepts work again.
        monkeypatch.setattr(module, "REQUEST_TIMEOUT_SECONDS", 5.0)
        recovered = client.post("/suggest-regions", json=body)
    assert recovered.status_code == 200
    assert module._inference_gate._value == 1


def test_a_chunked_body_is_bounded_by_the_bytes_actually_received(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`Content-Length` alone bounds nothing: a chunked body declares no size."""

    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    module._state["encoder"] = object()

    def chunked_body():
        sent = 0
        while sent <= constants.MAX_REQUEST_BYTES:
            chunk = b"0" * 65536
            sent += len(chunk)
            yield chunk

    with TestClient(module.app) as client:
        response = client.post(
            "/suggest-regions",
            content=chunked_body(),
            headers={"content-type": "application/json"},
        )
    assert response.status_code == 413
    assert response.json()["detail"] == "request_too_large"


def test_aggregate_pixels_are_rejected_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_app(
        monkeypatch, BIOCLIP_WORKER_ENABLED="1", BIOCLIP_MODEL_DIR="/nonexistent-model-dir"
    )
    module._state["encoder"] = object()

    decoded: list[str] = []
    original = module._decode_admitted

    def counting_decode(crop):  # noqa: ANN001
        decoded.append("x")
        return original(crop)

    monkeypatch.setattr(module, "_decode_admitted", counting_decode)
    monkeypatch.setattr(constants, "MAX_TOTAL_CROP_PIXELS", 4096)
    monkeypatch.setattr(module, "MAX_TOTAL_CROP_PIXELS", 4096)

    with TestClient(module.app) as client:
        response = client.post(
            "/suggest-regions",
            json={
                "regions": [
                    {"regionId": f"r{index}", "cropPngBase64": encoded_png(width=64, height=64)}
                    for index in range(4)
                ]
            },
        )
    assert response.status_code == 413
    assert response.json()["detail"] == "request_too_many_pixels"
    # Admission happened before any rasterisation.
    assert decoded == []


def test_a_configured_but_invalid_head_rejects_instead_of_degrading(
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
    module._state["encoder"] = object()
    with TestClient(module.app) as client:
        response = client.post(
            "/suggest-regions",
            json={"regions": [{"regionId": "r1", "cropPngBase64": encoded_png()}]},
        )
    assert response.status_code == 503
    assert response.json()["detail"] == "head_invalid"
