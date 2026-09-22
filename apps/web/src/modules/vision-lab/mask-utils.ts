export function createMaskBitmap(mask: number[][]): Uint8ClampedArray {
  const height = mask.length;
  const width = mask[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const visible = mask[y]?.[x] === 1;
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = visible ? 255 : 0;
    }
  }

  return data;
}

export function countMaskPixels(mask: number[][]): number {
  return mask.reduce((count, row) => count + row.filter((value) => value === 1).length, 0);
}

export function buildMaskFromPoints(width: number, height: number, points: Array<{ x: number; y: number; label: 1 | 0 }>): number[][] {
  const grid = Array.from({ length: height }, () => Array(width).fill(0));
  const radius = Math.max(2, Math.round(Math.min(width, height) / 80));

  points.forEach((point) => {
    const px = Math.round(point.x * (width - 1));
    const py = Math.round(point.y * (height - 1));
    for (let y = Math.max(0, py - radius); y <= Math.min(height - 1, py + radius); y += 1) {
      for (let x = Math.max(0, px - radius); x <= Math.min(width - 1, px + radius); x += 1) {
        const dist = Math.hypot(x - px, y - py);
        if (dist <= radius) {
          grid[y][x] = point.label === 1 ? 1 : 0;
        }
      }
    }
  });

  return grid;
}
