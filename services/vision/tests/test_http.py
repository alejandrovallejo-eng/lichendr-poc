from __future__ import annotations

import json
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

    def test_analyze_endpoint_returns_assisted_proposal_and_diagnostics(self) -> None:
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("missing.png", encode(synthetic_frame(missing_id=1)), "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "needs_confirmation")
        self.assertEqual(body["frame_detection"]["detected_marker_ids"], [0, 2, 3])
        self.assertEqual(body["frame_detection"]["missing_marker_ids"], [1])
        self.assertEqual(len(body["corner_proposal"]), 4)
        self.assertNotIn("/home/", str(body))

    def test_validated_detection_returns_traceable_metrics(self) -> None:
        with patch.object(vision_app, "load_model"), patch.object(
            vision_app,
            "automatic_segment_image",
            return_value=[],
        ):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "provisional_ai")
        self.assertEqual(body["frame_detection"]["classification"], "validated")
        self.assertEqual(body["frame_detection"]["detected_marker_ids"], [0, 1, 2, 3])
        self.assertEqual(body["metrics"]["valid_area_cm2"], 500)

    def test_confirmed_corners_require_rectification_review_before_analysis(self) -> None:
        image = encode(synthetic_frame(missing_id=1))
        with patch.object(vision_app, "load_model"), patch.object(
            vision_app,
            "automatic_segment_image",
            return_value=[],
        ):
            with TestClient(vision_app.app) as client:
                detection = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", image, "image/png")},
                ).json()
                corners = json.dumps(detection["corner_proposal"])
                review = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", image, "image/png")},
                    data={"action": "confirm_corners", "corners": corners},
                )
                final = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", image, "image/png")},
                    data={"action": "analyze_confirmed", "corners": corners},
                )
        self.assertEqual(review.status_code, 200)
        self.assertEqual(review.json()["status"], "rectification_review")
        self.assertTrue(review.json()["rectified_image_data_url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(review.json()["frame_detection"]["classification"], "assisted")
        self.assertEqual(final.status_code, 200)
        self.assertEqual(final.json()["status"], "provisional_ai")
        self.assertEqual(final.json()["frame_detection"]["classification"], "assisted")


if __name__ == "__main__":
    unittest.main()
