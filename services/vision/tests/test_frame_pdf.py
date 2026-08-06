from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "generate-lichen-frame.py"
ASSETS = ROOT / "docs" / "field-assets"


class FramePdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run([sys.executable, str(SCRIPT)], check=True)
        spec = importlib.util.spec_from_file_location("generate_lichen_frame", SCRIPT)
        if spec is None or spec.loader is None:
            raise RuntimeError("No se pudo cargar el generador de la plantilla.")
        cls.generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.generator)

    def _media_boxes_mm(self, filename: str) -> list[tuple[float, float]]:
        raw = (ASSETS / filename).read_bytes()
        boxes = re.findall(rb"/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]", raw)
        return [(float(width) * 25.4 / 72, float(height) * 25.4 / 72) for width, height in boxes]

    def test_plotter_and_a4_pdf_physical_dimensions(self) -> None:
        plotter = self._media_boxes_mm("lichendr-frame-0.2-plotter.pdf")
        self.assertEqual(len(plotter), 1)
        self.assertAlmostEqual(plotter[0][0], 180.0, places=3)
        self.assertAlmostEqual(plotter[0][1], 580.0, places=3)
        a4 = self._media_boxes_mm("lichendr-frame-0.2-a4-3pages.pdf")
        self.assertEqual(len(a4), 3)
        for width, height in a4:
            self.assertAlmostEqual(width, 210.0, places=3)
            self.assertAlmostEqual(height, 297.0, places=3)

    def test_manifest_confirms_exact_window_and_markers(self) -> None:
        manifest = json.loads((ASSETS / "lichendr-frame-0.2-spec.json").read_text())
        self.assertEqual(manifest["inner_window_mm"], [40.0, 40.0, 100.0, 500.0])
        self.assertEqual(manifest["marker_size_mm"], 20.0)
        self.assertEqual(manifest["marker_top_left_mm"], {
            "0": [15.0, 15.0],
            "1": [145.0, 15.0],
            "2": [15.0, 545.0],
            "3": [145.0, 545.0],
        })
        self.assertEqual(manifest["dictionary"], "DICT_5X5_50")
        self.assertEqual(manifest["cells_mm"], [100.0, 100.0])
        self.assertEqual(manifest["scale_bar_mm"], 100.0)

    def test_generated_marker_modules_are_detected_as_all_four_expected_ids(self) -> None:
        canvas = np.full((1800, 1800), 255, dtype=np.uint8)
        positions = [(100, 100), (1000, 100), (100, 1000), (1000, 1000)]
        for marker_id, (x, y) in enumerate(positions):
            modules = self.generator._marker_modules(marker_id)
            marker = np.where(np.kron(modules, np.ones((100, 100), dtype=bool)), 0, 255).astype(np.uint8)
            canvas[y:y + 700, x:x + 700] = marker
        dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_50)
        detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
        _, ids, _ = detector.detectMarkers(canvas)
        self.assertIsNotNone(ids)
        self.assertEqual(set(int(value) for value in ids.flatten()), {0, 1, 2, 3})


if __name__ == "__main__":
    unittest.main()
