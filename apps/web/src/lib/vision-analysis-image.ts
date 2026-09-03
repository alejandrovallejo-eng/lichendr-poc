import { readFile } from "node:fs/promises";
import decodeHeic from "heic-decode";
import sharp from "sharp";

export const MAX_DECODED_PIXELS = 100_000_000;
export const MAX_PROXY_DIMENSION = 2048;

sharp.cache(false);
sharp.concurrency(1);

export async function createAnalysisProxy(path: string, mime: string) {
  try {
    return await createAnalysisProxyWithSharp(path);
  } catch (error) {
    if (!["image/heic", "image/heif"].includes(mime) || !isUnsupportedHeic(error)) throw error;
    return createAnalysisProxyWithHeicFallback(path);
  }
}

async function createAnalysisProxyWithSharp(path: string) {
  const input = sharp(path, {
    failOn: "error",
    limitInputPixels: MAX_DECODED_PIXELS,
    sequentialRead: true,
  });
  const metadata = await input.metadata();
  if (!positiveInteger(metadata.width) || !positiveInteger(metadata.height)) throw new Error("invalid_dimensions");
  enforceDecodedPixelLimit(metadata.width, metadata.height);
  const rotated = orientationSwapsDimensions(metadata.orientation);
  const originalWidth = rotated ? metadata.height : metadata.width;
  const originalHeight = rotated ? metadata.width : metadata.height;
  const { data, info } = await input
    .rotate()
    .resize({
      width: MAX_PROXY_DIMENSION,
      height: MAX_PROXY_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    originalWidth,
    originalHeight,
    proxyWidth: info.width,
    proxyHeight: info.height,
  };
}

async function createAnalysisProxyWithHeicFallback(path: string) {
  const encoded = await readFile(path);
  const images = await decodeHeic.all({ buffer: encoded });
  try {
    const first = images[0];
    if (!first || !positiveInteger(first.width) || !positiveInteger(first.height)) {
      throw new Error("invalid_dimensions");
    }
    enforceDecodedPixelLimit(first.width, first.height);
    const decoded = await first.decode();
    const pixels = Buffer.from(
      decoded.data.buffer,
      decoded.data.byteOffset,
      decoded.data.byteLength,
    );
    const { data, info } = await sharp(pixels, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
      limitInputPixels: MAX_DECODED_PIXELS,
    })
      .resize({
        width: MAX_PROXY_DIMENSION,
        height: MAX_PROXY_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      data,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      proxyWidth: info.width,
      proxyHeight: info.height,
    };
  } finally {
    images.dispose();
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function enforceDecodedPixelLimit(width: number, height: number) {
  if (width * height > MAX_DECODED_PIXELS) throw new Error("Input image exceeds pixel limit");
}

function orientationSwapsDimensions(orientation: number | undefined) {
  return orientation !== undefined && orientation >= 5 && orientation <= 8;
}

function isUnsupportedHeic(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /unsupported image format|not a known file format|heif.*unsupported|support for this compression format has not been built in/i.test(message);
}
