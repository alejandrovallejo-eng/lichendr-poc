"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sharp_1 = __importDefault(require("sharp"));
const vision_analysis_proxy_1 = require("./vision-analysis-proxy");
const userId = "123e4567-e89b-42d3-a456-426614174000";
const imageId = "223e4567-e89b-42d3-a456-426614174000";
const sourcePath = `${userId}/project/event/original.jpg`;
class FakeStorage {
    objects = new Map();
    contentTypes = [];
    from(bucket) {
        strict_1.default.equal(bucket, vision_analysis_proxy_1.ANALYSIS_PROXY_BUCKET);
        return {
            download: async (path) => {
                const data = this.objects.get(path);
                return data ? { data: data.body, error: null } : { data: null, error: new Error("missing") };
            },
            createSignedUrl: async (path) => ({
                data: {
                    signedUrl: `https://project.supabase.co/storage/v1/object/sign/${vision_analysis_proxy_1.ANALYSIS_PROXY_BUCKET}/${path}?token=test`,
                },
                error: null,
            }),
            info: async (path) => {
                const data = this.objects.get(path);
                return data
                    ? { data: { size: data.body.size, metadata: data.metadata }, error: null }
                    : { data: null, error: new Error("missing") };
            },
            upload: async (path, value, options) => {
                const content = typeof value === "string" ? value : new Uint8Array(value);
                this.contentTypes.push(options.contentType);
                this.objects.set(path, {
                    body: new Blob([content], { type: options.contentType }),
                    metadata: options.metadata,
                });
                return { error: null };
            },
        };
    }
}
(0, node_test_1.default)("stores a deterministic authenticated proxy once and reuses it", async () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousToken = process.env.VISION_SERVICE_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.VISION_SERVICE_TOKEN = "01234567890123456789012345678901";
    const storage = new FakeStorage();
    const sourceBytes = await (0, sharp_1.default)({
        create: { width: 3000, height: 2000, channels: 3, background: "#668844" },
    }).jpeg().toBuffer();
    const source = {
        storage_bucket: vision_analysis_proxy_1.ANALYSIS_PROXY_BUCKET,
        storage_path: sourcePath,
        mime_type: "image/jpeg",
        file_size_bytes: sourceBytes.byteLength,
    };
    let downloads = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
        downloads += 1;
        const raw = String(url);
        return {
            ok: true,
            body: new Blob([new Uint8Array(sourceBytes)]).stream(),
            url: raw,
            headers: new Headers({
                "content-type": "image/jpeg",
                "content-length": String(sourceBytes.byteLength),
            }),
        };
    });
    try {
        const supabase = { storage };
        const first = await (0, vision_analysis_proxy_1.ensureAnalysisProxy)(supabase, userId, imageId, source);
        const second = await (0, vision_analysis_proxy_1.ensureAnalysisProxy)(supabase, userId, imageId, source);
        const paths = (0, vision_analysis_proxy_1.analysisProxyPaths)(userId, imageId);
        strict_1.default.equal(first.reused, false);
        strict_1.default.equal(second.reused, true);
        strict_1.default.equal(downloads, 1);
        strict_1.default.equal(first.manifest.proxyPath, paths.image);
        strict_1.default.equal(first.manifest.proxyWidth, 2048);
        strict_1.default.equal(first.manifest.proxyHeight, 1365);
        strict_1.default.match(first.manifest.signature, /^[a-f0-9]{64}$/);
        strict_1.default.ok(storage.objects.has(paths.image));
        strict_1.default.equal(storage.objects.size, 1);
        strict_1.default.deepEqual(storage.contentTypes, ["image/jpeg"]);
    }
    finally {
        globalThis.fetch = originalFetch;
        if (previousUrl === undefined)
            delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else
            process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
        if (previousToken === undefined)
            delete process.env.VISION_SERVICE_TOKEN;
        else
            process.env.VISION_SERVICE_TOKEN = previousToken;
    }
});
