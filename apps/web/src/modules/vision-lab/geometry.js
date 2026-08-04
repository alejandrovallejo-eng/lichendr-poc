export function mapStagePointToImagePoint(pointerPosition, stageWidth, stageHeight, viewScale, viewX, viewY, assetWidth, assetHeight) {
  const safeStageWidth = Math.max(stageWidth, 1);
  const safeStageHeight = Math.max(stageHeight, 1);
  const contentX = (pointerPosition.x - viewX) / Math.max(viewScale, 0.001);
  const contentY = (pointerPosition.y - viewY) / Math.max(viewScale, 0.001);
  const normalizedX = Math.min(1, Math.max(0, contentX / safeStageWidth));
  const normalizedY = Math.min(1, Math.max(0, contentY / safeStageHeight));

  return {
    x: normalizedX * assetWidth,
    y: normalizedY * assetHeight,
  };
}

export function clampPointToImageBounds(point, assetWidth, assetHeight) {
  return {
    x: Math.min(assetWidth, Math.max(0, point.x)),
    y: Math.min(assetHeight, Math.max(0, point.y)),
  };
}
