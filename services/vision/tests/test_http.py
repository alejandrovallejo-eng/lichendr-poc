from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as vision_app
from tests.fixtures import encode, synthetic_frame


class HttpTests(unittest.TestCase):
    def test_template_validation_endpoint(self) -> None:
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/template/validate",
                    files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["templateVersion"], "LICHENDR-FRAME-0.2")

    def test_analyze_endpoint_returns_safe_marker_error(self) -> None:
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("missing.png", encode(synthetic_frame(missing_id=1)), "image/png")},
                )
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["detail"]["code"], "markers_incomplete")
        self.assertNotIn("/home/", str(body))


if __name__ == "__main__":
    unittest.main()
