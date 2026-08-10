from __future__ import annotations

import unittest

import cv2
import numpy as np

from frame import Rectification, estimate_trunk_width


class TrunkEstimationTests(unittest.TestCase):
    def rectification(self) -> Rectification:
        source = np.float32([[300, 0], [699, 0], [699, 1999], [300, 1999]])
        target = np.float32([[0, 0], [399, 0], [399, 1999], [0, 1999]])
        return Rectification(
            canonical_rgb=np.zeros((2000, 400, 3), dtype=np.uint8),
            homography=cv2.getPerspectiveTransform(source, target),
            reprojection_error_px=0,
            quality_flags=[],
            quality_score=1,
            source_width=1000,
            source_height=2000,
            frame_detection={"classification": "validated"},
        )

    def test_estimates_width_from_frame_scale_and_two_edges(self) -> None:
        rgb = np.full((2000, 1000, 3), 235, dtype=np.uint8)
        rgb[:, 100:900] = (85, 72, 58)
        estimate = estimate_trunk_width(rgb, self.rectification())
        self.assertIsNotNone(estimate)
        assert estimate is not None
        self.assertAlmostEqual(estimate["width_cm"], 20, delta=1)
        self.assertLess(estimate["min_cm"], estimate["width_cm"])
        self.assertGreater(estimate["max_cm"], estimate["width_cm"])
        self.assertEqual(estimate["method"], "automatic")

    def test_returns_none_when_no_edges_are_distinguishable(self) -> None:
        rgb = np.full((2000, 1000, 3), 120, dtype=np.uint8)
        self.assertIsNone(estimate_trunk_width(rgb, self.rectification()))


if __name__ == "__main__":
    unittest.main()
