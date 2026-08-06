"""Scientific four-view frame validation, rectification, and provisional metrics."""
from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

TEMPLATE_VERSION = "LICHENDR-FRAME-0.2"
ALGORITHM_VERSION = "four-view-0.2.0"
CANONICAL_WIDTH = 400
CANONICAL_HEIGHT = 2000
PIXELS_PER_CM = 40
WINDOW_AREA_CM2 = 500.0
EXPECTED_MARKER_IDS = {0, 1, 2, 3}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
ACCEPTED_MIMES = {"image/jpeg", "image/png", "image/heic", "image/heif"}

# Marker centres relative to the 100 x 500 mm inner window, at 4 px/mm.
_CANONICAL_MARKER_CENTRES = np.float32([
    [-60.0, -60.0],
    [460.0, -60.0],
    [-60.0, 2060.0],
    [460.0, 2060.0],
])


class FrameValidationError(ValueError):
    """A safe validation error that can be shown to a field user."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Rectification:
    canonical_rgb: np.ndarray
    homography: np.ndarray
    reprojection_error_px: float
    quality_flags: list[str]
    quality_score: float
    source_width: int
    source_height: int


def validate_image_payload(raw: bytes, mime: str) -> str:
    normalized = mime.split(";", 1)[0].strip().lower()
    if normalized not in ACCEPTED_MIMES:
        raise FrameValidationError("unsupported_mime", "Formato no admitido. Usa JPEG, PNG, HEIC o HEIF.")
    if not raw:
        raise FrameValidationError("empty_image", "El archivo está vacío.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise FrameValidationError("image_too_large", "La imagen supera el límite de 20 MB.")
    if normalized == "image/jpeg" and not raw.startswith(b"\xff\xd8\xff"):
        raise FrameValidationError("mime_signature_mismatch", "El contenido no corresponde a un JPEG válido.")
    if normalized == "image/png" and not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise FrameValidationError("mime_signature_mismatch", "El contenido no corresponde a un PNG válido.")
    if normalized in {"image/heic", "image/heif"}:
        if len(raw) < 12 or raw[4:8] != b"ftyp":
            raise FrameValidationError("mime_signature_mismatch", "El contenido no corresponde a un HEIC/HEIF válido.")
        brand = raw[8:12]
        compatible = raw[8:32]
        valid_brands = (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1")
        if brand not in valid_brands and not any(item in compatible for item in valid_brands):
            raise FrameValidationError("mime_signature_mismatch", "La firma HEIC/HEIF no es reconocida.")
    return normalized


def decode_image(raw: bytes, mime: str) -> tuple[np.ndarray, dict[str, Any]]:
    normalized = validate_image_payload(raw, mime)
    if normalized in {"image/heic", "image/heif"}:
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError as exc:
            raise FrameValidationError("heic_decoder_unavailable", "El servicio no puede convertir HEIC/HEIF.") from exc
    try:
        with Image.open(io.BytesIO(raw)) as source:
            exif = source.getexif()
            metadata = {
                "orientation": exif.get(274),
                "captured_at": exif.get(36867),
                "camera_make": exif.get(271),
                "camera_model": exif.get(272),
            }
            image = ImageOps.exif_transpose(source).convert("RGB")
            rgb = np.asarray(image).copy()
    except (OSError, ValueError) as exc:
        raise FrameValidationError("invalid_image", "No se pudo decodificar la imagen.") from exc
    if rgb.shape[0] < 600 or rgb.shape[1] < 300:
        raise FrameValidationError("insufficient_resolution", "Resolución insuficiente para leer la plantilla.")
    return rgb, metadata


def _detect_markers(rgb: np.ndarray) -> tuple[dict[int, np.ndarray], list[str]]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_50)
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _ = detector.detectMarkers(gray)
    if ids is None:
        raise FrameValidationError("markers_missing", "No se detectaron los cuatro marcadores ArUco.")
    detected_ids = [int(value) for value in ids.flatten()]
    if len(detected_ids) != len(set(detected_ids)):
        raise FrameValidationError("duplicate_markers", "Se detectaron IDs ArUco duplicados.")
    unknown = sorted(set(detected_ids) - EXPECTED_MARKER_IDS)
    if unknown:
        raise FrameValidationError("unknown_markers", f"Marcadores desconocidos: {', '.join(map(str, unknown))}.")
    missing = sorted(EXPECTED_MARKER_IDS - set(detected_ids))
    if missing:
        raise FrameValidationError("markers_incomplete", f"Faltan marcadores: {', '.join(map(str, missing))}.")
    by_id = {marker_id: np.asarray(marker_corners[0], dtype=np.float32) for marker_id, marker_corners in zip(detected_ids, corners)}
    height, width = gray.shape
    flags: list[str] = []
    if any(
        np.any(marker[:, 0] <= 2) or np.any(marker[:, 0] >= width - 3)
        or np.any(marker[:, 1] <= 2) or np.any(marker[:, 1] >= height - 3)
        for marker in by_id.values()
    ):
        flags.append("markers_cut")
    return by_id, flags


def rectify_frame(rgb: np.ndarray) -> Rectification:
    markers, flags = _detect_markers(rgb)
    centres = np.float32([markers[index].mean(axis=0) for index in range(4)])
    homography = cv2.getPerspectiveTransform(centres, _CANONICAL_MARKER_CENTRES)
    if not np.isfinite(homography).all() or abs(float(np.linalg.det(homography))) < 1e-10:
        raise FrameValidationError("invalid_homography", "La homografía calculada no es válida.")
    projected = cv2.perspectiveTransform(centres.reshape(-1, 1, 2), homography).reshape(-1, 2)
    reprojection_error = float(np.sqrt(np.mean(np.sum((projected - _CANONICAL_MARKER_CENTRES) ** 2, axis=1))))
    if reprojection_error > 3:
        flags.append("high_reprojection_error")

    inverse = np.linalg.inv(homography)
    source_window = cv2.perspectiveTransform(
        np.float32([[[0, 0], [CANONICAL_WIDTH - 1, 0], [CANONICAL_WIDTH - 1, CANONICAL_HEIGHT - 1], [0, CANONICAL_HEIGHT - 1]]]),
        inverse,
    )[0]
    height, width = rgb.shape[:2]
    if (
        np.any(source_window[:, 0] < -1) or np.any(source_window[:, 0] > width)
        or np.any(source_window[:, 1] < -1) or np.any(source_window[:, 1] > height)
    ):
        raise FrameValidationError("window_outside_image", "La ventana de 10 × 50 cm queda fuera de la fotografía.")

    canonical = cv2.warpPerspective(
        rgb,
        homography,
        (CANONICAL_WIDTH, CANONICAL_HEIGHT),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    gray = cv2.cvtColor(canonical, cv2.COLOR_RGB2GRAY)
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_light = float(gray.mean())
    bright_ratio = float(np.count_nonzero(gray >= 250) / gray.size)
    dark_ratio = float(np.count_nonzero(gray <= 8) / gray.size)
    if blur_variance < 120:
        flags.append("blur")
    if mean_light > 235 or bright_ratio > 0.30:
        flags.append("overexposure")
    if mean_light < 25 or dark_ratio > 0.30:
        flags.append("underexposure")
    if bright_ratio > 0.08:
        flags.append("glare")
    marker_span = max(np.linalg.norm(centres[0] - centres[3]), np.linalg.norm(centres[1] - centres[2]))
    if marker_span < 700:
        flags.append("insufficient_resolution")
    score = max(0.0, 1.0 - 0.13 * len(set(flags)))
    return Rectification(canonical, homography, reprojection_error, flags, score, width, height)


def critical_quality_flags(flags: list[str]) -> list[str]:
    critical = {
        "markers_cut", "high_reprojection_error", "blur", "overexposure",
        "underexposure", "insufficient_resolution",
    }
    return sorted(set(flags) & critical)


def _encode_image(rgb: np.ndarray, image_format: str) -> str:
    image = Image.fromarray(rgb)
    output = io.BytesIO()
    options = {"quality": 90, "optimize": True} if image_format == "JPEG" else {"optimize": True}
    image.save(output, format=image_format, **options)
    mime = "image/jpeg" if image_format == "JPEG" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(output.getvalue()).decode('ascii')}"


def _encode_mask(mask: np.ndarray) -> str:
    return _encode_image(np.where(mask, 255, 0).astype(np.uint8), "PNG")


def _filter_masks(masks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    minimum = CANONICAL_WIDTH * CANONICAL_HEIGHT * 0.0005
    retained: list[dict[str, Any]] = []
    for candidate in sorted(masks, key=lambda item: int(np.count_nonzero(item["mask"])), reverse=True):
        mask = np.asarray(candidate["mask"], dtype=bool)
        area = int(np.count_nonzero(mask))
        if area < minimum or area > mask.size * 0.92:
            continue
        duplicate = False
        for existing in retained:
            other = existing["mask"]
            intersection = int(np.count_nonzero(mask & other))
            union = int(np.count_nonzero(mask | other))
            if union and intersection / union > 0.88:
                duplicate = True
                break
            if intersection / max(1, area) > 0.98:
                duplicate = True
                break
        if not duplicate:
            retained.append({**candidate, "mask": mask})
    return retained[:24]


def calculate_provisional_metrics(
    canonical_rgb: np.ndarray,
    candidate_masks: list[dict[str, Any]],
    quality_flags: list[str],
) -> dict[str, Any]:
    candidates = _filter_masks(candidate_masks)
    lab = cv2.cvtColor(canonical_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    gray = cv2.cvtColor(canonical_rgb, cv2.COLOR_RGB2GRAY)
    global_lab = np.median(lab.reshape(-1, 3), axis=0)
    classified: list[dict[str, Any]] = []
    lichen_masks: list[np.ndarray] = []
    morphotype_centres: list[np.ndarray] = []
    for candidate in candidates:
        mask = candidate["mask"]
        pixels = lab[mask]
        mean_lab = pixels.mean(axis=0)
        delta = float(np.linalg.norm(mean_lab - global_lab))
        texture = float(gray[mask].std())
        lightness = float(mean_lab[0])
        green_bias = float(mean_lab[1] - 128)
        if lightness < 24 or lightness > 242:
            classification = "shadow_reflection"
        elif green_bias < -7 and texture > 7:
            classification = "possible_moss_algae"
        elif delta >= 10 and texture >= 6:
            classification = "possible_lichen"
        else:
            classification = "unknown"
        morphotype: str | None = None
        if classification == "possible_lichen":
            lichen_masks.append(mask)
            group = next((index for index, centre in enumerate(morphotype_centres) if np.linalg.norm(mean_lab - centre) < 14), None)
            if group is None:
                morphotype_centres.append(mean_lab)
                group = len(morphotype_centres) - 1
            morphotype = f"LQ-{group + 1:03d}"
        classified.append({
            "classification": classification,
            "morphotype": morphotype,
            "confidence": round(float(candidate.get("score", 0.0)), 4),
            "area_pixels": int(np.count_nonzero(mask)),
            "representative_lab": [round(float(value), 2) for value in mean_lab],
        })

    union = np.zeros((CANONICAL_HEIGHT, CANONICAL_WIDTH), dtype=bool)
    morphotype_masks: dict[str, np.ndarray] = {}
    for candidate, details in zip(candidates, classified):
        if details["classification"] != "possible_lichen":
            continue
        union |= candidate["mask"]
        code = details["morphotype"]
        morphotype_masks.setdefault(code, np.zeros_like(union))
        morphotype_masks[code] |= candidate["mask"]
    valid_pixels = CANONICAL_WIDTH * CANONICAL_HEIGHT
    union_pixels = int(np.count_nonzero(union))
    occupied_cells = sum(bool(np.any(union[index * 400:(index + 1) * 400])) for index in range(5))
    area_per_pixel = WINDOW_AREA_CM2 / valid_pixels
    return {
        "valid_area_cm2": WINDOW_AREA_CM2,
        "lichen_union_area_cm2": round(union_pixels * area_per_pixel, 4),
        "lichen_coverage_percent": round(union_pixels / valid_pixels * 100, 4),
        "component_count": len(lichen_masks),
        "occupied_cells": occupied_cells,
        "provisional_morphotype_richness": len(morphotype_masks),
        "morphotype_coverage": {
            code: round(np.count_nonzero(mask) / valid_pixels * 100, 4)
            for code, mask in morphotype_masks.items()
        },
        "quality_score": round(max(0.0, 1.0 - 0.13 * len(set(quality_flags))), 3),
        "quality_flags": sorted(set(quality_flags)),
        "candidates": classified,
        "lichen_union_mask_data_url": _encode_mask(union),
    }


def analyze_view(raw: bytes, mime: str, automatic_masks: list[dict[str, Any]]) -> dict[str, Any]:
    rgb, metadata = decode_image(raw, mime)
    rectification = rectify_frame(rgb)
    critical = critical_quality_flags(rectification.quality_flags)
    result: dict[str, Any] = {
        "template_version": TEMPLATE_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "canonical_width": CANONICAL_WIDTH,
        "canonical_height": CANONICAL_HEIGHT,
        "pixels_per_cm": PIXELS_PER_CM,
        "reprojection_error_px": round(rectification.reprojection_error_px, 4),
        "quality_flags": sorted(set(rectification.quality_flags)),
        "quality_score": round(rectification.quality_score, 3),
        "critical_errors": critical,
        "status": "repeat_photo" if critical else "provisional_ai",
        "rectified_image_data_url": _encode_image(rectification.canonical_rgb, "JPEG"),
        "preserved_metadata": metadata,
        "model_name": "MobileSAM vit_t",
        "source": "mobile_sam_cielab",
    }
    if critical:
        result["metrics"] = None
        return result
    result["metrics"] = calculate_provisional_metrics(
        rectification.canonical_rgb,
        automatic_masks,
        rectification.quality_flags,
    )
    return result


def aggregate_tree_metrics(views: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [view for view in views if view.get("metrics")]
    valid_area = sum(float(view["metrics"]["valid_area_cm2"]) for view in valid)
    lichen_area = sum(float(view["metrics"]["lichen_union_area_cm2"]) for view in valid)
    morphotypes = {
        code
        for view in valid
        for code in view["metrics"].get("morphotype_coverage", {})
    }
    return {
        "total_valid_area_cm2": round(valid_area, 4),
        "total_lichen_area_cm2": round(lichen_area, 4),
        "tree_lichen_coverage_percent": round(lichen_area / valid_area * 100, 4) if valid_area else None,
        "occupied_cells": sum(int(view["metrics"]["occupied_cells"]) for view in valid),
        "provisional_morphotype_richness": len(morphotypes),
        "valid_view_count": len(valid),
        "pending_view_count": 4 - len(valid),
        "algorithm_version": ALGORITHM_VERSION,
    }
