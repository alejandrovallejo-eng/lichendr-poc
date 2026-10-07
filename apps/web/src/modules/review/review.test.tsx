import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readReviewProject } from "./client.ts";

test("review uses the contributor's photo paths and never writes or invokes models", async () => {
  const template = JSON.parse(readFileSync("public/demo/v1/review.json", "utf8"));
  const paths: string[] = [];
  const source = {
    projects: [{ id: "project", name: "Compartido", owner_id: "contributor" }],
    sites: [{ id: "site", name: "Sitio", project_id: "project" }],
    events: [{ id: "event", name: "Jornada", site_id: "site", sampled_at: "2026-10-06" }],
    trees: [{ id: "tree", code: "001", site_id: "site" }],
    samples: [{ id: "sample", tree_id: "tree", site_id: "site", sampling_event_id: "event" }],
    series: [{ id: "series", tree_sample_id: "sample", created_at: "2026-10-06" }],
    captures: [{ id: "capture", capture_series_id: "series", image_id: "image", direction: "N", active: true }],
    reviews: [{ image_id: "image", tree_sample_id: "sample", owner_id: "contributor", direction: "N", review: template.review, revision: 1 }],
    images: [{ id: "image", tree_sample_id: "sample", storage_path: "contributor/original.jpg", original_filename: "ejemplo.jpg", created_at: "2026-10-06" }],
  };
  const fake = {
    rpc: async (name: string, args: unknown) => { assert.equal(name, "read_review_project"); assert.deepEqual(args, { p_project_id: "project" }); return { data: source, error: null }; },
    from: () => { throw Error("unexpected_table_query"); },
    storage: { from: () => ({ download: async (path: string) => { paths.push(path); return { data: new Blob(["photo"]), error: null }; } }) },
  } as unknown as SupabaseClient;
  const result = await readReviewProject(fake, "project");
  assert.equal(result.rows[0].savedCount, 1);
  const ref = { ownerId: "contributor", imageId: "image", treeSampleId: "sample", direction: "N" as const };
  assert.equal((await result.services.cloud.read(ref))!.revision, 1);
  assert.equal(await result.services.cloud.read({ ...ref, ownerId: "viewer" }), null);
  await result.services.storedPhoto("contributor", "image");
  assert.deepEqual(paths, ["contributor/analysis-proxies/image/v1.jpg"]);
  await result.originalPhoto("image");
  assert.equal(paths[1], "contributor/original.jpg");
  await assert.rejects(result.originalPhoto("other"), /no pertenece/);
  source.images[0].storage_path = "unrelated/private.jpg";
  await assert.rejects(result.originalPhoto("image"), /no pertenece/);
  await assert.rejects(result.services.storedPhoto("viewer", "image"), /no pertenece/);
  await assert.rejects(result.services.storedPhoto("contributor", "other"), /no pertenece/);
  await assert.rejects(result.services.cloud.write(ref, template.review, 1), /consulta/);
});
test("revoked or mismatched snapshots fail closed", async () => {
  for (const data of [null, { projects: [{ id: "wrong" }] }]) {
    const fake = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
    await assert.rejects(readReviewProject(fake, "project"), /no está disponible/);
  }
});
