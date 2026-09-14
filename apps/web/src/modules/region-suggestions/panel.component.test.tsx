// Bounded component check of human preservation: what happens to the reviewer's
// work while BioCLIP is answering.
//
// This renders the REAL panel in jsdom and drives it through its own buttons.
// MobileSAM and BioCLIP are not involved: the suggestion request is a deferred
// stub, so the test can act during the wait. No private photograph and no model
// weights are used, and no claim about the model is made here.

import { PREVIEW_BOX } from "./component-test-env.ts";
import "./trunk-outline.test.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RegionSuggestionsPanel } from "./RegionSuggestionsPanel.tsx";
import { TrunkOutlineEditor } from "./TrunkOutlineEditor.tsx";
import { parseTrunkOutline, trunkStorageKey, type TrunkPoint } from "./trunk-outline.ts";
import { loadSavedBatch, saveBatch } from "./storage.ts";
import { initialReview } from "./review.ts";
import { encodeMaskRle } from "./mask-codec.ts";
import type { ProposedRegion } from "./types.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const TREE = "33333333-3333-4333-8333-333333333333";
const IMAGE = "44444444-4444-4444-8444-444444444441";
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
        suggestionVersion: "3",
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
    await act(async () => click(buttonByText(container, "Terminar edición")));
    await act(async () => click(buttonByText(container, "Anterior")));
    await act(async () => click(buttonByText(container, "Aceptar como liquen")));
    await act(async () =>
      click(buttonByText(container, "Usar vista completa como ROI (exploratorio)")),
    );
    assert.equal(container.querySelectorAll("select option").length, 2);

    // Now the slow answer arrives.
    await act(async () => {
      releaseSuggestions?.(null);
      await pending;
    });
    await flush();

    const text = container.textContent ?? "";
    // The second mask survives: the answer is applied over the live state.
    assert.equal(container.querySelectorAll("select option").length, 2);
    assert.equal(container.querySelectorAll("li").length, 1, "one region shown, both preserved");
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

test("reintentar etiquetas tras un fallo devuelve el panel a revisión", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let failNext = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url !== "/api/vision/region-suggestions") throw new Error(`unexpected fetch ${url}`);
    const body = JSON.parse(String(init?.body)) as { requestToken: string; regions: { regionId: string }[] };
    if (failNext) {
      failNext = false;
      return Response.json({ error: "El worker BioCLIP no está disponible." }, { status: 503 });
    }
    return Response.json({
      backend: "ridge_head", cached: false, notice: "Puntuaciones crudas, no probabilidades.",
      context: { requestToken: body.requestToken },
      provenance: {
        ownerId: OWNER, treeSampleId: TREE, imageId: IMAGE_RETRY, direction: "N",
        encoderId: "imageomics/bioclip-2", headSha256: null,
        preprocessVersion: "1", suggestionVersion: "3",
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
      root.render(createElement(RegionSuggestionsPanel, {
        treeSampleId: TREE, direction: "N", imageId: IMAGE_RETRY,
        file: new File([new Uint8Array([1, 2, 3])], "n.jpg", { type: "image/jpeg" }),
      }));
    });
    await flush();
    await act(async () => click(buttonByText(container, "Añadir máscara omitida")));
    await act(async () => paintAt(container, 0.5, 0.5));
    await act(async () => click(buttonByText(container, "Reintentar etiquetas (BioCLIP)")));
    await flush();
    assert.match(container.textContent ?? "", /requiere reintento/);
    await act(async () => click(buttonByText(container, "Reintentar etiquetas (BioCLIP)")));
    await flush();
    const text = container.textContent ?? "";
    assert.doesNotMatch(text, /requiere reintento/);
    assert.match(text, /1 sugerencias recibidas/);
    assert.match(text, /liquen \(puntuación cruda 0\.700\)/);
    assert.match(text, /Backend ridge_head/);
    assert.equal(container.querySelectorAll("li").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (root) { const mounted = root as Root; await act(async () => mounted.unmount()); }
    container.remove();
  }
});

