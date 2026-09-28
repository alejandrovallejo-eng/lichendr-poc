"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ORIGINAL_BYTES = exports.ANALYSIS_PROXY_VERSION = exports.ANALYSIS_PROXY_BUCKET = void 0;
exports.analysisProxyPaths = analysisProxyPaths;
exports.validateAnalysisSource = validateAnalysisSource;
exports.ensureAnalysisProxy = ensureAnalysisProxy;
exports.validSignedStorageUrl = validSignedStorageUrl;
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const promises_2 = require("node:stream/promises");
const node_crypto_1 = require("node:crypto");
const vision_analysis_image_1 = require("./vision-analysis-image");
exports.ANALYSIS_PROXY_BUCKET = "lichen-images";
exports.ANALYSIS_PROXY_VERSION = 1;
exports.MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
function analysisProxyPaths(userId, imageId) {
    const directory = `${userId}/analysis-proxies/${imageId}`;
    return {
        directory,
        image: `${directory}/v${exports.ANALYSIS_PROXY_VERSION}.jpg`,
    };
}
function validateAnalysisSource(image, userId) {
    const mime = image.mime_type.toLowerCase();
    if (image.storage_bucket !== exports.ANALYSIS_PROXY_BUCKET
        || !image.storage_path.startsWith(`${userId}/`)
        || image.storage_path.includes("..")
        || !ACCEPTED_MIMES.has(mime)
        || !Number.isSafeInteger(image.file_size_bytes)
        || image.file_size_bytes <= 0
        || image.file_size_bytes > exports.MAX_ORIGINAL_BYTES) {
        return null;
    }
    return mime;
}
async function ensureAnalysisProxy(supabase, userId, imageId, source) {
    const mime = validateAnalysisSource(source, userId);
    if (!mime)
        throw new Error("invalid_source");
    const paths = analysisProxyPaths(userId, imageId);
    const existing = await loadExistingManifest(supabase, paths, imageId, source);
    if (existing)
        return { manifest: existing, reused: true };
    const { data: signed, error: signedError } = await supabase.storage
        .from(exports.ANALYSIS_PROXY_BUCKET)
        .createSignedUrl(source.storage_path, 120);
    if (signedError || !signed || !validSignedStorageUrl(signed.signedUrl, source.storage_path)) {
        throw new Error("source_authorization_failed");
    }
    const temporaryDirectory = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "lichendr-analysis-"));
    const originalPath = (0, node_path_1.join)(temporaryDirectory, "source");
    try {
        await downloadOriginal(signed.signedUrl, mime, source.file_size_bytes, originalPath);
        const generated = await (0, vision_analysis_image_1.createAnalysisProxy)(originalPath, mime);
        const unsignedManifest = {
            version: exports.ANALYSIS_PROXY_VERSION,
            imageId,
            sourcePath: source.storage_path,
            sourceMime: mime,
            sourceSizeBytes: source.file_size_bytes,
            proxyPath: paths.image,
            proxyMime: "image/jpeg",
            proxySizeBytes: generated.data.byteLength,
            originalWidth: generated.originalWidth,
            originalHeight: generated.originalHeight,
            proxyWidth: generated.proxyWidth,
            proxyHeight: generated.proxyHeight,
        };
        const manifest = {
            ...unsignedManifest,
            signature: signManifest(unsignedManifest),
        };
        const { error: proxyError } = await supabase.storage
            .from(exports.ANALYSIS_PROXY_BUCKET)
            .upload(paths.image, generated.data, {
            cacheControl: "31536000",
            contentType: manifest.proxyMime,
            metadata: { analysisManifest: JSON.stringify(manifest) },
            upsert: true,
        });
        if (proxyError)
            throw new Error("proxy_upload_failed");
        return { manifest, reused: false };
    }
    finally {
        await (0, promises_1.rm)(temporaryDirectory, { recursive: true, force: true });
    }
}
async function loadExistingManifest(supabase, paths, imageId, source) {
    try {
        const { data: proxy, error } = await supabase.storage
            .from(exports.ANALYSIS_PROXY_BUCKET)
            .info(paths.image);
        if (error || !proxy)
            return null;
        const rawManifest = proxy.metadata?.analysisManifest;
        if (typeof rawManifest !== "string" || rawManifest.length > 16 * 1024)
            return null;
        const value = JSON.parse(rawManifest);
        if (value.version !== exports.ANALYSIS_PROXY_VERSION
            || value.imageId !== imageId
            || value.sourcePath !== source.storage_path
            || value.sourceMime !== source.mime_type.toLowerCase()
            || value.sourceSizeBytes !== source.file_size_bytes
            || value.proxyPath !== paths.image
            || value.proxyMime !== "image/jpeg"
            || !validManifestSignature(value)
            || !positiveInteger(value.proxySizeBytes)
            || !positiveInteger(value.originalWidth)
            || !positiveInteger(value.originalHeight)
            || !positiveInteger(value.proxyWidth)
            || !positiveInteger(value.proxyHeight)
            || Math.max(value.proxyWidth, value.proxyHeight) > vision_analysis_image_1.MAX_PROXY_DIMENSION) {
            return null;
        }
        const size = Number(proxy.size ?? 0);
        return size === value.proxySizeBytes
            ? value
            : null;
    }
    catch {
        return null;
    }
}
function positiveInteger(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function signManifest(manifest) {
    const secret = process.env.VISION_SERVICE_TOKEN;
    if (!secret || secret.length < 32)
        throw new Error("proxy_signing_not_configured");
    return (0, node_crypto_1.createHmac)("sha256", secret).update(JSON.stringify(manifest)).digest("hex");
}
function validManifestSignature(value) {
    const signature = value.signature;
    if (!signature || !/^[a-f0-9]{64}$/.test(signature))
        return false;
    const unsigned = { ...value };
    delete unsigned.signature;
    try {
        const expected = Buffer.from(signManifest(unsigned), "hex");
        return (0, node_crypto_1.timingSafeEqual)(expected, Buffer.from(signature, "hex"));
    }
    catch {
        return false;
    }
}
async function downloadOriginal(url, mime, expectedBytes, destination) {
    const response = await fetch(url, {
        headers: { Accept: mime, "User-Agent": "LichenDR-Proxy/1" },
        redirect: "error",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body || response.url !== url)
        throw new Error("source_download_failed");
    const responseMime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (responseMime !== mime)
        throw new Error("source_mime_mismatch");
    const announced = Number(response.headers.get("content-length") ?? expectedBytes);
    if (announced !== expectedBytes || announced > exports.MAX_ORIGINAL_BYTES)
        throw new Error("source_size_mismatch");
    let received = 0;
    const limiter = new node_stream_1.Transform({
        transform(chunk, _encoding, callback) {
            received += chunk.byteLength;
            callback(received <= expectedBytes ? null : new Error("source_size_mismatch"), chunk);
        },
    });
    await (0, promises_2.pipeline)(node_stream_1.Readable.fromWeb(response.body), limiter, (0, node_fs_1.createWriteStream)(destination, { flags: "wx" }));
    if (received !== expectedBytes)
        throw new Error("source_size_mismatch");
}
function validSignedStorageUrl(raw, storagePath) {
    try {
        const signed = new URL(raw);
        const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        const expectedPath = `/storage/v1/object/sign/${exports.ANALYSIS_PROXY_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
        return signed.protocol === "https:"
            && signed.username === ""
            && signed.password === ""
            && signed.host === configured.host
            && signed.pathname === expectedPath
            && signed.searchParams.has("token");
    }
    catch {
        return false;
    }
}
