"""Turning MobileSAM masks into BioCLIP crops with controlled context.

Rules, applied identically here and in the web client
(`apps/web/src/modules/region-suggestions/crop-geometry.ts`):

* the crop is the mask bounding box expanded by a relative context margin, so
  the classifier sees some surrounding substrate instead of an isolated blob;
* the box is clamped to the image, never re-centred and never centre-cropped:
  the whole proposed region is always inside the crop, extremes included;
* boxes are expanded to a minimum size, capped to a maximum size (a region
  larger than the cap is downscaled afterwards, not truncated), and
  near-duplicate boxes are collapsed so the same patch is not classified twice;
* the crop is resized to the encoder resolution by the encoder preprocessing,
  which resizes the *whole* crop; no additional centre crop is applied.

Every returned box records the transformation chain so a suggestion can be
mapped back to the original photograph.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

CONTEXT_MARGIN_RATIO = 0.25
MIN_CROP_SIDE = 48
MAX_CROP_SIDE = 1024
DUPLICATE_IOU = 0.92


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return max(0, self.width) * max(0, self.height)

    def as_dict(self) -> dict:
        return asdict(self)


def mask_bounding_box(mask: list[list[int]] | list[bytearray]) -> Box | None:
    """Tight bounding box of the non-zero pixels of a binary mask."""

    min_x: int | None = None
    min_y: int | None = None
    max_x = 0
    max_y = 0
    for y, row in enumerate(mask):
        for x, value in enumerate(row):
            if not value:
                continue
            if min_x is None or x < min_x:
                min_x = x
            if min_y is None or y < min_y:
                min_y = y
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if min_x is None or min_y is None:
        return None
    return Box(min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)


def expand_with_context(
    box: Box,
    image_width: int,
    image_height: int,
    *,
    margin_ratio: float = CONTEXT_MARGIN_RATIO,
    min_side: int = MIN_CROP_SIDE,
) -> Box:
    """Expand a box with relative context, clamped to the image bounds."""

    if image_width <= 0 or image_height <= 0:
        raise ValueError("Image dimensions must be positive.")
    margin_x = box.width * margin_ratio
    margin_y = box.height * margin_ratio
    left = box.x - margin_x
    top = box.y - margin_y
    right = box.x + box.width + margin_x
    bottom = box.y + box.height + margin_y

    # Grow to the minimum side without ever cutting the original box.
    if right - left < min_side:
        deficit = min_side - (right - left)
        left -= deficit / 2
        right += deficit / 2
    if bottom - top < min_side:
        deficit = min_side - (bottom - top)
        top -= deficit / 2
        bottom += deficit / 2

    left_i = max(0, int(left))
    top_i = max(0, int(top))
    right_i = min(image_width, int(right + 0.999))
    bottom_i = min(image_height, int(bottom + 0.999))

    # Clamping must never eat into the region itself.
    left_i = min(left_i, box.x)
    top_i = min(top_i, box.y)
    right_i = max(right_i, min(image_width, box.x + box.width))
    bottom_i = max(bottom_i, min(image_height, box.y + box.height))

    return Box(left_i, top_i, max(1, right_i - left_i), max(1, bottom_i - top_i))


def intersection_over_union(first: Box, second: Box) -> float:
    left = max(first.x, second.x)
    top = max(first.y, second.y)
    right = min(first.x + first.width, second.x + second.width)
    bottom = min(first.y + first.height, second.y + second.height)
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    union = first.area + second.area - intersection
    return intersection / union if union > 0 else 0.0


def deduplicate(boxes: list[Box], *, threshold: float = DUPLICATE_IOU) -> list[Box]:
    """Drop boxes that are near-duplicates of an already kept box."""

    kept: list[Box] = []
    for box in boxes:
        if any(intersection_over_union(box, other) >= threshold for other in kept):
            continue
        kept.append(box)
    return kept


def scale_to_max_side(box: Box, *, max_side: int = MAX_CROP_SIDE) -> float:
    """Downscale factor that keeps the *whole* crop under the size cap."""

    longest = max(box.width, box.height)
    if longest <= max_side:
        return 1.0
    return max_side / longest


def apply_exif_orientation_to_box(
    box: Box,
    orientation: int,
    image_width: int,
    image_height: int,
) -> Box:
    """Map a box expressed on the raw pixels to the EXIF-oriented image.

    Only the orientations that PIL/`exifr` can produce are handled; anything
    else is rejected instead of silently mis-placing a mask.
    """

    if orientation in (0, 1):
        return box
    x, y, w, h = box.x, box.y, box.width, box.height
    if orientation == 2:
        return Box(image_width - x - w, y, w, h)
    if orientation == 3:
        return Box(image_width - x - w, image_height - y - h, w, h)
    if orientation == 4:
        return Box(x, image_height - y - h, w, h)
    if orientation == 5:
        return Box(y, x, h, w)
    if orientation == 6:
        return Box(image_height - y - h, x, h, w)
    if orientation == 7:
        return Box(image_height - y - h, image_width - x - w, h, w)
    if orientation == 8:
        return Box(y, image_width - x - w, h, w)
    raise ValueError(f"Unsupported EXIF orientation: {orientation}")
