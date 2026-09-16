import "./component-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TrunkColorPanel } from "./TrunkColorPanel.tsx";

test("eyedropper samples original pixels, persists and reviews without touching model state", async () => {
  const oldContext = HTMLCanvasElement.prototype.getContext, oldFetch = globalThis.fetch;
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const outline = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
  let readCount = 0;
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage() {}, clearRect() {}, putImageData() {},
      createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      getImageData(_x: number, _y: number, w: number, h: number) {
        readCount++;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) data.set(i % w < w / 2 ? [70, 40, 20, 255] : [210, 220, 170, 255], i * 4);
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  globalThis.fetch = (async () => { throw new Error("Colour tools must not make model requests"); }) as typeof fetch;
  localStorage.setItem("untouched-human-review", "9 excluded; 1 bark");
  const findButton = (name: string) => {
    const b = [...container.querySelectorAll("button")].find(b => b.textContent === name); assert.ok(b, name); return b;
  };
  const press = async (name: string) => act(async () => findButton(name).click());
  const load = async () => act(async () => container.querySelector("img")!.dispatchEvent(new Event("load")));
  const pick = async (x: number, y: number) => act(async () => container.querySelector('[aria-label="Tomar muestra de color · Este"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 400 * x, clientY: 300 * y })));
  const ready = async () => {
    for (let i = 0; i < 30 && !container.textContent?.includes("Selección actualizada"); i++) await act(async () => { await new Promise(r => setTimeout(r, 100)); });
    assert.match(container.textContent!, /Selección actualizada/);
  };
  try {
    await act(async () => root.render(createElement(TrunkColorPanel, { src: "blob:preview", viewName: "Este", points: outline, identity: "test-colors-unique", disabled: false })));
    await press("Abrir cuentagotas"); await load();
    await pick(.01, .5); assert.match(container.textContent!, /dentro del contorno/);
    await pick(.25, .5); await press("Liquen · tono 1"); await pick(.75, .5); await ready();
    assert.match(container.textContent!, /Líquenes: 50.0 %/);
    assert.equal(readCount, 1, "all samples read pristine pixels, not coloured overlay");
    await press("Revisé la selección por color"); assert.match(container.textContent!, /Revisión por color guardada/);
    await press("Cerrar cuentagotas"); await press("Abrir cuentagotas"); await load(); await ready();
    assert.match(container.textContent!, /2\/24 muestras/);
    assert.match(container.textContent!, /Revisión por color guardada/);
    await act(async () => (container.querySelector('[aria-label="Eliminar muestra 2: Liquen · tono 1"]') as HTMLButtonElement).click());
    assert.match(container.textContent!, /provisional por color/);
    assert.doesNotMatch(container.textContent!, /Líquenes: 50.0 %/);
    assert.equal(localStorage.getItem("untouched-human-review"), "9 excluded; 1 bark");
    await act(async () => root.render(createElement(TrunkColorPanel, { src: "blob:preview", viewName: "Este", points: outline.map(p => ({ x: p.x * .95, y: p.y })), identity: "test-colors-unique", disabled: false })));
    assert.match(container.textContent!, /0\/24 muestras/);
  } finally {
    await act(async () => root.unmount()); container.remove();
    HTMLCanvasElement.prototype.getContext = oldContext; globalThis.fetch = oldFetch;
  }
});
