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
ALGORITHM_VERSION = "four-view-0.2.2"
CANONICAL_WIDTH = 400
CANONICAL_HEIGHT = 2000
PIXELS_PER_CM = 40
WINDOW_AREA_CM2 = 500.0
EXPECTED_MARKER_IDS = {0, 1, 2, 3}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_DECODED_PIXELS = 60_000_000
MAX_DETECTION_DIMENSION = 4096
MAX_VALIDATED_REPROJECTION_ERROR_PX = 3.0
MAX_ASSISTED_REPROJECTION_ERROR_PX = 6.0
ACCEPTED_MIMES = {"image/jpeg", "image/png", "image/heic", "image/heif"}
_UNSET = object()

# Marker corners relative to the 100 x 500 mm inner window, at 4 px/mm.
_CANONICAL_MARKER_CORNERS = {
    0: np.float32([[-100, -100], [-20, -100], [-20, -20], [-100, -20]]),
    1: np.float32([[420, -100], [500, -100], [500, -20], [420, -20]]),
    2: np.float32([[-100, 2020], [-20, 2020], [-20, 2100], [-100, 2100]]),
    3: np.float32([[420, 2020], [500, 2020], [500, 2100], [420, 2100]]),
}
_CANONICAL_WINDOW = np.float32([
    [0, 0],
    [CANONICAL_WIDTH - 1, 0],
    [CANONICAL_WIDTH - 1, CANONICAL_HEIGHT - 1],
    [0, CANONICAL_HEIGHT - 1],
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
    reprojection_error_px: float | None
    quality_flags: list[str]
    quality_score: float
    source_width: int
    source_height: int
    frame_detection: dict[str, Any]


@dataclass(frozen=True)
class _MarkerObservation:
    corners: np.ndarray
    quality: float
    resolution: tuple[int, int]
    variant: str


@dataclass(frozen=True)
class WindowProposal:
    corners: np.ndarray
    confidence: float
    source: str
    line_support: int


@dataclass(frozen=True)
class FrameDetection:
    markers: dict[int, np.ndarray]
    homography: np.ndarray | None
    detected_ids: list[int]
    missing_ids: list[int]
    rejected_candidate_count: int
    successful_resolution: tuple[int, int] | None
    successful_variant: str | None
    reprojection_error_px: float | None
    method: str
    confidence: float
    rejection_reason: str | None
    proposal: WindowProposal | None
    assisted_eligible: bool
    duplicate_ids: list[int]
    unknown_ids: list[int]


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
            if source.width * source.height > MAX_DECODED_PIXELS:
                raise FrameValidationError(
                    "decoded_image_too_large",
                    "La imagen decodificada es demasiado grande para procesarla con seguridad.",
                )
            exif = source.getexif()
            metadata = {
                "orientation": exif.get(274),
                "captured_at": exif.get(36867),
                "camera_make": exif.get(271),
                "camera_model": exif.get(272),
            }
            image = ImageOps.exif_transpose(source).convert("RGB")
            rgb = np.asarray(image).copy()
    except FrameValidationError:
        raise
    except (OSError, ValueError) as exc:
        raise FrameValidationError("invalid_image", "No se pudo decodificar la imagen.") from exc
    if rgb.shape[0] < 600 or rgb.shape[1] < 300:
        raise FrameValidationError("insufficient_resolution", "Resolución insuficiente para leer la plantilla.")
    return rgb, metadata


def _aruco_dictionary() -> Any:
    return cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_5X5_50)


def _aruco_board() -> Any:
    object_points = np.stack([
        np.column_stack([_CANONICAL_MARKER_CORNERS[index], np.zeros(4, dtype=np.float32)])
        for index in range(4)
    ]).astype(np.float32)
    return cv2.aruco.Board(object_points, _aruco_dictionary(), np.arange(4, dtype=np.int32))


def _detector() -> Any:
    parameters = cv2.aruco.DetectorParameters()
    parameters.adaptiveThreshWinSizeMin = 3
    parameters.adaptiveThreshWinSizeMax = 53
    parameters.adaptiveThreshWinSizeStep = 10
    parameters.minMarkerPerimeterRate = 0.008
    parameters.maxMarkerPerimeterRate = 4.0
    parameters.polygonalApproxAccuracyRate = 0.04
    parameters.minCornerDistanceRate = 0.03
    parameters.minDistanceToBorder = 2
    parameters.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    parameters.cornerRefinementWinSize = 7
    parameters.cornerRefinementMaxIterations = 40
    parameters.cornerRefinementMinAccuracy = 0.02
    parameters.errorCorrectionRate = 0.72
    parameters.detectInvertedMarker = True
    if hasattr(parameters, "useAruco3Detection"):
        parameters.useAruco3Detection = True
    return cv2.aruco.ArucoDetector(_aruco_dictionary(), parameters)


def _pyramid_sizes(width: int, height: int) -> list[tuple[int, int]]:
    longest = max(width, height)
    first = min(longest, MAX_DETECTION_DIMENSION)
    targets = [first, 3072, 2304, 1728, 1152]
    result: list[tuple[int, int]] = []
    for target in targets:
        if target > first or (target < 900 and target != first):
            continue
        scale = target / longest
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        if size not in result:
            result.append(size)
    return result


def _detection_variants(gray: np.ndarray) -> list[tuple[str, np.ndarray]]:
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    gamma_lift = np.clip(np.power(gray.astype(np.float32) / 255.0, 0.68) * 255, 0, 255).astype(np.uint8)
    gamma_dark = np.clip(np.power(gray.astype(np.float32) / 255.0, 1.45) * 255, 0, 255).astype(np.uint8)
    adaptive = cv2.adaptiveThreshold(
        clahe,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        5,
    )
    compressed = gray.astype(np.float32)
    highlights = compressed > 205
    compressed[highlights] = 205 + (compressed[highlights] - 205) * 0.28
    glare_recovery = cv2.createCLAHE(clipLimit=3.2, tileGridSize=(12, 12)).apply(compressed.astype(np.uint8))
    return [
        ("grayscale", gray),
        ("clahe", clahe),
        ("gamma_lift", gamma_lift),
        ("gamma_dark", gamma_dark),
        ("adaptive_threshold", adaptive),
        ("glare_recovery", glare_recovery),
    ]


def _observation_quality(corners: np.ndarray, gray: np.ndarray) -> float:
    perimeter = float(cv2.arcLength(corners.reshape(-1, 1, 2), True))
    x, y, width, height = cv2.boundingRect(corners.astype(np.float32))
    x0, y0 = max(0, x - 2), max(0, y - 2)
    patch = gray[y0:min(gray.shape[0], y + height + 2), x0:min(gray.shape[1], x + width + 2)]
    contrast = float(patch.std()) if patch.size else 0.0
    return perimeter * (1.0 + min(contrast, 96.0) / 96.0)


def _refine_corners(gray: np.ndarray, corners: np.ndarray) -> np.ndarray:
    refined = corners.astype(np.float32).reshape(-1, 1, 2)
    try:
        cv2.cornerSubPix(
            gray,
            refined,
            (5, 5),
            (-1, -1),
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01),
        )
    except cv2.error:
        return corners.astype(np.float32)
    return refined.reshape(4, 2)


