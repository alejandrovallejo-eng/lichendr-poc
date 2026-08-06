from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "generate-lichen-frame.py"
ASSETS = ROOT / "docs" / "field-assets"


class FramePdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(["python", str(SCRIPT)], check=True)

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
        self.assertEqual(set(manifest["marker_top_left_mm"]), {"0", "1", "2", "3"})
        self.assertEqual(manifest["dictionary"], "DICT_5X5_50")


if __name__ == "__main__":
    unittest.main()
