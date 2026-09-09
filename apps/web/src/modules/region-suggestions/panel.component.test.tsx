// Bounded component check of human preservation: what happens to the reviewer's
// work while BioCLIP is answering.
//
// This renders the REAL panel in jsdom and drives it through its own buttons.
// MobileSAM and BioCLIP are not involved: the suggestion request is a deferred
// stub, so the test can act during the wait. No private photograph and no model
// weights are used, and no claim about the model is made here.

import { PREVIEW_BOX } from "./component-test-env.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RegionSuggestionsPanel } from "./RegionSuggestionsPanel.tsx";

const OWNER = "00000000-0000-4000-8000-000000000001";
const TREE = "33333333-3333-4333-8333-333333333333";
const IMAGE = "44444444-4444-4444-8444-444444444441";
// A different photograph, so this test does not restore what the previous one
// persisted for the same owner/tree/view/image.
const IMAGE_RETRY = "44444444-4444-4444-8444-444444444442";

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (button) => (button.textContent ?? "").trim() === text,
  );
  assert.ok(match, `no button labelled ${JSON.stringify(text)}`);
  return match as HTMLButtonElement;
}

function click(element: HTMLElement): void {
  element.dispatchEvent(new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent(
    "click",
    { bubbles: true, cancelable: true },
  ));
}

// Paints with the panel's own brush at a relative position of the preview.
function paintAt(container: HTMLElement, xRatio: number, yRatio: number): void {
  const surface = container.querySelector("div.relative") as HTMLElement | null;
  assert.ok(surface, "no preview surface");
  surface.dispatchEvent(
    new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: PREVIEW_BOX.left + PREVIEW_BOX.width * xRatio,
      clientY: PREVIEW_BOX.top + PREVIEW_BOX.height * yRatio,
    }),
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("una respuesta tardía de BioCLIP no deshace lo que la persona hizo mientras esperaba", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  let releaseSuggestions: ((value: unknown) => void) | null = null;
  const pending = new Promise((resolve) => {
    releaseSuggestions = resolve;
  });
  const originalFetch = globalThis.fetch;
  let requestedRegionIds: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url !== "/api/vision/region-suggestions") throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body)) as {
      requestToken: string;
      regions: { regionId: string }[];
    };
    requestedRegionIds = body.regions.map((region) => region.regionId);
    await pending;
    return Response.json({
      backend: "zeroshot",
      cached: false,
      notice: "Puntuaciones crudas, no probabilidades.",
      context: { requestToken: body.requestToken },
      provenance: {
        ownerId: OWNER,
        treeSampleId: TREE,
        imageId: IMAGE,
        direction: "N",
        encoderId: "imageomics/bioclip-2",
        headSha256: null,
        preprocessVersion: "1",
        suggestionVersion: "2",
      },
      geometry: body.regions.map((region) => ({
        regionId: region.regionId,
        cropBoxNormalized: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      })),
      suggestions: body.regions.map((region) => ({
        regionId: region.regionId,
        ranking: [
          { label: "lichen", labelEs: "liquen", rawScore: 0.7 },
          { label: "moss", labelEs: "musgo", rawScore: 0.2 },
          { label: "bare tree bark", labelEs: "corteza desnuda", rawScore: 0.1 },
        ],
      })),
    });
  }) as typeof fetch;

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(RegionSuggestionsPanel, {
          treeSampleId: TREE,
          direction: "N",
          imageId: IMAGE,
          file: new File([new Uint8Array([1, 2, 3])], "n.jpg", { type: "image/jpeg" }),
        }),
      );
    });
    await flush();

    // A mask the reviewer draws because MobileSAM proposed nothing.
    await act(async () => click(buttonByText(container, "Añadir máscara omitida")));
    await act(async () => paintAt(container, 0.5, 0.5));
    assert.equal(container.querySelectorAll("li").length, 1);

    // Ask BioCLIP; the answer is held back on purpose.
    await act(async () => click(buttonByText(container, "Reintentar etiquetas (BioCLIP)")));
    await flush();
    assert.deepEqual(requestedRegionIds.length, 1);

    // WHILE waiting, the reviewer keeps working: a second omitted mask, a
    // decision on the first one and the ROI.
    await act(async () => click(buttonByText(container, "Añadir máscara omitida")));
    await act(async () => paintAt(container, 0.7, 0.7));
    await act(async () => click(buttonByText(container, "Aceptar como liquen")));
    await act(async () =>
      click(buttonByText(container, "Usar vista completa como ROI (exploratorio)")),
    );
    assert.equal(container.querySelectorAll("li").length, 2);

    // Now the slow answer arrives.
    await act(async () => {
      releaseSuggestions?.(null);
      await pending;
    });
    await flush();

    const text = container.textContent ?? "";
    // The second mask survives: the answer is applied over the live state.
    assert.equal(container.querySelectorAll("li").length, 2);
    // The human decision survives.
    assert.match(text, /Aceptadas 1 \(liquen 1\)/);
    assert.match(text, /Pendientes 1/);
    // The ROI survives: "Borrar ROI" stays enabled and coverage no longer asks
    // for a trunk ROI, it only waits for the completeness review.
    assert.equal(buttonByText(container, "Borrar ROI").disabled, false);
    assert.match(text, /Cobertura revisada no disponible \(completeness_not_reviewed\)/);
    // And the suggestion did arrive for the region that was classified.
    assert.match(text, /liquen \(puntuación cruda 0\.700\)/);
  } finally {
    globalThis.fetch = originalFetch;
    if (root) {
      const mounted = root as Root;
      await act(async () => mounted.unmount());
    }
    container.remove();
  }
});