def _select_observation(observations: list[_MarkerObservation]) -> _MarkerObservation:
    if len(observations) == 1:
        return observations[0]
    centres = np.float32([item.corners.mean(axis=0) for item in observations])
    median = np.median(centres, axis=0)
    distances = np.linalg.norm(centres - median, axis=1)
    marker_sizes = np.float32([
        cv2.arcLength(item.corners.reshape(-1, 1, 2), True) / 4 for item in observations
    ])
    tolerance = max(3.0, float(np.median(marker_sizes)) * 0.35)
    stable = [item for item, distance in zip(observations, distances) if distance <= tolerance]
    return max(stable or observations, key=lambda item: item.quality)


def _fit_board_homography(markers: dict[int, np.ndarray]) -> tuple[np.ndarray | None, float | None]:
    if len(markers) < 2:
        return None, None
    source = np.concatenate([markers[index] for index in sorted(markers)]).astype(np.float32)
    target = np.concatenate([_CANONICAL_MARKER_CORNERS[index] for index in sorted(markers)]).astype(np.float32)
    homography, _ = cv2.findHomography(source, target, cv2.RANSAC, 4.0)
    if homography is None or not np.isfinite(homography).all() or abs(float(np.linalg.det(homography))) < 1e-10:
        return None, None
    projected = cv2.perspectiveTransform(source.reshape(-1, 1, 2), homography).reshape(-1, 2)
    error = float(np.sqrt(np.mean(np.sum((projected - target) ** 2, axis=1))))
    return homography, error


