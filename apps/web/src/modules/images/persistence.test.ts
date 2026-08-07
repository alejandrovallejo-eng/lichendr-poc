import assert from "node:assert/strict";
import test from "node:test";
import {
  ImagePersistenceError,
  getRetryableImageIds,
  persistImageTransaction,
  sanitizeSupabaseError,
  validateImageFile,
  validateImageSignature,
  validateImageUploadPrerequisites,
} from "./persistence.ts";

const validFile = { name: "lichen.jpg", size: 1_024, type: "image/jpeg" };
const validMetadata = { latitude: "", longitude: "", gpsAccuracyM: "" };
const validContext = {
  userId: "user",
  projectId: "project",
  siteId: "site",
  eventId: "event",
  treeId: "tree",
  treeSampleId: "sample",
};

test("reports missing authentication before upload", () => {
  const missing = validateImageUploadPrerequisites({ ...validContext, userId: "" }, validFile, validMetadata);
  assert.deepEqual(missing, ["usuario autenticado"]);
});

test("reports a missing tree sample before upload", () => {
  const missing = validateImageUploadPrerequisites({ ...validContext, treeSampleId: "" }, validFile, validMetadata);
  assert.deepEqual(missing, ["muestra de árbol"]);
});

test("rejects unsupported MIME types", () => {
  const result = validateImageFile({ name: "lichen.gif", size: 1_024, type: "image/gif" });
  assert.equal(result.valid, false);
  assert.match(result.message ?? "", /JPEG, PNG, HEIC o HEIF/);
});

test("accepts HEIC with matching MIME and extension", () => {
  const result = validateImageFile({ name: "lichen.heic", size: 1_024, type: "image/heic" });
  assert.deepEqual(result, { valid: true, mimeType: "image/heic", message: null });
});

test("validates HEIC signature and brand", async () => {
  const header = new Uint8Array([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31,
  ]);
  assert.equal(await validateImageSignature(new Blob([header]), "image/heic"), true);
  assert.equal(await validateImageSignature(new Blob([new Uint8Array(20)]), "image/heic"), false);
});

test("accepts a valid JPEG", () => {
  assert.deepEqual(validateImageFile(validFile), { valid: true, mimeType: "image/jpeg", message: null });
});

test("validates JPEG file content", async () => {
  const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
  const spoofed = new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38])]);
  assert.equal(await validateImageSignature(jpeg, "image/jpeg"), true);
  assert.equal(await validateImageSignature(spoofed, "image/jpeg"), false);
});

test("accepts a valid PNG", () => {
  assert.deepEqual(
    validateImageFile({ name: "lichen.png", size: 1_024, type: "image/png" }),
    { valid: true, mimeType: "image/png", message: null }
  );
});

function dependencies(overrides: Partial<{
  upload: () => Promise<void>;
  insertImage: () => Promise<{ id: string }>;
  insertMetadata: () => Promise<void>;
  deleteImage: () => Promise<boolean>;
  removeStorage: () => Promise<boolean>;
}> = {}) {
  return {
    upload: overrides.upload ?? (async () => undefined),
    insertImage: overrides.insertImage ?? (async () => ({ id: "image" })),
    insertMetadata: overrides.insertMetadata ?? (async () => undefined),
    deleteImage: overrides.deleteImage ?? (async () => true),
    removeStorage: overrides.removeStorage ?? (async () => true),
  };
}

test("reports a Storage upload failure without attempting database work", async () => {
  let inserted = false;
  let removed = false;
  await assert.rejects(
    persistImageTransaction({}, {}, dependencies({
      upload: async () => { throw { code: "403", message: "RLS denied" }; },
      insertImage: async () => { inserted = true; return { id: "image" }; },
      removeStorage: async () => { removed = true; return true; },
    })),
    (error: unknown) => error instanceof ImagePersistenceError
      && error.stage === "Subida a Storage"
      && error.code === "403"
  );
  assert.equal(inserted, false);
  assert.equal(removed, true);
});

test("reports a database insert failure and removes the uploaded object", async () => {
  let removed = false;
  await assert.rejects(
    persistImageTransaction({}, {}, dependencies({
      insertImage: async () => { throw { code: "23503", message: "foreign key violation" }; },
      removeStorage: async () => { removed = true; return true; },
    })),
    (error: unknown) => error instanceof ImagePersistenceError
      && error.stage === "Registro en base de datos"
      && error.canRetry
  );
  assert.equal(removed, true);
});

test("reports successful database and Storage rollback after metadata failure", async () => {
  await assert.rejects(
    persistImageTransaction({}, {}, dependencies({
      insertMetadata: async () => { throw new Error("metadata failed"); },
    })),
    (error: unknown) => error instanceof ImagePersistenceError
      && error.cleanup?.databaseSucceeded === true
      && error.cleanup.storageSucceeded === true
      && error.canRetry
  );
});

test("reports rollback failure and blocks an unsafe retry", async () => {
  await assert.rejects(
    persistImageTransaction({}, {}, dependencies({
      insertMetadata: async () => { throw new Error("metadata failed"); },
      deleteImage: async () => false,
      removeStorage: async () => false,
    })),
    (error: unknown) => error instanceof ImagePersistenceError
      && error.stage === "Limpieza posterior"
      && !error.canRetry
  );
});

test("allows retry after a recoverable failure", async () => {
  let attempts = 0;
  const save = async () => {
    attempts += 1;
    return persistImageTransaction({}, {}, dependencies({
      upload: async () => {
        if (attempts === 1) throw new Error("temporary failure");
      },
    }));
  };
  await assert.rejects(save(), ImagePersistenceError);
  assert.deepEqual(await save(), { id: "image" });
  assert.equal(attempts, 2);
});

test("prevents retrying already saved images", () => {
  assert.deepEqual(getRetryableImageIds([
    { id: "saved", saveState: "saved" },
    { id: "failed", saveState: "error" },
    { id: "orphan", saveState: "cleanup-pending" },
  ]), ["failed"]);
});

test("keeps successful files when another file fails", async () => {
  const outcomes: string[] = [];
  for (const id of ["success", "failure"]) {
    try {
      await persistImageTransaction({}, {}, dependencies({
        upload: async () => {
          if (id === "failure") throw new Error("network");
        },
      }));
      outcomes.push(`${id}:saved`);
    } catch {
      outcomes.push(`${id}:failed`);
    }
  }
  assert.deepEqual(outcomes, ["success:saved", "failure:failed"]);
});

test("sanitizes tokens and preserves safe Supabase code/message details", () => {
  const sensitiveValue = ["private", "value"].join("-");
  const result = sanitizeSupabaseError({
    code: "storage_error",
    message: `${["authorization", sensitiveValue].join(": ")} https://example.test/x?${["access_token", sensitiveValue].join("=")}\n    at internal/file.ts:1`,
  });
  assert.equal(result.code, "storage_error");
  assert.match(result.message, /\[storage_error\]/);
  assert.equal(result.message.includes(sensitiveValue), false);
  assert.equal(result.message.includes("internal/file"), false);
});
