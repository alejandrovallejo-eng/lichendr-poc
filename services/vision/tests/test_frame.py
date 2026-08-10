from __future__ import annotations

import io
import struct
import unittest
import zlib

import numpy as np
from PIL import Image

from frame import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    FrameValidationError,
    aggregate_tree_metrics,
    calculate_provisional_metrics,
    confirmed_rectification,
    critical_quality_flags,
    decode_image,
    inspect_frame,
    propose_inner_window,
    rectify_frame,
    validate_window_corners,
    validate_image_payload,
)
from tests.fixtures import encode, synthetic_frame


class FrameTests(unittest.TestCase):
    def test_known_perspective_rectifies_to_exact_canonical_size(self) -> None:
        result = rectify_frame(synthetic_frame(perspective=True))
        self.assertEqual(result.canonical_rgb.shape, (CANONICAL_HEIGHT, CANONICAL_WIDTH, 3))
        self.assertLess(result.reprojection_error_px, 0.5)

    def test_rectification_crops_the_exact_inner_window(self) -> None:
        source = synthetic_frame()
        result = rectify_frame(source)
        expected = source[160:2160, 160:560]
        difference = np.abs(result.canonical_rgb.astype(np.int16) - expected.astype(np.int16))
        self.assertLess(float(difference.mean()), 4.0)

    def test_missing_marker_is_rejected(self) -> None:
        with self.assertRaisesRegex(FrameValidationError, "Faltan marcadores"):
            rectify_frame(synthetic_frame(missing_id=2))

    def test_unknown_marker_is_rejected(self) -> None:
        with self.assertRaisesRegex(FrameValidationError, "desconocidos"):
            rectify_frame(synthetic_frame(wrong_id=8))

    def test_duplicate_marker_is_rejected(self) -> None:
        with self.assertRaisesRegex(FrameValidationError, "duplicados"):
            rectify_frame(synthetic_frame(wrong_id=0))

    def test_blurred_view_is_flagged_for_repeat(self) -> None:
        import cv2
        blurred = synthetic_frame()
        blurred[160:2160, 160:560] = cv2.GaussianBlur(blurred[160:2160, 160:560], (81, 81), 25)
        result = rectify_frame(blurred)
        self.assertIn("blur", critical_quality_flags(result.quality_flags))

    def test_sharp_reduced_blurred_and_low_contrast_markers_are_detected(self) -> None:
        import cv2
        sharp = synthetic_frame()
        reduced = cv2.resize(sharp, (360, 1160), interpolation=cv2.INTER_AREA)
        moderate_blur = cv2.GaussianBlur(sharp, (7, 7), 1.6)
        low_contrast = cv2.convertScaleAbs(sharp, alpha=0.48, beta=90)
        for image in (sharp, reduced, moderate_blur, low_contrast):
            detection = inspect_frame(image)
            self.assertEqual(detection.detected_ids, [0, 1, 2, 3])
            self.assertIsNone(detection.rejection_reason)
            self.assertIsNotNone(detection.successful_resolution)
            self.assertIsNotNone(detection.successful_variant)

    def test_partial_glare_returns_a_contour_proposal_without_silent_acceptance(self) -> None:
        import cv2
        image = synthetic_frame()
        for x in (100, 620):
            cv2.rectangle(image, (x - 18, 55), (x + 18, 145), (255, 255, 255), -1)
        detection = inspect_frame(image)
        self.assertEqual(detection.detected_ids, [2, 3])
        self.assertEqual(detection.missing_ids, [0, 1])
        self.assertFalse(detection.assisted_eligible)
        self.assertIsNotNone(detection.proposal)
        self.assertEqual(detection.proposal.source, "frame_contour")

    def test_rejected_marker_candidate_is_reported(self) -> None:
        detection = inspect_frame(synthetic_frame(occluded_id=1))
        self.assertEqual(detection.detected_ids, [0, 2, 3])
        self.assertIn(1, detection.missing_ids)
        self.assertGreater(detection.rejected_candidate_count, 0)
        self.assertIsNotNone(detection.proposal)

    def test_three_or_diagonal_two_markers_can_support_assistance(self) -> None:
        three = inspect_frame(synthetic_frame(missing_id=1))
        diagonal = inspect_frame(synthetic_frame(missing_ids={1, 2}))
        self.assertTrue(three.assisted_eligible)
        self.assertTrue(diagonal.assisted_eligible)
        self.assertEqual(diagonal.detected_ids, [0, 3])
        self.assertEqual(diagonal.proposal.source, "partial_aruco_and_frame_contour")

    def test_two_markers_on_one_edge_are_insufficient(self) -> None:
        detection = inspect_frame(synthetic_frame(missing_ids={2, 3}))
        self.assertEqual(detection.detected_ids, [0, 1])
        self.assertFalse(detection.assisted_eligible)
        self.assertEqual(detection.rejection_reason, "markers_incomplete")
        self.assertIsNotNone(detection.proposal)

    def test_contour_fallback_proposes_the_inner_window(self) -> None:
        proposal = propose_inner_window(synthetic_frame(missing_ids={0, 1, 2, 3}))
        self.assertIsNotNone(proposal)
        expected = np.float32([[160, 160], [559, 160], [559, 2159], [160, 2159]])
        self.assertLess(float(np.abs(proposal.corners - expected).mean()), 3.0)

    def test_manual_corners_are_validated_and_rectified(self) -> None:
        image = synthetic_frame(missing_ids={0, 1})
        detection = inspect_frame(image)
        corners = detection.proposal.corners / np.float32([image.shape[1] - 1, image.shape[0] - 1])
        shifted = corners.copy()
        shifted[:, 0] += np.float32([0.015, -0.015, -0.015, 0.015])
        result = confirmed_rectification(
            image,
            [{"x": float(point[0]), "y": float(point[1])} for point in shifted],
            detection,
        )
        self.assertEqual(result.canonical_rgb.shape, (CANONICAL_HEIGHT, CANONICAL_WIDTH, 3))
        self.assertEqual(result.frame_detection["classification"], "manual_confirmed")
        self.assertIn("manual_geometry_confirmed", result.quality_flags)
        self.assertIsNone(result.reprojection_error_px)

    def test_estimated_manual_geometry_is_explicitly_provisional(self) -> None:
        image = synthetic_frame(missing_ids={0, 1, 2, 3})
        corners = [
            {"x": 0.22, "y": 0.08},
            {"x": 0.78, "y": 0.08},
            {"x": 0.78, "y": 0.92},
            {"x": 0.22, "y": 0.92},
        ]
        result = confirmed_rectification(
            image,
            corners,
            inspect_frame(image),
            "manual_assisted_provisional",
        )
        self.assertEqual(result.frame_detection["classification"], "manual_assisted_provisional")
        self.assertEqual(result.frame_detection["method"], "manual_estimated_corners")
        self.assertIn("manual_estimated_geometry", result.quality_flags)

    def test_crossed_and_out_of_bounds_quadrilaterals_are_rejected(self) -> None:
        with self.assertRaisesRegex(FrameValidationError, "cruzado"):
            validate_window_corners(
                np.float32([[100, 100], [500, 2100], [500, 100], [100, 2100]]),
                720,
                2320,
            )
        with self.assertRaisesRegex(FrameValidationError, "fuera"):
            validate_window_corners(
                np.float32([[-1, 100], [500, 100], [500, 2100], [100, 2100]]),
                720,
                2320,
            )

    def test_union_area_does_not_double_count_overlap(self) -> None:
        rng = np.random.default_rng(7)
        image = np.full((2000, 400, 3), 92, dtype=np.uint8)
        image += rng.integers(0, 10, image.shape, dtype=np.uint8)
        image[0:800, 0:200] = rng.integers(170, 215, (800, 200, 3), dtype=np.uint8)
        first = np.zeros((2000, 400), dtype=bool)
        second = np.zeros_like(first)
        first[0:600, 0:200] = True
        second[400:800, 0:200] = True
        metrics = calculate_provisional_metrics(
            image,
            [{"mask": first, "score": 0.9}, {"mask": second, "score": 0.8}],
            [],
        )
        expected_union_pixels = 800 * 200
        self.assertAlmostEqual(metrics["lichen_union_area_cm2"], expected_union_pixels / 800_000 * 500, places=3)
        self.assertAlmostEqual(metrics["lichen_coverage_percent"], 20.0, places=3)

    def test_complete_and_missing_view_aggregation(self) -> None:
        metric = {
            "valid_area_cm2": 500,
            "lichen_union_area_cm2": 100,
            "occupied_cells": 3,
            "morphotype_coverage": {"LQ-001": 20},
        }
        complete = aggregate_tree_metrics([{"metrics": metric} for _ in range(4)])
        self.assertEqual(complete["total_valid_area_cm2"], 2000)
        self.assertEqual(complete["tree_lichen_coverage_percent"], 20)
        self.assertEqual(complete["pending_view_count"], 0)
        missing = aggregate_tree_metrics([{"metrics": metric} for _ in range(3)])
        self.assertEqual(missing["valid_view_count"], 3)
        self.assertEqual(missing["pending_view_count"], 1)
        self.assertIsNone(missing["tree_lichen_coverage_percent"])

    def test_tree_aggregation_rejects_area_above_physical_maximum(self) -> None:
        metric = {
            "valid_area_cm2": 501,
            "lichen_union_area_cm2": 100,
            "occupied_cells": 3,
            "morphotype_coverage": {},
        }
        result = aggregate_tree_metrics([{"metrics": metric} for _ in range(4)])
        self.assertEqual(result["valid_view_count"], 0)
        self.assertEqual(result["total_valid_area_cm2"], 0)
        self.assertIsNone(result["tree_lichen_coverage_percent"])

    def test_jpeg_png_and_invalid_signatures(self) -> None:
        png = encode(synthetic_frame())
        jpeg = encode(synthetic_frame(), "JPEG")
        self.assertEqual(validate_image_payload(png, "image/png"), "image/png")
        self.assertEqual(validate_image_payload(jpeg, "image/jpeg"), "image/jpeg")
        with self.assertRaises(FrameValidationError):
            validate_image_payload(b"not-png", "image/png")

    def test_decoded_pixel_limit_reports_a_specific_error(self) -> None:
        output = io.BytesIO()
        Image.new("RGB", (1, 1), "white").save(output, format="PNG")
        raw = bytearray(output.getvalue())
        struct.pack_into(">II", raw, 16, 10_000, 7_000)
        struct.pack_into(">I", raw, 29, zlib.crc32(raw[12:29]))
        with self.assertRaises(FrameValidationError) as raised:
            decode_image(bytes(raw), "image/png")
        self.assertEqual(raised.exception.code, "decoded_image_too_large")

    def test_real_heif_signature_and_decode(self) -> None:
        try:
            from pillow_heif import from_pillow
        except ImportError:
            self.skipTest("pillow-heif is not installed")
        output = io.BytesIO()
        from_pillow(Image.new("RGB", (700, 700), "white")).save(output)
        raw = output.getvalue()
        self.assertEqual(validate_image_payload(raw, "image/heif"), "image/heif")
        decoded, metadata = decode_image(raw, "image/heif")
        self.assertEqual(decoded.shape, (700, 700, 3))
        self.assertIn("orientation", metadata)

    def test_heic_exif_orientation_is_applied_before_marker_detection(self) -> None:
        try:
            from pillow_heif import from_pillow
        except ImportError:
            self.skipTest("pillow-heif is not installed")
        stored = Image.fromarray(synthetic_frame()).rotate(90, expand=True)
        exif = Image.Exif()
        exif[274] = 6
        output = io.BytesIO()
        from_pillow(stored).save(output, exif=exif.tobytes(), quality=95)
        decoded, _ = decode_image(output.getvalue(), "image/heic")
        self.assertEqual(decoded.shape[:2], (2320, 720))
        self.assertEqual(inspect_frame(decoded).detected_ids, [0, 1, 2, 3])


if __name__ == "__main__":
    unittest.main()
