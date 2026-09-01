"""Tests for VISION_SERVICE_TOKEN authentication and /ready endpoint."""
from __future__ import annotations

import importlib
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


def _make_client(token: str | None) -> TestClient:
    """
    Reload the app module with a specific VISION_SERVICE_TOKEN value so that
    each test starts from a clean authentication state.
    """
    env_patch = {"VISION_SERVICE_TOKEN": token} if token is not None else {}
    with patch.dict("os.environ", env_patch, clear=False):
        # Remove cached module so env is re-read
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.object(vision_app, "load_model"):
            return TestClient(vision_app.app)


class ReadyEndpointTests(unittest.TestCase):
    """The /ready endpoint must be public and honour model state."""

    def test_ready_returns_503_when_model_not_loaded(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                # Model was never loaded (load_model was patched out)
                response = client.get("/ready")
        self.assertEqual(response.status_code, 503)

    def test_ready_returns_200_when_model_loaded(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.object(vision_app, "load_model"):
            with patch.object(vision_app, "is_model_loaded", return_value=True):
                with TestClient(vision_app.app) as client:
                    response = client.get("/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")

    def test_ready_requires_no_token(self) -> None:
        """Even when a token is configured, /ready must be publicly accessible."""
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "secret"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with patch.object(vision_app, "is_model_loaded", return_value=True):
                    with TestClient(vision_app.app) as client:
                        response = client.get("/ready")
        self.assertEqual(response.status_code, 200)


class HealthEndpointTests(unittest.TestCase):
    """/health must remain public regardless of token configuration."""

    def test_health_is_public_without_token_configured(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.get("/health")
        self.assertEqual(response.status_code, 200)

    def test_health_is_public_even_when_token_is_configured(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "super-secret"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    response = client.get("/health")
        self.assertEqual(response.status_code, 200)


class InferenceTokenProtectionTests(unittest.TestCase):
    """Inference endpoints must be protected when a token is configured."""

    def _fresh_app_with_token(self, token: str):  # type: ignore[no-untyped-def]
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        return vision_app

    def test_prepare_rejects_request_without_token(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "my-secret"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    from tests.fixtures import encode, synthetic_frame  # noqa: PLC0415
                    response = client.post(
                        "/prepare",
                        files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                    )
        self.assertIn(response.status_code, {401, 403})

    def test_prepare_rejects_wrong_token(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "correct-secret"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    from tests.fixtures import encode, synthetic_frame  # noqa: PLC0415
                    response = client.post(
                        "/prepare",
                        files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                        headers={"Authorization": "****** },
                    )
        self.assertEqual(response.status_code, 403)

    def test_analyze_view_rejects_without_token(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "my-secret"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    from tests.fixtures import encode, synthetic_frame  # noqa: PLC0415
                    response = client.post(
                        "/analyze-view",
                        files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                    )
        self.assertIn(response.status_code, {401, 403})

    def test_analyze_view_accepts_correct_token(self) -> None:
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        import app as vision_app  # noqa: PLC0415
        with patch.dict("os.environ", {"VISION_SERVICE_TOKEN": "good-token"}, clear=False):
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    from tests.fixtures import encode, synthetic_frame  # noqa: PLC0415
                    response = client.post(
                        "/analyze-view",
                        files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                        headers={"Authorization": "****** },
                    )
        # 200 or 422 (frame processing error) both indicate the token was accepted
        self.assertNotIn(response.status_code, {401, 403})

    def test_no_token_configured_allows_unauthenticated_access(self) -> None:
        """When VISION_SERVICE_TOKEN is not set, all endpoints are open (dev mode)."""
        for mod in list(sys.modules.keys()):
            if mod in ("app",):
                del sys.modules[mod]
        # Make sure the token is absent from env
        import os  # noqa: PLC0415
        env_without_token = {k: v for k, v in os.environ.items() if k != "VISION_SERVICE_TOKEN"}
        with patch.dict("os.environ", env_without_token, clear=True):
            import app as vision_app  # noqa: PLC0415
            with patch.object(vision_app, "load_model"):
                with TestClient(vision_app.app) as client:
                    response = client.get("/health")
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