test("enfocar y ocultar regiones conserva máscaras, decisiones y restauración sin llamadas IA", async () => {
  const originalContext = HTMLCanvasElement.prototype.getContext;
  let overlay = new Uint8ClampedArray(36);
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => { overlay = new Uint8ClampedArray(36); },
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (image: ImageData) => { overlay = new Uint8ClampedArray(image.data); },
  })) as unknown as typeof originalContext;
  const identity = { ownerId: OWNER, treeSampleId: TREE, direction: "N", imageId: "44444444-4444-4444-8444-444444444443" };
  const regions: ProposedRegion[] = ["sam-a", "sam-b"].map((regionId, index) => ({
    regionId, maskWidth: 3, maskHeight: 3,
    maskRle: encodeMaskRle(Uint8Array.from({ length: 9 }, (_, i) => i === index + 3 ? 1 : 0), 3, 3),
    maskSha: regionId, maskAreaPixels: 1,
    box: { x: index, y: 1, width: 1, height: 1 },
    cropBoxNormalized: null, samScore: 0.9, transformChain: [],
  }));
  saveBatch(identity, {
    regions, suggestions: regions.map((region) => ({
      regionId: region.regionId,
      ranking: [{ label: "lichen", labelEs: "liquen", rawScore: 0.4 }],
      backend: "ridge_head", encoderId: "test", headSha256: null, preprocess: "test", versions: { schema: "3" },
    })),
    reviews: regions.map((region) => initialReview(region.regionId, region.maskSha)),
    backend: "ridge_head", completenessReviewed: false, roiRle: null,
  });
  const before = JSON.stringify(loadSavedBatch(identity));
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = (async () => { modelCalls += 1; throw new Error("must not call models"); }) as typeof fetch;
  const render = async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(RegionSuggestionsPanel, {
        treeSampleId: TREE, direction: "N", imageId: identity.imageId,
        file: new File([new Uint8Array([1])], "fixture.jpg", { type: "image/jpeg" }),
      }));
    });
    await flush();
  };
  try {
    await render();
    assert.equal(container.querySelectorAll("li[data-region-id]").length, 1);
    assert.equal(container.querySelector("li[data-region-id]")?.getAttribute("data-region-id"), "sam-a");
    assert.match(container.textContent ?? "", /Región 1 de 2/);
    assert.match(container.textContent ?? "", /2 sugerencias recibidas/);
    assert.ok(overlay[3 * 4 + 3] > 0, "first mask is drawn by default");
    assert.equal(overlay[4 * 4 + 3], 0, "other mask is hidden, not deleted");
    await act(async () => click(buttonByText(container, "Siguiente")));
    assert.equal(container.querySelector("li[data-region-id]")?.getAttribute("data-region-id"), "sam-b");
    assert.equal(overlay[3 * 4 + 3], 0);
    assert.ok(overlay[4 * 4 + 3] > 0, "navigation also changes the real pixel overlay");
    const visibility = Array.from(container.querySelectorAll("label")).find((label) => label.textContent?.trim() === "Mostrar máscaras")?.querySelector("input");
    assert.ok(visibility);
    await act(async () => click(visibility));
    assert.match(container.textContent ?? "", /Fotografía sin superposiciones/);
    assert.ok(overlay.every((value) => value === 0));
    await act(async () => click(visibility));
    const allMasks = Array.from(container.querySelectorAll("label")).find((label) => label.textContent?.trim() === "Ver todas las regiones")?.querySelector("input");
    assert.ok(allMasks);
    await act(async () => click(allMasks));
    assert.ok(overlay[3 * 4 + 3] > 0 && overlay[4 * 4 + 3] > 0);
    await act(async () => click(allMasks));
    assert.equal(JSON.stringify(loadSavedBatch(identity)), before, "presentation must never persist model or review changes");
    await act(async () => click(buttonByText(container, "Aceptar como musgo")));
    assert.equal(loadSavedBatch(identity)?.reviews.find((review) => review.regionId === "sam-b")?.reviewedLabel, "moss");
    assert.equal(loadSavedBatch(identity)?.reviews.find((review) => review.regionId === "sam-a")?.decision, "pending");
    assert.deepEqual(loadSavedBatch(identity)?.regions, regions);
    assert.equal(buttonByText(container, "Volver a proponer regiones").disabled, true, "legacy batch needs a confirmed trunk before regeneration");
    assert.equal(modelCalls, 0);
    await act(async () => click(buttonByText(container, "Editar máscara")));
    assert.equal(buttonByText(container, "Anterior").disabled, true);
    assert.equal(visibility.disabled, true);
    await act(async () => click(buttonByText(container, "Terminar edición")));
    const saved = JSON.stringify(loadSavedBatch(identity));
    const mounted = root as unknown as Root;
    await act(async () => mounted.unmount());
    root = null;
    await render();
    await act(async () => click(buttonByText(container, "Siguiente")));
    assert.match(container.textContent ?? "", /Aceptada como musgo/);
    assert.equal(JSON.stringify(loadSavedBatch(identity)), saved);
    assert.equal(modelCalls, 0);
  } finally {
    HTMLCanvasElement.prototype.getContext = originalContext;
    globalThis.fetch = originalFetch;
    if (root) { const mounted = root as Root; await act(async () => mounted.unmount()); }
    container.remove();
  }
});

