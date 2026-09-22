import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, sep, resolve } from "node:path";
import sharp from "sharp";

if (process.platform === "linux" && process.arch === "x64") {
  const nativeRoot = resolve("node_modules/@img/sharp-linux-x64");
  const libvipsRoot = resolve("node_modules/@img/sharp-libvips-linux-x64");
  const nativePackage = JSON.parse(await readFile(resolve(nativeRoot, "package.json"), "utf8"));
  const libvipsPackage = JSON.parse(await readFile(resolve(libvipsRoot, "package.json"), "utf8"));
  assert.equal(nativePackage.version, "0.35.4", "Unexpected linux-x64 Sharp native version");
  assert.equal(libvipsPackage.version, "1.3.3", "Unexpected linux-x64 libvips version");

  const tracePaths = [
    ".next/server/app/api/vision/analysis-proxy/route.js.nft.json",
    ".next/server/app/api/vision/analyze-view/route.js.nft.json",
  ];
  for (const relativeTracePath of tracePaths) {
    const tracePath = resolve(relativeTracePath);
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    assert.ok(Array.isArray(trace.files), `${relativeTracePath} does not contain a file list`);
    const tracedFiles = trace.files.map((file) => resolve(dirname(tracePath), file));
    assert.ok(
      tracedFiles.some((file) => (
        file.startsWith(`${nativeRoot}${sep}`)
        && file.endsWith(".node")
      )),
      `${relativeTracePath} is missing the pinned linux-x64 Sharp native addon`,
    );
    assert.ok(
      tracedFiles.some((file) => (
        file.startsWith(`${libvipsRoot}${sep}`)
        && file.includes(`${sep}lib${sep}libvips-cpp.so.`)
      )),
      `${relativeTracePath} is missing the pinned linux-x64 libvips shared library`,
    );
  }
}

const source = await sharp({
  create: {
    width: 8,
    height: 6,
    channels: 3,
    background: "#638747",
  },
}).png().toBuffer();
const transformed = await sharp(source).rotate().resize(4, 3).jpeg().toBuffer();
const metadata = await sharp(transformed).metadata();
assert.deepEqual(
  { format: metadata.format, width: metadata.width, height: metadata.height },
  { format: "jpeg", width: 4, height: 3 },
  "Sharp could not transform an image with the installed production runtime",
);

console.log("Sharp production runtime and traced linux-x64 libvips files verified.");
