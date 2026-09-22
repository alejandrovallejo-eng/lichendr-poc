import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperimentalComparison } from "../four-view/ExperimentalComparison.tsx";
import { EXPERIMENTAL_BUNDLE, EXPERIMENTAL_MODEL, EXPERIMENTAL_LABELS, experimentalCounts, parseExperimental } from "./experimental.ts";

const fixture = () => ({ modelId: EXPERIMENTAL_MODEL, bundleSha256: EXPERIMENTAL_BUNDLE,
  preprocess: "standard_center_crop", experimental: true, suggestions: [{ regionId: "r1", status: "pending", decision: "undetermined",
    ranking: EXPERIMENTAL_LABELS.map((label, i) => ({ label, rawScore: 1 - i * .1 })) }] });

test("abstention is not lichen even when lichen ranks first", () => {
  const v = parseExperimental(fixture(), ["r1"]);
  assert.ok(v); assert.deepEqual(experimentalCounts(v), { total: 1, lichen: 0, undetermined: 1 });
  const html = renderToStaticMarkup(createElement(ExperimentalComparison, { comparison: v }));
  assert.match(html, /0\/1 sugieren liquen/); assert.match(html, /Sin determinar/);
  assert.match(html, /ni cambia tu cobertura/i);
  assert.equal(renderToStaticMarkup(createElement(ExperimentalComparison, {})), "");
});
test("experimental identity includes policy and rejects wrong/missing model, crops or scores", () => {
  const good = fixture();
  assert.equal(parseExperimental({ ...good, bundleSha256: "a".repeat(64) }, ["r1"]), null);
  assert.equal(parseExperimental(undefined, ["r1"]), null);
  assert.equal(parseExperimental(good, ["r2"]), null);
  assert.equal(parseExperimental({ ...good, suggestions: [...good.suggestions, ...good.suggestions] }, ["r1", "r2"]), null);
  good.suggestions[0].ranking[0].rawScore = NaN;
  assert.equal(parseExperimental(good, ["r1"]), null);
});
