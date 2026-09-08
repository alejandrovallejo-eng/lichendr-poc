import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import sharp from "sharp";
import { createAnalysisProxy, MAX_PROXY_DIMENSION } from "./vision-analysis-image";

const LARGE_FILE_BYTES = 5 * 1024 * 1024;

async function padPastFunctionLimit(path: string, currentSize: number) {
  if (currentSize <= LARGE_FILE_BYTES) {
    await appendFile(path, Buffer.alloc(LARGE_FILE_BYTES + 1 - currentSize));
  }
}

test("creates an oriented 2048 px proxy from a 24 MP JPEG larger than 4.5 MB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lichendr-jpeg-test-"));
  const path = join(directory, "large.jpg");
  try {
    const info = await sharp({
      create: { width: 6000, height: 4000, channels: 3, background: "#668844" },
    }).jpeg({ quality: 95 }).toFile(path);
    await padPastFunctionLimit(path, info.size);

    const proxy = await createAnalysisProxy(path, "image/jpeg");

    assert.equal(proxy.originalWidth, 6000);
    assert.equal(proxy.originalHeight, 4000);
    assert.equal(proxy.proxyWidth, MAX_PROXY_DIMENSION);
    assert.equal(proxy.proxyHeight, 1365);
    assert.equal((await sharp(proxy.data).metadata()).format, "jpeg");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("applies EXIF orientation before preserving scientific dimensions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lichendr-orientation-test-"));
  const path = join(directory, "oriented.jpg");
  try {
    await sharp({
      create: { width: 600, height: 1200, channels: 3, background: "#668844" },
    }).jpeg().withMetadata({ orientation: 6 }).toFile(path);

    const proxy = await createAnalysisProxy(path, "image/jpeg");

    assert.deepEqual(
      [proxy.originalWidth, proxy.originalHeight, proxy.proxyWidth, proxy.proxyHeight],
      [1200, 600, 1200, 600],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creates a 2048 px proxy from a real 48 MP HEIC larger than 4.5 MB", async (context) => {
  const python = process.env.PYTHON_BIN ?? "python3";
  const available = spawnSync(python, ["-c", "import pillow_heif"], { encoding: "utf8" });
  if (available.status !== 0) {
    context.skip("pillow-heif is not installed");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "lichendr-heic-test-"));
  const path = join(directory, "large.heic");
  try {
    const generated = spawnSync(python, [
      "-c",
      [
        "from PIL import Image",
        "from pillow_heif import from_pillow",
        "import sys",
        "from_pillow(Image.new('RGB', (8000, 6000), (102, 136, 68))).save(sys.argv[1], quality=95)",
      ].join(";"),
      path,
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
    const metadata = await sharp(path).metadata();
    assert.equal(metadata.width, 8000);
    assert.equal(metadata.height, 6000);
    const { size } = await import("node:fs/promises").then(({ stat }) => stat(path));
    await padPastFunctionLimit(path, size);

    const proxy = await createAnalysisProxy(path, "image/heic");

    assert.deepEqual(
      [proxy.originalWidth, proxy.originalHeight, proxy.proxyWidth, proxy.proxyHeight],
      [8000, 6000, 2048, 1536],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a compressed image above the decoded-pixel safety limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lichendr-bomb-test-"));
  const path = join(directory, "oversized.jpg");
  try {
    await sharp({
      create: { width: 11000, height: 9100, channels: 3, background: "#668844" },
    }).jpeg().toFile(path);

    await assert.rejects(
      createAnalysisProxy(path, "image/jpeg"),
      /pixel limit|Input image exceeds pixel limit/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
