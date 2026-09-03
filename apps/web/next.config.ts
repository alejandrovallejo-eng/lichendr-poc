import type { NextConfig } from "next";

const sharpRuntimeFiles = [
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp"],
  outputFileTracingIncludes: {
    "/api/vision/analysis-proxy": sharpRuntimeFiles,
    "/api/vision/analyze-view": sharpRuntimeFiles,
  },
};

export default nextConfig;
