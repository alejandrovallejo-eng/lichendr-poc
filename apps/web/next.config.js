"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sharpRuntimeFiles = [
    "./node_modules/@img/sharp-linux-x64/**/*",
    "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];
const nextConfig = {
    serverExternalPackages: ["sharp"],
    outputFileTracingIncludes: {
        "/api/vision/analysis-proxy": sharpRuntimeFiles,
        "/api/vision/analyze-view": sharpRuntimeFiles,
    },
};
exports.default = nextConfig;
