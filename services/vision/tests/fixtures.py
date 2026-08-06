from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image


def synthetic_frame(*, perspective: bool = False, missing_id: int | None = None, wrong_id: int | None = None) -> np.ndarray:
    canvas = np.full((2320, 720, 3), 238, dtype=np.uint8)
    y_grid, x_grid = np.indices((2000, 400))
    texture = ((x_grid // 12 + y_grid // 12) % 2) * 32
    canvas[160:2160, 160:560] = np.stack([
        100 + texture,
        82 + texture,
        58 + texture,
    ], axis=-1)
    cv2.ellipse(canvas, (300, 700), (100, 180), 15, 0, 360, (186, 176, 80), -1)
    cv2.rectangle(canvas, (210, 1300), (470, 1650), (150, 162, 90), -1)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_50)
    centres = [(100, 100), (620, 100), (100, 2220), (620, 2220)]
    for marker_id, (x, y) in enumerate(centres):
        if marker_id == missing_id:
            continue
        actual_id = wrong_id if marker_id == 3 and wrong_id is not None else marker_id
        marker = cv2.aruco.generateImageMarker(dictionary, actual_id, 80)
        canvas[y - 40:y + 40, x - 40:x + 40] = cv2.cvtColor(marker, cv2.COLOR_GRAY2RGB)
    if not perspective:
        return canvas
    source = np.float32([[0, 0], [719, 0], [719, 2319], [0, 2319]])
    target = np.float32([[160, 90], [820, 210], [720, 2460], [40, 2290]])
    transform = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(canvas, transform, (900, 2550), borderValue=(255, 255, 255))


def encode(rgb: np.ndarray, image_format: str = "PNG") -> bytes:
    output = io.BytesIO()
    Image.fromarray(rgb).save(output, format=image_format)
    return output.getvalue()

