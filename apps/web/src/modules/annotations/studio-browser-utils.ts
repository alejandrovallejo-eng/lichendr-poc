export interface WorkingImage {
  element: HTMLImageElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface BlobBackedImage {
  element: HTMLImageElement;
  objectUrl: string;
}

export interface MaskPoint {
  x: number;
  y: number;
}

export function loadCrossOriginImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo cargar la imagen con acceso a píxeles."));
    image.src = source;
  });
}

export async function loadBlobBackedImage(source: string, signal?: AbortSignal): Promise<BlobBackedImage> {
  let response: Response;
  try {
    response = await fetch(source, { signal });
  } catch (reason) {
    if ((reason as { name?: string }).name === "AbortError") throw reason;
    throw new Error("No se pudo descargar la imagen.");
  }
  if (!response.ok) throw new Error("No se pudo descargar la imagen.");
  const declaredType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!declaredType.startsWith("image/")) throw new Error("El archivo descargado no es una imagen válida.");
  const blob = await response.blob();
  if (blob.size === 0 || !blob.type.toLowerCase().startsWith("image/")) {
    throw new Error("El archivo descargado no es una imagen válida.");
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return { element: await loadCrossOriginImage(objectUrl), objectUrl };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("No se pudo abrir la imagen descargada.");
  }
}

export function validateRasterDimensions(width: number, height: number, maximumDimension = 1024): number {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > maximumDimension
    || height > maximumDimension
  ) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  return width * height;
}

export function createWorkingImage(element: HTMLImageElement, maximumDimension = 1024): WorkingImage {
  const naturalWidth = element.naturalWidth;
  const naturalHeight = element.naturalHeight;
  if (
    !Number.isFinite(naturalWidth)
    || !Number.isFinite(naturalHeight)
    || naturalWidth <= 0
    || naturalHeight <= 0
    || !Number.isFinite(maximumDimension)
    || maximumDimension <= 0
  ) {
    throw new Error("Las dimensiones de la imagen no son válidas.");
  }
  const scale = Math.min(1, maximumDimension / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  validateRasterDimensions(width, height, maximumDimension);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("No se pudo preparar el lienzo de la imagen.");
  try {
    context.drawImage(element, 0, 0, width, height);
  } catch {
    throw new Error("No se pudo preparar la imagen para el análisis.");
  }
  return { element, canvas, width, height };
}

export function readWorkingImagePixels(image: WorkingImage): Uint8ClampedArray {
  const pixelCount = validateRasterDimensions(image.width, image.height);
  const context = image.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No fue posible leer los colores de esta imagen.");
  try {
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    if (pixels.length !== pixelCount * 4) {
      throw new Error("Los píxeles no coinciden con las dimensiones de la imagen.");
    }
    return pixels;
  } catch {
    throw new Error("No fue posible leer los colores de esta imagen.");
  }
}

export async function loadMaskFromUrl(source: string, width: number, height: number): Promise<Uint8Array> {
  const pixelCount = validateRasterDimensions(width, height);
  const loaded = await loadBlobBackedImage(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo leer la máscara guardada.");
    context.imageSmoothingEnabled = false;
    context.drawImage(loaded.element, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    if (pixels.length !== pixelCount * 4) throw new Error("La máscara guardada tiene dimensiones inválidas.");
    const mask = new Uint8Array(pixelCount);
    for (let index = 0; index < mask.length; index += 1) {
      const pixelIndex = index * 4;
      if (pixels[pixelIndex] >= 128 && pixels[pixelIndex + 3] >= 128) {
        mask[index] = 1;
      }
    }
    return mask;
  } finally {
    URL.revokeObjectURL(loaded.objectUrl);
  }
}

export function drawMask(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  width: number,
  height: number,
  color: [number, number, number],
  alpha = 170,
): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const pixelIndex = index * 4;
    imageData.data[pixelIndex] = color[0];
    imageData.data[pixelIndex + 1] = color[1];
    imageData.data[pixelIndex + 2] = color[2];
    imageData.data[pixelIndex + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);
}

export function rasterizePolygon(points: readonly MaskPoint[], width: number, height: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || points.length < 3) return new Uint8Array(width * height);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  context.fillStyle = "#ffffff";
  context.fill();
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    if (pixels[index * 4 + 3] >= 128) mask[index] = 1;
  }
  return mask;
}

export function polygonArea(points: readonly MaskPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

export function createRoiMask(
  width: number,
  height: number,
  roi: { x: number | null; y: number | null; width: number | null; height: number | null },
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const startX = Math.max(0, Math.floor((roi.x ?? 0) * width));
  const startY = Math.max(0, Math.floor((roi.y ?? 0) * height));
  const endX = Math.min(width, Math.ceil(((roi.x ?? 0) + (roi.width ?? 1)) * width));
  const endY = Math.min(height, Math.ceil(((roi.y ?? 0) + (roi.height ?? 1)) * height));
  for (let y = startY; y < endY; y += 1) {
    mask.fill(1, y * width + startX, y * width + endX);
  }
  return mask;
}

export function sampleMedianRgb(canvas: HTMLCanvasElement, x: number, y: number, patchSize = 7): [number, number, number] {
  const radius = Math.floor(patchSize / 2);
  const startX = Math.max(0, Math.round(x) - radius);
  const startY = Math.max(0, Math.round(y) - radius);
  const patchWidth = Math.min(canvas.width - startX, patchSize);
  const patchHeight = Math.min(canvas.height - startY, patchSize);
  if (patchWidth <= 0 || patchHeight <= 0) throw new Error("No se pudo muestrear ese punto.");
  let pixels: Uint8ClampedArray;
  try {
    pixels = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(startX, startY, patchWidth, patchHeight).data
      ?? new Uint8ClampedArray();
  } catch {
    throw new Error("El navegador bloqueó el muestreo de color de esta imagen.");
  }
  if (pixels.length === 0) throw new Error("No se pudo leer el color de la imagen.");
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    red.push(pixels[index]);
    green.push(pixels[index + 1]);
    blue.push(pixels[index + 2]);
  }
  const median = (values: number[]) => {
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  };
  return [median(red), median(green), median(blue)];
}

export function rgbToHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function maskToPngBlob(mask: Uint8Array, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("No se pudo codificar la máscara."));
  const imageData = context.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] === 0 ? 0 : 255;
    const pixelIndex = index * 4;
    imageData.data[pixelIndex] = value;
    imageData.data[pixelIndex + 1] = value;
    imageData.data[pixelIndex + 2] = value;
    imageData.data[pixelIndex + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo crear el PNG de la máscara."));
    }, "image/png");
  });
}
