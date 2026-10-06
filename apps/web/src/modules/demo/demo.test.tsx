import "../region-suggestions/component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { demoServices, demoSession, parseDemoTemplate } from "./template.ts";
import { TreeSummary } from "../four-view/TreeSummary.tsx";
import { DIRECTIONS } from "../four-view/types.ts";
import { evidenceItems } from "../four-view/BioClipEvidence.tsx";

const raw = readFileSync("public/demo/v1/review.json", "utf8");
test("public template omits private identifiers, location, signatures and original metadata", () => {
  assert.doesNotMatch(raw, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(raw, /ownerId|owner_id|storage_path|latitude|longitude|raw_exif|proxyManifestSignature|sb_secret_|eyJ/);
  const template = parseDemoTemplate(JSON.parse(raw));
  assert.equal(template.review.analysis!.ai, null);
  assert.equal((100 * template.review.analysis!.lichen / template.review.analysis!.total).toFixed(1), "20.7");
});
test("recorded evidence matches synthetic demo views without modifying the editable template", async () => {
  const template = parseDemoTemplate(JSON.parse(raw));
  const before = JSON.stringify(template);
  const services = demoServices(template, new Blob(["photo"]));
  for (const direction of DIRECTIONS) {
    const ref = { imageId: demoSession.views[direction]!, treeSampleId: demoSession.treeSampleId, direction, ownerId: demoSession.ownerId };
    const result = await services.cloud.read(ref);
    assert.equal(evidenceItems(result!.review.analysis!.ai, { imageId: ref.imageId, treeSampleId: ref.treeSampleId, direction }).length, 1);
    assert.equal(result!.review.analysis!.ai!.provenance.proxyManifestSignature, "");
  }
  assert.equal(JSON.stringify(template), before);
});
test("demo summary displays four reviews and evidence with no editing or model calls", async () => {
  const services = demoServices(parseDemoTemplate(JSON.parse(raw)), new Blob(["photo"]));
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => { root.render(createElement(TreeSummary, { session: demoSession, services, readOnly: true, onEdit: () => { throw Error("unexpected_edit"); } })); });
    assert.match(element.textContent!, /4 de 4 vistas con análisis guardado/);
    assert.equal(element.querySelectorAll(".tree-summary-card").length, 4);
    assert.equal(Array.from(element.querySelectorAll("button")).filter(b => b.textContent === "Ampliar").length, 4);
    assert.equal(element.querySelectorAll(".g-primary").length, 0);
    assert.equal(Array.from(element.querySelectorAll("summary")).filter(s => s.textContent === "Ver qué revisó la IA").length, 4);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
