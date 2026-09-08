export interface AnnotationRasterTarget {
  target_storage_path: string | null;
  target_width_px: number | null;
  target_height_px: number | null;
}

export interface MaskRasterMetadata {
  mask_width_px: number;
  mask_height_px: number;
}

export function annotationRasterPath(target: AnnotationRasterTarget, originalPath: string): string {
  return target.target_storage_path ?? originalPath;
}

export function isMaskCompatibleWithTarget(
  region: MaskRasterMetadata,
  target: AnnotationRasterTarget,
  renderedWidth: number,
  renderedHeight: number,
): boolean {
  const expectedWidth = target.target_width_px ?? renderedWidth;
  const expectedHeight = target.target_height_px ?? renderedHeight;
  return (
    expectedWidth === renderedWidth
    && expectedHeight === renderedHeight
    && region.mask_width_px === expectedWidth
    && region.mask_height_px === expectedHeight
  );
}
