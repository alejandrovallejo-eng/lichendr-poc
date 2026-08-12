from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import numpy as np
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

    def test_validated_detection_returns_calibration_without_lichen_metrics(self) -> None:
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", encode(synthetic_frame()), "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "rectification_review")
        self.assertEqual(body["frame_detection"]["classification"], "validated")
        self.assertEqual(body["frame_detection"]["detected_marker_ids"], [0, 1, 2, 3])
        self.assertIsNone(body["metrics"])
        self.assertTrue(body["rectified_image_data_url"].startswith("data:image/jpeg;base64,"))

    def test_confirmed_corners_can_be_analyzed_explicitly_in_one_action(self) -> None:
        image = encode(synthetic_frame(missing_id=1))
        with patch.object(vision_app, "load_model"):
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
        self.assertEqual(review.json()["frame_detection"]["classification"], "manual_confirmed")
        self.assertEqual(final.status_code, 200)
        self.assertEqual(final.json()["status"], "rectification_review")
        self.assertIsNone(final.json()["metrics"])
        self.assertEqual(final.json()["frame_detection"]["classification"], "manual_confirmed")
        self.assertEqual(len(final.json()["corner_proposal"]), 4)

    def test_zero_aruco_allows_four_valid_manual_points(self) -> None:
        rng = np.random.default_rng(42)
        image = rng.integers(45, 190, (2320, 720, 3), dtype=np.uint8)
        encoded = encode(image)
        corners = json.dumps([
            {"x": 0.25, "y": 0.1},
            {"x": 0.75, "y": 0.1},
            {"x": 0.75, "y": 0.9},
            {"x": 0.25, "y": 0.9},
        ])
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                detection = client.post(
                    "/analyze-view",
                    files={"image": ("no-aruco.png", encoded, "image/png")},
                )
                final = client.post(
                    "/analyze-view",
                    files={"image": ("no-aruco.png", encoded, "image/png")},
                    data={"action": "analyze_confirmed", "corners": corners},
                )
        self.assertEqual(detection.status_code, 200)
        self.assertEqual(detection.json()["frame_detection"]["detected_marker_ids"], [])
        self.assertEqual(detection.json()["status"], "needs_confirmation")
        self.assertEqual(final.status_code, 200)
        self.assertEqual(final.json()["status"], "rectification_review")
        self.assertIsNone(final.json()["metrics"])
        self.assertEqual(final.json()["frame_detection"]["classification"], "manual_confirmed")

    def test_decodable_image_without_safe_proposal_still_allows_manual_selection(self) -> None:
        image = encode(np.full((1200, 600, 3), 127, dtype=np.uint8))
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("plain.png", image, "image/png")},
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "needs_confirmation")
        self.assertIsNone(response.json()["corner_proposal"])
        self.assertIn("manual_selection_required", response.json()["quality_flags"])

    def test_crossed_manual_points_return_recoverable_geometry_error(self) -> None:
        image = encode(synthetic_frame(missing_id=1))
        crossed = json.dumps([
            {"x": 0.2, "y": 0.1},
            {"x": 0.8, "y": 0.9},
            {"x": 0.8, "y": 0.1},
            {"x": 0.2, "y": 0.9},
        ])
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", image, "image/png")},
                    data={"action": "analyze_confirmed", "corners": crossed},
                )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"]["code"], "crossed_corners")

    def test_estimated_manual_points_return_provisional_quality_flag(self) -> None:
        image = encode(synthetic_frame(missing_id=1))
        corners = json.dumps([
            {"x": 0.22, "y": 0.08},
            {"x": 0.78, "y": 0.08},
            {"x": 0.78, "y": 0.92},
            {"x": 0.22, "y": 0.92},
        ])
        with patch.object(vision_app, "load_model"):
            with TestClient(vision_app.app) as client:
                response = client.post(
                    "/analyze-view",
                    files={"image": ("frame.png", image, "image/png")},
                    data={
                        "action": "analyze_confirmed",
                        "corners": corners,
                        "manual_mode": "manual_assisted_provisional",
                    },
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["frame_detection"]["classification"], "manual_assisted_provisional")
        self.assertIn("manual_estimated_geometry", response.json()["quality_flags"])


if __name__ == "__main__":
    unittest.main()
