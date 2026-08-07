from __future__ import annotations

import io
import unittest

import numpy as np
from PIL import Image

from frame import (
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    FrameValidationError,
    aggregate_tree_metrics,
    calculate_provisional_metrics,
    critical_quality_flags,
    decode_image,
    rectify_frame,
    validate_image_payload,
)
from tests.fixtures import encode, synthetic_frame


class FrameTests(unittest.TestCase):
    def test_known_perspective_rectifies_to_exact_canonical_size(self) -> None:
        result = rectify_frame(synthetic_frame(perspective=True))
        self.assertEqual(result.canonical_rgb.shape, (CANONICAL_HEIGHT, CANONICAL_WIDTH, 3))
        self.assertLess(result.reprojection_error_px, 0.01)

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


if __name__ == "__main__":
    unittest.main()