test("reintentar etiquetas tras un fallo devuelve el panel a Revisar", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;

  let failNext = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url !== "/api/vision/region-suggestions") throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body)) as {
      requestToken: string;
      regions: { regionId: string }[];
    };
    if (failNext) {
      failNext = false;
      return Response.json(
        { error: "El worker BioCLIP no está disponible." },
        { status: 503 },
      );
    }
    return Response.json({
      backend: "ridge_head",
      cached: false,
      notice: "Puntuaciones crudas, no probabilidades.",
      context: { requestToken: body.requestToken },
      provenance: {
        ownerId: OWNER,
        treeSampleId: TREE,
        imageId: IMAGE_RETRY,
        direction: "N",
        encoderId: "imageomics/bioclip-2",
        headSha256: null,
        preprocessVersion: "1",
        suggestionVersion: "2",
      },
      geometry: [],
      suggestions: body.regions.map((region) => ({
        regionId: region.regionId,
        ranking: [{ label: "lichen", labelEs: "liquen", rawScore: 0.7 }],
      })),
    });
  }) as typeof fetch;

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(
        createElement(RegionSuggestionsPanel, {
          treeSampleId: TREE,
          direction: "N",
          imageId: IMAGE_RETRY,
          file: new File([new Uint8Array([1, 2, 3])], "n.jpg", { type: "image/jpeg" }),
        }),
      );
    });
    await flush();

    await act(async () => click(buttonByText(container, "Añadir máscara omitida")));
    await act(async () => paintAt(container, 0.5, 0.5));

    // First classification fails: the panel says so instead of faking success.
    await act(async () => click(buttonByText(container, "Reintentar etiquetas (BioCLIP)")));
    await flush();
    assert.match(container.textContent ?? "", /Asistencia no disponible/);

    // The retry succeeds: the labels arrive AND the failure notice goes away.
    await act(async () => click(buttonByText(container, "Reintentar etiquetas (BioCLIP)")));
    await flush();
    const text = container.textContent ?? "";
    assert.doesNotMatch(text, /Asistencia no disponible/);
    assert.match(text, /Revisar/);
    assert.match(text, /liquen \(puntuación cruda 0\.700\)/);
    assert.match(text, /Backend ridge_head/);
    // The mask drawn by hand is still there: nothing was resegmented.
    assert.equal(container.querySelectorAll("li").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (root) {
      const mounted = root as Root;
      await act(async () => mounted.unmount());
    }
    container.remove();
  }
});
