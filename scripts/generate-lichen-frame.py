#!/usr/bin/env python3
"""Generate the vector LICHENDR-FRAME-0.2 plotter and tiled A4 PDFs."""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

MM_TO_PT = 72 / 25.4
FRAME_WIDTH_MM = 180.0
FRAME_HEIGHT_MM = 580.0
WINDOW_X_MM = 40.0
WINDOW_Y_MM = 40.0
WINDOW_WIDTH_MM = 100.0
WINDOW_HEIGHT_MM = 500.0
MARKER_SIZE_MM = 20.0
MARKERS = {
    0: (15.0, 15.0),
    1: (145.0, 15.0),
    2: (15.0, 545.0),
    3: (145.0, 545.0),
}
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "field-assets"


def pt(value_mm: float) -> float:
    return value_mm * MM_TO_PT


def _text(x: float, y_from_top: float, text: str, size: float, page_height: float) -> str:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"BT /F1 {size:.2f} Tf {pt(x):.5f} {pt(page_height - y_from_top):.5f} Td ({escaped}) Tj ET"


def _rect(x: float, y: float, width: float, height: float, page_height: float, *, fill: bool = False) -> str:
    operator = "f" if fill else "S"
    return (
        f"{pt(x):.5f} {pt(page_height - y - height):.5f} "
        f"{pt(width):.5f} {pt(height):.5f} re {operator}"
    )


def _marker_modules(marker_id: int) -> np.ndarray:
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_50)
    marker = cv2.aruco.generateImageMarker(dictionary, marker_id, 700)
    return np.array([[marker[row * 100 + 50, column * 100 + 50] == 0 for column in range(7)] for row in range(7)])


def _draw_marker(marker_id: int, x: float, y: float, page_height: float) -> list[str]:
    module = MARKER_SIZE_MM / 7
    commands = ["0 g"]
    for row, column in np.argwhere(_marker_modules(marker_id)):
        commands.append(_rect(x + column * module, y + row * module, module, module, page_height, fill=True))
    commands.append(_text(x + 6, y + MARKER_SIZE_MM + 4, f"ID {marker_id}", 7, page_height))
    return commands


def _frame_commands(page_width: float, page_height: float, offset_y: float = 0.0, offset_x: float = 0.0) -> str:
    def local_y(global_y: float) -> float:
        return global_y - offset_y

    commands = ["0 G 0 g 0.8 w"]
    commands.append(_rect(offset_x + WINDOW_X_MM, local_y(WINDOW_Y_MM), WINDOW_WIDTH_MM, WINDOW_HEIGHT_MM, page_height))
    for index in range(1, 5):
        y = local_y(WINDOW_Y_MM + index * 100)
        commands.append(
            f"[4 3] 0 d {pt(offset_x + WINDOW_X_MM):.5f} {pt(page_height - y):.5f} m "
            f"{pt(offset_x + WINDOW_X_MM + WINDOW_WIDTH_MM):.5f} {pt(page_height - y):.5f} l S [] 0 d"
        )
    for marker_id, (x, y) in MARKERS.items():
        commands.extend(_draw_marker(marker_id, offset_x + x, local_y(y), page_height))
    commands.extend([
        _text(offset_x + 42, local_y(13), "LICHENDR-FRAME-0.2", 10, page_height),
        _text(offset_x + 42, local_y(23), "Imprimir a tamaño real / 100%", 8, page_height),
        _text(offset_x + 42, local_y(34), "Ventana interior exacta 100 x 500 mm", 7, page_height),
    ])
    swatches = [(15, 270, 0.0, "NEGRO"), (145, 270, 0.5, "GRIS"), (145, 310, 1.0, "BLANCO")]
    for x, y, gray, label in swatches:
        commands.append(f"{gray:.2f} g")
        commands.append(_rect(offset_x + x, local_y(y), 20, 20, page_height, fill=True))
        commands.append("0 G 0 g")
        commands.append(_rect(offset_x + x, local_y(y), 20, 20, page_height))
        commands.append(_text(offset_x + x, local_y(y + 27), label, 6, page_height))
    scale_y = local_y(575)
    commands.extend([
        f"2 w {pt(offset_x + 15):.5f} {pt(page_height - scale_y):.5f} m "
        f"{pt(offset_x + 115):.5f} {pt(page_height - scale_y):.5f} l S 0.8 w",
        _text(offset_x + 40, local_y(572), "BARRA 10 cm", 7, page_height),
    ])
    return "\n".join(commands)


def _write_pdf(path: Path, pages: list[tuple[float, float, str]]) -> None:
    objects: list[bytes] = []
    page_object_ids: list[int] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for width, height, content in pages:
        content_bytes = content.encode("latin-1", "replace")
        content_id = len(objects) + 2
        page_id = len(objects) + 1
        page_object_ids.append(page_id)
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pt(width):.5f} {pt(height):.5f}] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
            ).encode()
        )
        objects.append(f"<< /Length {len(content_bytes)} >>\nstream\n".encode() + content_bytes + b"\nendstream")
    kids = " ".join(f"{item} 0 R" for item in page_object_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_object_ids)} >>".encode()
    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode())
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    path.write_bytes(output)


def generate() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    plotter = _frame_commands(FRAME_WIDTH_MM, FRAME_HEIGHT_MM)
    _write_pdf(OUTPUT_DIR / "lichendr-frame-0.2-plotter.pdf", [(FRAME_WIDTH_MM, FRAME_HEIGHT_MM, plotter)])
    segments = [(0.0, 195.0), (192.5, 195.0), (385.0, 195.0)]
    a4_pages: list[tuple[float, float, str]] = []
    for index, (offset, _) in enumerate(segments, start=1):
        content = [
            "q",
            f"{pt(15):.5f} {pt(51):.5f} {pt(180):.5f} {pt(195):.5f} re W n",
            _frame_commands(210.0, 297.0, offset_y=offset, offset_x=15.0),
            "Q",
            _text(15, 275, f"LICHENDR-FRAME-0.2 · página {index}/3 · solape 2.5 mm", 8, 297.0),
            _text(15, 285, "Imprimir a tamaño real / 100% y alinear las líneas de la ventana.", 7, 297.0),
        ]
        a4_pages.append((210.0, 297.0, "\n".join(content)))
    _write_pdf(OUTPUT_DIR / "lichendr-frame-0.2-a4-3pages.pdf", a4_pages)
    manifest = {
        "template_version": "LICHENDR-FRAME-0.2",
        "dictionary": "DICT_5X5_50",
        "frame_mm": [FRAME_WIDTH_MM, FRAME_HEIGHT_MM],
        "inner_window_mm": [WINDOW_X_MM, WINDOW_Y_MM, WINDOW_WIDTH_MM, WINDOW_HEIGHT_MM],
        "cells_mm": [100.0, 100.0],
        "marker_size_mm": MARKER_SIZE_MM,
        "marker_top_left_mm": {str(key): list(value) for key, value in MARKERS.items()},
        "scale_bar_mm": 100.0,
        "print_scale_percent": 100,
    }
    (OUTPUT_DIR / "lichendr-frame-0.2-spec.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    generate()