test("contorno ajustable: añadir, mover con teclado, deshacer y cancelar no cambian el confirmado", async () => {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const original: TrunkPoint[] = [{ x: .4, y: .1 }, { x: .6, y: .1 }, { x: .6, y: .9 }, { x: .4, y: .9 }];
  let confirmed: TrunkPoint[] | null = null;
  try {
    await act(async () => root.render(createElement(TrunkOutlineEditor, { src: "blob:preview", viewName: "Norte", points: original, disabled: false, onConfirm: p => { confirmed = p; }, onEditingChange: () => {} })));
    await act(async () => click(buttonByText(container, "Ajustar contorno del tronco")));
    const first = container.querySelector("circle")!;
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    assert.equal(container.querySelector("circle")?.getAttribute("cx"), "402");
    await act(async () => click(buttonByText(container, "Deshacer punto o movimiento")));
    assert.equal(container.querySelector("circle")?.getAttribute("cx"), "400");
    await act(async () => click(buttonByText(container, "Cancelar contorno")));
    assert.equal(confirmed, null);
    await act(async () => click(buttonByText(container, "Ajustar contorno del tronco")));
    await act(async () => click(buttonByText(container, "Reiniciar dibujo")));
    assert.equal(buttonByText(container, "Confirmar tronco").disabled, true);
    const surface = container.querySelector("svg")!;
    for (const p of original) await act(async () => surface.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: p.x * PREVIEW_BOX.width, clientY: p.y * PREVIEW_BOX.height })));
    assert.equal(buttonByText(container, "Confirmar tronco").disabled, false);
    await act(async () => click(buttonByText(container, "Confirmar tronco")));
    assert.deepEqual(confirmed, original);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("confirmar tronco persiste antes de ejecutar IA, restaura tras recarga y no inicia modelos", async () => {
  const identity = { ownerId: OWNER, treeSampleId: TREE, direction: "E", imageId: "44444444-4444-4444-8444-444444444449" };
  const container = document.createElement("div"); document.body.appendChild(container);
  let root = createRoot(container);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = (async () => { modelCalls++; throw new Error("must not run models"); }) as typeof fetch;
  const render = async () => {
    await act(async () => root.render(createElement(RegionSuggestionsPanel, { ...identity, file: new File(["fixture"], "trunk.jpg", { type: "image/jpeg" }) })));
    await flush();
  };
  try {
    await render();
    assert.equal(buttonByText(container, "Proponer regiones (MobileSAM)").disabled, true);
    await act(async () => click(buttonByText(container, "Dibujar contorno del tronco")));
    const surface = container.querySelector('svg[role="group"]')!;
    for (const [x, y] of [[.45, .1], [.6, .1], [.6, .9], [.45, .9]]) {
      await act(async () => surface.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x * PREVIEW_BOX.width, clientY: y * PREVIEW_BOX.height })));
    }
    await act(async () => click(buttonByText(container, "Confirmar tronco")));
    assert.equal(parseTrunkOutline(localStorage.getItem(trunkStorageKey(identity)))?.length, 4);
    assert.equal(buttonByText(container, "Proponer regiones (MobileSAM)").disabled, false);
    assert.ok(loadSavedBatch(identity)?.roiRle);
    assert.deepEqual(loadSavedBatch(identity)?.regions, []);
    assert.equal(modelCalls, 0);
    await act(async () => root.unmount()); root = createRoot(container); await render();
    assert.match(container.textContent ?? "", /Contorno confirmado · 4 puntos/);
    assert.equal(buttonByText(container, "Proponer regiones (MobileSAM)").disabled, false);
    assert.equal(modelCalls, 0);
  } finally { globalThis.fetch = originalFetch; await act(async () => root.unmount()); container.remove(); }
});