def _order_quad(points: np.ndarray) -> np.ndarray:
    values = np.asarray(points, dtype=np.float32).reshape(4, 2)
    result = np.zeros((4, 2), dtype=np.float32)
    sums = values.sum(axis=1)
    differences = np.diff(values, axis=1).reshape(-1)
    result[0] = values[np.argmin(sums)]
    result[2] = values[np.argmax(sums)]
    result[1] = values[np.argmin(differences)]
    result[3] = values[np.argmax(differences)]
    return result


def _segments_intersect(first: np.ndarray, second: np.ndarray, third: np.ndarray, fourth: np.ndarray) -> bool:
    def orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
        ab = b - a
        ac = c - a
        return float(ab[0] * ac[1] - ab[1] * ac[0])

    return (
        orientation(first, second, third) * orientation(first, second, fourth) < 0
        and orientation(third, fourth, first) * orientation(third, fourth, second) < 0
    )


def validate_window_corners(
    corners: np.ndarray,
    width: int,
    height: int,
    *,
    require_order: bool = True,
) -> np.ndarray:
    points = np.asarray(corners, dtype=np.float32)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        raise FrameValidationError("invalid_corners", "Las cuatro esquinas deben contener coordenadas válidas.")
    if np.any(points[:, 0] < 0) or np.any(points[:, 0] > width - 1) or np.any(points[:, 1] < 0) or np.any(points[:, 1] > height - 1):
        raise FrameValidationError("corners_outside_image", "Una o más esquinas quedan fuera de la imagen.")
    if _segments_intersect(points[0], points[1], points[2], points[3]) or _segments_intersect(points[1], points[2], points[3], points[0]):
        raise FrameValidationError("crossed_corners", "Las esquinas forman un cuadrilátero cruzado.")
    cross_products = []
    for index in range(4):
        first = points[(index + 1) % 4] - points[index]
        second = points[(index + 2) % 4] - points[(index + 1) % 4]
        cross_products.append(float(first[0] * second[1] - first[1] * second[0]))
    if any(abs(value) < 1e-3 for value in cross_products) or not (all(value > 0 for value in cross_products) or all(value < 0 for value in cross_products)):
        raise FrameValidationError("non_convex_corners", "Las esquinas deben formar un cuadrilátero convexo.")
    ordered = _order_quad(points)
    tolerance = max(width, height) * 0.015
    if require_order and float(np.max(np.linalg.norm(points - ordered, axis=1))) > tolerance:
        raise FrameValidationError(
            "incorrect_corner_order",
            "Ordena las esquinas como superior izquierda, superior derecha, inferior derecha e inferior izquierda.",
        )
    points = ordered
    area = abs(float(cv2.contourArea(points)))
    if area < max(2500.0, width * height * 0.005):
        raise FrameValidationError("window_area_too_small", "El área seleccionada es demasiado pequeña.")
    top = float(np.linalg.norm(points[1] - points[0]))
    right = float(np.linalg.norm(points[2] - points[1]))
    bottom = float(np.linalg.norm(points[2] - points[3]))
    left = float(np.linalg.norm(points[3] - points[0]))
    average_width = (top + bottom) / 2
    average_height = (left + right) / 2
    ratio = average_height / max(average_width, 1e-6)
    if not 2.5 <= ratio <= 8.0:
        raise FrameValidationError(
            "incompatible_window_ratio",
            "La selección no es compatible con la abertura física de proporción 1:5.",
        )
    if min(top, bottom) / max(top, bottom) < 0.3 or min(left, right) / max(left, right) < 0.3:
        raise FrameValidationError("unbalanced_window_edges", "La perspectiva de la selección no es geométricamente segura.")
    return points


