"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PROXY_DIMENSION = exports.MAX_DECODED_PIXELS = void 0;
exports.createAnalysisProxy = createAnalysisProxy;
const promises_1 = require("node:fs/promises");
const heic_decode_1 = __importDefault(require("heic-decode"));
const sharp_1 = __importDefault(require("sharp"));
exports.MAX_DECODED_PIXELS = 100_000_000;
exports.MAX_PROXY_DIMENSION = 2048;
sharp_1.default.cache(false);
sharp_1.default.concurrency(1);
async function createAnalysisProxy(path, mime) {
    try {
        return await createAnalysisProxyWithSharp(path);
    }
    catch (error) {
        if (!["image/heic", "image/heif"].includes(mime) || !isUnsupportedHeic(error))
            throw error;
        return createAnalysisProxyWithHeicFallback(path);
    }
}
async function createAnalysisProxyWithSharp(path) {
    const input = (0, sharp_1.default)(path, {
        failOn: "error",
        limitInputPixels: exports.MAX_DECODED_PIXELS,
        sequentialRead: true,
    });
    const metadata = await input.metadata();
    if (!positiveInteger(metadata.width) || !positiveInteger(metadata.height))
        throw new Error("invalid_dimensions");
    enforceDecodedPixelLimit(metadata.width, metadata.height);
    const rotated = orientationSwapsDimensions(metadata.orientation);
    const originalWidth = rotated ? metadata.height : metadata.width;
    const originalHeight = rotated ? metadata.width : metadata.height;
    const { data, info } = await input
        .rotate()
        .resize({
        width: exports.MAX_PROXY_DIMENSION,
        height: exports.MAX_PROXY_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp_1.default.kernel.lanczos3,
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
async function createAnalysisProxyWithHeicFallback(path) {
    const encoded = await (0, promises_1.readFile)(path);
    const images = await heic_decode_1.default.all({ buffer: encoded });
    try {
        const first = images[0];
        if (!first || !positiveInteger(first.width) || !positiveInteger(first.height)) {
            throw new Error("invalid_dimensions");
        }
        enforceDecodedPixelLimit(first.width, first.height);
        const decoded = await first.decode();
        const pixels = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
        const { data, info } = await (0, sharp_1.default)(pixels, {
            raw: { width: decoded.width, height: decoded.height, channels: 4 },
            limitInputPixels: exports.MAX_DECODED_PIXELS,
        })
            .resize({
            width: exports.MAX_PROXY_DIMENSION,
            height: exports.MAX_PROXY_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
            kernel: sharp_1.default.kernel.lanczos3,
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
    }
    finally {
        images.dispose();
    }
}
function positiveInteger(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function enforceDecodedPixelLimit(width, height) {
    if (width * height > exports.MAX_DECODED_PIXELS)
        throw new Error("Input image exceeds pixel limit");
}
function orientationSwapsDimensions(orientation) {
    return orientation !== undefined && orientation >= 5 && orientation <= 8;
}
function isUnsupportedHeic(error) {
    const message = error instanceof Error ? error.message : "";
    return /unsupported image format|not a known file format|heif.*unsupported|support for this compression format has not been built in/i.test(message);
}
