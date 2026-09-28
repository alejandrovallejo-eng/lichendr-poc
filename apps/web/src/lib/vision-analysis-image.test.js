"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_test_1 = __importDefault(require("node:test"));
const sharp_1 = __importDefault(require("sharp"));
const vision_analysis_image_1 = require("./vision-analysis-image");
const LARGE_FILE_BYTES = 5 * 1024 * 1024;
async function padPastFunctionLimit(path, currentSize) {
    if (currentSize <= LARGE_FILE_BYTES) {
        await (0, promises_1.appendFile)(path, Buffer.alloc(LARGE_FILE_BYTES + 1 - currentSize));
    }
}
(0, node_test_1.default)("creates an oriented 2048 px proxy from a 24 MP JPEG larger than 4.5 MB", async () => {
    const directory = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "lichendr-jpeg-test-"));
    const path = (0, node_path_1.join)(directory, "large.jpg");
    try {
        const info = await (0, sharp_1.default)({
            create: { width: 6000, height: 4000, channels: 3, background: "#668844" },
        }).jpeg({ quality: 95 }).toFile(path);
        await padPastFunctionLimit(path, info.size);
        const proxy = await (0, vision_analysis_image_1.createAnalysisProxy)(path, "image/jpeg");
        strict_1.default.equal(proxy.originalWidth, 6000);
        strict_1.default.equal(proxy.originalHeight, 4000);
        strict_1.default.equal(proxy.proxyWidth, vision_analysis_image_1.MAX_PROXY_DIMENSION);
        strict_1.default.equal(proxy.proxyHeight, 1365);
        strict_1.default.equal((await (0, sharp_1.default)(proxy.data).metadata()).format, "jpeg");
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("applies EXIF orientation before preserving scientific dimensions", async () => {
    const directory = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "lichendr-orientation-test-"));
    const path = (0, node_path_1.join)(directory, "oriented.jpg");
    try {
        await (0, sharp_1.default)({
            create: { width: 600, height: 1200, channels: 3, background: "#668844" },
        }).jpeg().withMetadata({ orientation: 6 }).toFile(path);
        const proxy = await (0, vision_analysis_image_1.createAnalysisProxy)(path, "image/jpeg");
        strict_1.default.deepEqual([proxy.originalWidth, proxy.originalHeight, proxy.proxyWidth, proxy.proxyHeight], [1200, 600, 1200, 600]);
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("creates a 2048 px proxy from a real 48 MP HEIC larger than 4.5 MB", async (context) => {
    const python = process.env.PYTHON_BIN ?? "python3";
    const available = (0, node_child_process_1.spawnSync)(python, ["-c", "import pillow_heif"], { encoding: "utf8" });
    if (available.status !== 0) {
        context.skip("pillow-heif is not installed");
        return;
    }
    const directory = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "lichendr-heic-test-"));
    const path = (0, node_path_1.join)(directory, "large.heic");
    try {
        const generated = (0, node_child_process_1.spawnSync)(python, [
            "-c",
            [
                "from PIL import Image",
                "from pillow_heif import from_pillow",
                "import sys",
                "from_pillow(Image.new('RGB', (8000, 6000), (102, 136, 68))).save(sys.argv[1], quality=95)",
            ].join(";"),
            path,
        ], { encoding: "utf8" });
        strict_1.default.equal(generated.status, 0, generated.stderr);
        const metadata = await (0, sharp_1.default)(path).metadata();
        strict_1.default.equal(metadata.width, 8000);
        strict_1.default.equal(metadata.height, 6000);
        const { size } = await Promise.resolve().then(() => __importStar(require("node:fs/promises"))).then(({ stat }) => stat(path));
        await padPastFunctionLimit(path, size);
        const proxy = await (0, vision_analysis_image_1.createAnalysisProxy)(path, "image/heic");
        strict_1.default.deepEqual([proxy.originalWidth, proxy.originalHeight, proxy.proxyWidth, proxy.proxyHeight], [8000, 6000, 2048, 1536]);
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("rejects a compressed image above the decoded-pixel safety limit", async () => {
    const directory = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "lichendr-bomb-test-"));
    const path = (0, node_path_1.join)(directory, "oversized.jpg");
    try {
        await (0, sharp_1.default)({
            create: { width: 11000, height: 9100, channels: 3, background: "#668844" },
        }).jpeg().toFile(path);
        await strict_1.default.rejects((0, vision_analysis_image_1.createAnalysisProxy)(path, "image/jpeg"), /pixel limit|Input image exceeds pixel limit/i);
    }
    finally {
        await (0, promises_1.rm)(directory, { recursive: true, force: true });
    }
});