def _line_support(edges: np.ndarray, corners: np.ndarray) -> int:
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(35, min(edges.shape) // 20),
        minLineLength=max(30, min(edges.shape) // 12),
        maxLineGap=max(10, min(edges.shape) // 80),
    )
    if lines is None:
        return 0
    supported = 0
    for index in range(4):
        edge = corners[(index + 1) % 4] - corners[index]
        edge_angle = math.atan2(float(edge[1]), float(edge[0]))
        for raw_line in lines[:, 0]:
            line = np.float32([raw_line[2] - raw_line[0], raw_line[3] - raw_line[1]])
            line_angle = math.atan2(float(line[1]), float(line[0]))
            difference = abs((edge_angle - line_angle + math.pi / 2) % math.pi - math.pi / 2)
            if difference <= math.radians(12):
                supported += 1
                break
    return supported


def propose_inner_window(rgb: np.ndarray) -> WindowProposal | None:
    height, width = rgb.shape[:2]
    scale = min(1.0, 1800 / max(width, height))
    resized = cv2.resize(rgb, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    gray = cv2.cvtColor(resized, cv2.COLOR_RGB2GRAY)
    variants = [
        gray,
        cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray),
    ]
    best: WindowProposal | None = None
    for variant in variants:
        edges = cv2.Canny(variant, 45, 145)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            perimeter = cv2.arcLength(contour, True)
            approximate = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
            if len(approximate) != 4 or not cv2.isContourConvex(approximate):
                continue
            scaled_corners = _order_quad(approximate.reshape(4, 2).astype(np.float32))
            try:
                validate_window_corners(
                    scaled_corners,
                    resized.shape[1],
                    resized.shape[0],
                    require_order=False,
                )
            except FrameValidationError:
                continue
            area_ratio = abs(float(cv2.contourArea(scaled_corners))) / (resized.shape[0] * resized.shape[1])
            top = np.linalg.norm(scaled_corners[1] - scaled_corners[0])
            bottom = np.linalg.norm(scaled_corners[2] - scaled_corners[3])
            left = np.linalg.norm(scaled_corners[3] - scaled_corners[0])
            right = np.linalg.norm(scaled_corners[2] - scaled_corners[1])
            ratio = float((left + right) / max(top + bottom, 1e-6))
            aspect_score = max(0.0, 1.0 - abs(math.log(max(ratio, 1e-6) / 5.0)) / math.log(3.2))
            line_support = _line_support(edges, scaled_corners)
            confidence = min(0.82, 0.28 + 0.34 * aspect_score + 0.12 * min(1.0, area_ratio / 0.08) + 0.02 * line_support)
            proposal = WindowProposal(scaled_corners / scale, confidence, "frame_contour", line_support)
            if best is None or proposal.confidence > best.confidence:
                best = proposal
    return best


def _quad_agreement(first: np.ndarray, second: np.ndarray, width: int, height: int) -> tuple[float, float]:
    first = _order_quad(first)
    second = _order_quad(second)
    intersection, _ = cv2.intersectConvexConvex(first.astype(np.float32), second.astype(np.float32))
    union = abs(float(cv2.contourArea(first))) + abs(float(cv2.contourArea(second))) - float(intersection)
    iou = float(intersection) / union if union > 0 else 0.0
    distance = float(np.mean(np.linalg.norm(first - second, axis=1)) / math.hypot(width, height))
    return iou, distance


def inspect_frame(rgb: np.ndarray) -> FrameDetection:
    height, width = rgb.shape[:2]
    original_gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    detector = _detector()
    board = _aruco_board()
    observations: dict[int, list[_MarkerObservation]] = {index: [] for index in range(4)}
    unknown_ids: set[int] = set()
    duplicate_ids: set[int] = set()
    rejected_count = 0
    best_attempt: tuple[int, tuple[int, int], str] | None = None

    for level_width, level_height in _pyramid_sizes(width, height):
        scale_x = level_width / width
        scale_y = level_height / height
        level_gray = cv2.resize(original_gray, (level_width, level_height), interpolation=cv2.INTER_AREA) if (level_width, level_height) != (width, height) else original_gray
        complete_attempts = 0
        for variant_name, variant in _detection_variants(level_gray):
            corners, ids, rejected = detector.detectMarkers(variant)
            rejected_count = max(rejected_count, len(rejected))
            if ids is not None and len(ids) and rejected:
                try:
                    corners, ids, rejected, _ = detector.refineDetectedMarkers(variant, board, corners, ids, rejected)
                    rejected_count = max(rejected_count, len(rejected))
                except cv2.error:
                    pass
            if ids is None:
                continue
            attempt_ids = [int(value) for value in ids.flatten()]
            for marker_id in set(attempt_ids):
                if attempt_ids.count(marker_id) > 1:
                    duplicate_ids.add(marker_id)
            for marker_corners, marker_id in zip(corners, attempt_ids):
                if marker_id not in EXPECTED_MARKER_IDS:
                    unknown_ids.add(marker_id)
                    continue
                refined = _refine_corners(level_gray, np.asarray(marker_corners[0], dtype=np.float32))
                full_resolution = refined / np.float32([scale_x, scale_y])
                observations[marker_id].append(_MarkerObservation(
                    full_resolution,
                    _observation_quality(refined, level_gray),
                    (level_width, level_height),
                    variant_name,
                ))
            candidate = (len(set(attempt_ids) & EXPECTED_MARKER_IDS), (level_width, level_height), variant_name)
            if best_attempt is None or candidate[0] > best_attempt[0]:
                best_attempt = candidate
            if EXPECTED_MARKER_IDS.issubset(attempt_ids):
                complete_attempts += 1
                if complete_attempts >= 2:
                    break
        if complete_attempts >= 2:
            break

    markers = {
        marker_id: _select_observation(items).corners
        for marker_id, items in observations.items()
        if items
    }
    detected_ids = sorted(markers)
    missing_ids = sorted(EXPECTED_MARKER_IDS - set(markers))
    homography, reprojection_error = _fit_board_homography(markers)
    successful_resolution = best_attempt[1] if best_attempt else None
    successful_variant = best_attempt[2] if best_attempt else None
    if not missing_ids and best_attempt is not None and best_attempt[0] < 4:
        successful_variant = "consolidated"
    rejection_reason: str | None = None
    method = "aruco_board_multiscale"
    confidence = 0.0
    proposal: WindowProposal | None = None
    assisted_eligible = False

    if duplicate_ids:
        rejection_reason = "duplicate_markers"
    elif unknown_ids and not detected_ids:
        rejection_reason = "unknown_markers"
    elif not detected_ids:
        rejection_reason = "markers_missing"
    elif missing_ids:
        rejection_reason = "markers_incomplete"
    elif homography is None:
        rejection_reason = "invalid_homography"
    elif reprojection_error is None or reprojection_error > MAX_VALIDATED_REPROJECTION_ERROR_PX:
        rejection_reason = "high_reprojection_error"

    if not missing_ids and not duplicate_ids and homography is not None and reprojection_error is not None and reprojection_error <= MAX_VALIDATED_REPROJECTION_ERROR_PX:
        try:
            source_window = cv2.perspectiveTransform(_CANONICAL_WINDOW.reshape(-1, 1, 2), np.linalg.inv(homography)).reshape(4, 2)
            validate_window_corners(source_window, width, height, require_order=False)
        except (FrameValidationError, np.linalg.LinAlgError, cv2.error):
            rejection_reason = "invalid_frame_geometry"
        else:
            repeat_support = min(len(observations[index]) for index in range(4))
            confidence = min(0.99, 0.82 + 0.04 * min(repeat_support, 3) - 0.05 * reprojection_error)
            return FrameDetection(
                markers,
                homography,
                detected_ids,
                missing_ids,
                rejected_count,
                successful_resolution,
                successful_variant,
                reprojection_error,
                method,
                confidence,
                None,
                None,
                False,
                sorted(duplicate_ids),
                sorted(unknown_ids),
            )

    contour_proposal = propose_inner_window(rgb)
    marker_window: np.ndarray | None = None
    if homography is not None:
        try:
            marker_window = cv2.perspectiveTransform(_CANONICAL_WINDOW.reshape(-1, 1, 2), np.linalg.inv(homography)).reshape(4, 2)
            marker_window = validate_window_corners(marker_window, width, height, require_order=False)
        except (FrameValidationError, np.linalg.LinAlgError, cv2.error):
            marker_window = None
    distributed = len(markers) >= 3 or set(markers) in ({0, 3}, {1, 2})
    if (
        distributed
        and marker_window is not None
        and contour_proposal is not None
        and reprojection_error is not None
        and reprojection_error <= MAX_ASSISTED_REPROJECTION_ERROR_PX
    ):
        iou, distance = _quad_agreement(marker_window, contour_proposal.corners, width, height)
        assisted_eligible = iou >= 0.42 or distance <= 0.055
        if assisted_eligible:
            confidence = min(
                0.88,
                0.46 + 0.09 * len(markers) + 0.16 * max(iou, 1.0 - distance / 0.055) - 0.025 * reprojection_error,
            )
            proposal = WindowProposal(
                contour_proposal.corners,
                max(contour_proposal.confidence, confidence),
                "partial_aruco_and_frame_contour",
                contour_proposal.line_support,
            )
            method = "aruco_partial_frame_contour"
    if proposal is None and contour_proposal is not None:
        proposal = contour_proposal
        confidence = contour_proposal.confidence
        method = "frame_contour"
    elif proposal is None and marker_window is not None:
        proposal = WindowProposal(marker_window, min(0.58, 0.25 + 0.08 * len(markers)), "partial_aruco", 0)
        confidence = proposal.confidence
        method = "aruco_partial"
    if proposal is None:
        rejection_reason = "frame_not_found"

    return FrameDetection(
        markers,
        homography,
        detected_ids,
        missing_ids,
        rejected_count,
        successful_resolution,
        successful_variant,
        reprojection_error,
        method,
        max(0.0, confidence),
        rejection_reason,
        proposal,
        assisted_eligible,
        sorted(duplicate_ids),
        sorted(unknown_ids),
    )


def detection_payload(
    detection: FrameDetection,
    width: int,
    height: int,
    *,
    classification: str | None = None,
    confidence: float | None = None,
    method: str | None = None,
    reprojection_error: float | None | object = _UNSET,
    user_confirmed: bool = False,
) -> dict[str, Any]:
    reported_reprojection = (
        detection.reprojection_error_px
        if reprojection_error is _UNSET
        else reprojection_error
    )
    return {
        "classification": classification,
        "method": method or detection.method,
        "confidence": round(float(detection.confidence if confidence is None else confidence), 4),
        "detected_marker_ids": detection.detected_ids,
        "missing_marker_ids": detection.missing_ids,
        "rejected_candidate_count": detection.rejected_candidate_count,
        "successful_resolution": (
            {"width": detection.successful_resolution[0], "height": detection.successful_resolution[1]}
            if detection.successful_resolution else None
        ),
        "successful_variant": detection.successful_variant,
        "reprojection_error_px": (
            round(float(reported_reprojection), 4)
            if reported_reprojection is not None else None
        ),
        "rejection_reason": detection.rejection_reason,
        "proposal_source": detection.proposal.source if detection.proposal else None,
        "assisted_eligible": detection.assisted_eligible,
        "user_confirmed": user_confirmed,
        "source_width": width,
        "source_height": height,
    }


def _quality_rectification(
    rgb: np.ndarray,
    homography: np.ndarray,
    reprojection_error: float | None,
    detection_payload: dict[str, Any],
    initial_flags: list[str] | None = None,
) -> Rectification:
    flags = list(initial_flags or [])
    inverse = np.linalg.inv(homography)
    source_window = cv2.perspectiveTransform(_CANONICAL_WINDOW.reshape(-1, 1, 2), inverse).reshape(4, 2)
    height, width = rgb.shape[:2]
    validate_window_corners(source_window, width, height, require_order=False)
    classification = detection_payload.get("classification")
    reprojection_limit = (
        MAX_ASSISTED_REPROJECTION_ERROR_PX
        if classification == "assisted"
        else MAX_VALIDATED_REPROJECTION_ERROR_PX
    )
    if reprojection_error is not None and reprojection_error > reprojection_limit:
        flags.append("high_reprojection_error")

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
    opening_span = max(
        np.linalg.norm(source_window[3] - source_window[0]),
        np.linalg.norm(source_window[2] - source_window[1]),
    )
    if opening_span < 700:
        flags.append("insufficient_resolution")
    score = max(0.0, 1.0 - 0.13 * len(set(flags)))
    return Rectification(canonical, homography, reprojection_error, flags, score, width, height, detection_payload)


def rectify_detected_frame(rgb: np.ndarray, detection: FrameDetection) -> Rectification:
    if detection.duplicate_ids:
        raise FrameValidationError("duplicate_markers", "Se detectaron IDs ArUco duplicados.")
    if detection.unknown_ids:
        raise FrameValidationError(
            "unknown_markers",
            f"Marcadores desconocidos: {', '.join(map(str, detection.unknown_ids))}.",
        )
    if detection.missing_ids:
        if detection.detected_ids:
            raise FrameValidationError(
                "markers_incomplete",
                f"Faltan marcadores: {', '.join(map(str, detection.missing_ids))}.",
            )
        raise FrameValidationError("markers_missing", "No se detectaron marcadores ArUco válidos.")
    if detection.homography is None:
        raise FrameValidationError("invalid_homography", "La homografía calculada no es válida.")
    if detection.rejection_reason:
        raise FrameValidationError(
            detection.rejection_reason,
            "Los cuatro marcadores se detectaron, pero la geometría del marco no alcanzó la confianza requerida.",
        )
    height, width = rgb.shape[:2]
    flags: list[str] = []
    if any(
        np.any(marker[:, 0] <= 2) or np.any(marker[:, 0] >= width - 3)
        or np.any(marker[:, 1] <= 2) or np.any(marker[:, 1] >= height - 3)
        for marker in detection.markers.values()
    ):
        flags.append("markers_cut")
    payload = detection_payload(detection, width, height, classification="validated")
    return _quality_rectification(
        rgb,
        detection.homography,
        detection.reprojection_error_px,
        payload,
        flags,
    )


def rectify_frame(rgb: np.ndarray) -> Rectification:
    return rectify_detected_frame(rgb, inspect_frame(rgb))


def confirmed_rectification(
    rgb: np.ndarray,
    normalized_corners: list[dict[str, float]],
    detection: FrameDetection | None = None,
    manual_mode: str = "manual_confirmed",
) -> Rectification:
    height, width = rgb.shape[:2]
    if len(normalized_corners) != 4:
        raise FrameValidationError("invalid_corners", "Debes confirmar exactamente cuatro esquinas.")
    try:
        normalized = np.float32([[float(point["x"]), float(point["y"])] for point in normalized_corners])
    except (KeyError, TypeError, ValueError) as exc:
        raise FrameValidationError("invalid_corners", "Las coordenadas de las esquinas no son válidas.") from exc
    if not np.isfinite(normalized).all() or np.any(normalized < 0) or np.any(normalized > 1):
        raise FrameValidationError("corners_outside_image", "Una o más esquinas quedan fuera de la imagen.")
    absolute = normalized * np.float32([width - 1, height - 1])
    absolute = validate_window_corners(absolute, width, height)
    current_detection = detection or inspect_frame(rgb)
    if manual_mode not in {"manual_confirmed", "manual_assisted_provisional"}:
        raise FrameValidationError("invalid_manual_mode", "El modo de confirmación manual no es válido.")
    classification = manual_mode
    method = (
        "manual_confirmed_corners"
        if manual_mode == "manual_confirmed"
        else "manual_estimated_corners"
    )
    reprojection_error = None
    homography = cv2.getPerspectiveTransform(absolute.astype(np.float32), _CANONICAL_WINDOW)
    if not np.isfinite(homography).all() or abs(float(np.linalg.det(homography))) < 1e-10:
        raise FrameValidationError("invalid_homography", "La homografía confirmada no es válida.")
    payload = detection_payload(
        current_detection,
        width,
        height,
        classification=classification,
        confidence=current_detection.confidence,
        method=method,
        reprojection_error=reprojection_error,
        user_confirmed=True,
    )
    flags = ["manual_geometry_confirmed"]
    if manual_mode == "manual_assisted_provisional":
        flags.append("manual_estimated_geometry")
    return _quality_rectification(rgb, homography, reprojection_error, payload, flags)


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


def estimate_trunk_width(rgb: np.ndarray, rectification: Rectification) -> dict[str, Any] | None:
    """Estimate trunk edges at sampling height using the known 10 cm frame opening."""
    height, width = rgb.shape[:2]
    inverse = np.linalg.inv(rectification.homography)
    canonical_corners = np.array(
        [[[0, 0], [CANONICAL_WIDTH - 1, 0], [CANONICAL_WIDTH - 1, CANONICAL_HEIGHT - 1], [0, CANONICAL_HEIGHT - 1]]],
        dtype=np.float32,
    )
    source = cv2.perspectiveTransform(canonical_corners, inverse)[0]
    left_opening = float((source[0, 0] + source[3, 0]) / 2)
    right_opening = float((source[1, 0] + source[2, 0]) / 2)
    centre_y = int(np.clip(np.mean(source[:, 1]), 0, height - 1))
    opening_width = abs(right_opening - left_opening)
    if opening_width < 12:
        return None

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gradient = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    half_band = max(3, int(height * 0.025))
    profile = gradient[max(0, centre_y - half_band):min(height, centre_y + half_band + 1)].mean(axis=0)
    margin = max(3, int(opening_width * 0.2))
    search_span = max(int(opening_width * 4), margin + 1)
    left_end = max(1, int(min(left_opening, right_opening)) - margin)
    left_start = max(0, left_end - search_span)
    right_start = min(width - 1, int(max(left_opening, right_opening)) + margin)
    right_end = min(width, right_start + search_span)
    if left_end <= left_start or right_end <= right_start:
        return None

    left_x = left_start + int(np.argmax(profile[left_start:left_end]))
    right_x = right_start + int(np.argmax(profile[right_start:right_end]))
    trunk_pixels = right_x - left_x
    if trunk_pixels <= opening_width * 1.05:
        return None

    edge_strength = float(min(profile[left_x], profile[right_x]))
    baseline = float(np.median(profile) + np.std(profile))
    if edge_strength < max(4.0, baseline * 0.55):
        return None

    cm_per_pixel = 10.0 / opening_width
    width_cm = trunk_pixels * cm_per_pixel
    flags = list(rectification.quality_flags)
    if left_x <= left_start + 2 or right_x >= right_end - 3:
        flags.append("trunk_edge_near_search_limit")
    ratio = edge_strength / max(baseline, 1.0)
    confidence = "high" if ratio >= 1.8 and not flags else "medium" if ratio >= 1.05 else "low"
    uncertainty = 0.12 if confidence == "high" else 0.22 if confidence == "medium" else 0.35
    return {
        "width_cm": round(width_cm, 2),
        "min_cm": round(max(10.0, width_cm * (1 - uncertainty)), 2),
        "max_cm": round(width_cm * (1 + uncertainty), 2),
        "left_x_normalized": round(left_x / max(1, width - 1), 6),
        "right_x_normalized": round(right_x / max(1, width - 1), 6),
        "scale_cm_per_pixel": round(cm_per_pixel, 8),
        "confidence": confidence,
        "method": "automatic",
        "quality_flags": sorted(set(flags)),
    }


def rectification_corners(rectification: Rectification) -> list[dict[str, float]]:
    inverse = np.linalg.inv(rectification.homography)
    canonical = np.array(
        [[[0, 0], [CANONICAL_WIDTH - 1, 0], [CANONICAL_WIDTH - 1, CANONICAL_HEIGHT - 1], [0, CANONICAL_HEIGHT - 1]]],
        dtype=np.float32,
    )
    source = cv2.perspectiveTransform(canonical, inverse)[0]
    return [
        {
            "x": round(float(point[0]) / max(1, rectification.source_width - 1), 7),
            "y": round(float(point[1]) / max(1, rectification.source_height - 1), 7),
        }
        for point in source
    ]


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


def analyze_rectification(
    rectification: Rectification,
    metadata: dict[str, Any],
    automatic_masks: list[dict[str, Any]] | None = None,
    source_rgb: np.ndarray | None = None,
) -> dict[str, Any]:
    critical = critical_quality_flags(rectification.quality_flags)
    classification = str(rectification.frame_detection.get("classification") or "validated")
    result: dict[str, Any] = {
        "template_version": TEMPLATE_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "canonical_width": CANONICAL_WIDTH,
        "canonical_height": CANONICAL_HEIGHT,
        "pixels_per_cm": PIXELS_PER_CM,
        "reprojection_error_px": (
            round(rectification.reprojection_error_px, 4)
            if rectification.reprojection_error_px is not None else None
        ),
        "quality_flags": sorted(set(rectification.quality_flags)),
        "quality_score": round(rectification.quality_score, 3),
        "critical_errors": critical,
        "status": "repeat_photo" if critical else "rectification_review",
        "rectified_image_data_url": _encode_image(rectification.canonical_rgb, "JPEG"),
        "preserved_metadata": metadata,
        "model_name": "MobileSAM vit_t",
        "source": f"mobile_sam_cielab:{classification}",
        "frame_detection": rectification.frame_detection,
        "corner_proposal": rectification_corners(rectification),
        "source_width": rectification.source_width,
        "source_height": rectification.source_height,
        "trunk_estimate": estimate_trunk_width(source_rgb, rectification) if source_rgb is not None else None,
    }
    result["metrics"] = None
    return result


def analyze_view(raw: bytes, mime: str, automatic_masks: list[dict[str, Any]]) -> dict[str, Any]:
    rgb, metadata = decode_image(raw, mime)
    return analyze_rectification(rectify_frame(rgb), metadata, source_rgb=rgb)


def aggregate_tree_metrics(views: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [
        view for view in views
        if view.get("metrics")
        and 0 < float(view["metrics"]["valid_area_cm2"]) <= WINDOW_AREA_CM2
        and 0 <= float(view["metrics"]["lichen_union_area_cm2"]) <= float(view["metrics"]["valid_area_cm2"])
        and 0 <= int(view["metrics"]["occupied_cells"]) <= 5
    ]
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
        "tree_lichen_coverage_percent": round(lichen_area / valid_area * 100, 4) if len(valid) == 4 else None,
        "occupied_cells": sum(int(view["metrics"]["occupied_cells"]) for view in valid),
        "provisional_morphotype_richness": len(morphotypes),
        "valid_view_count": len(valid),
        "pending_view_count": 4 - len(valid),
        "algorithm_version": ALGORITHM_VERSION,
    }
