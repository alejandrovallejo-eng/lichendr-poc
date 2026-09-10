// Minimal DOM for the component test: a real React render in jsdom, so the
// panel's own effects and callbacks run instead of a hand-written imitation.
//
// This module MUST be imported before React DOM or the panel.

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.test/",
  pretendToBeVisual: true,
});

const anyGlobal = globalThis as unknown as Record<string, unknown>;

// Node already defines some of these as getter-only properties.
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
anyGlobal.window = dom.window;
anyGlobal.document = dom.window.document;
defineGlobal("navigator", dom.window.navigator);
defineGlobal("location", dom.window.location);
anyGlobal.localStorage = dom.window.localStorage;
anyGlobal.sessionStorage = dom.window.sessionStorage;
anyGlobal.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
anyGlobal.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(Date.now()), 0) as unknown as number;
anyGlobal.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
for (const name of [
  "Element",
  "HTMLElement",
  "HTMLImageElement",
  "HTMLCanvasElement",
  "HTMLInputElement",
  "Node",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "DOMException",
  "SVGElement",
]) {
  const value = (dom.window as unknown as Record<string, unknown>)[name];
  if (value) anyGlobal[name] = value;
}

// jsdom does not implement object URLs nor image decoding. The panel only needs
// the preview to report a size so the working grid can be derived.
dom.window.URL.createObjectURL = () => "blob:preview";
dom.window.URL.revokeObjectURL = () => undefined;
(globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
  "blob:preview";
(globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;

export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 900;

Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalWidth", {
  get: () => PREVIEW_WIDTH,
});
Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalHeight", {
  get: () => PREVIEW_HEIGHT,
});
// jsdom has no canvas backend: the panel already guards a null 2d context, and
// the overlay is not what this test asserts on.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

// jsdom has no layout: without a box, the panel cannot map a click to a pixel.
export const PREVIEW_BOX = { left: 0, top: 0, width: 400, height: 300 };
dom.window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    x: PREVIEW_BOX.left,
    y: PREVIEW_BOX.top,
    left: PREVIEW_BOX.left,
    top: PREVIEW_BOX.top,
    width: PREVIEW_BOX.width,
    height: PREVIEW_BOX.height,
    right: PREVIEW_BOX.left + PREVIEW_BOX.width,
    bottom: PREVIEW_BOX.top + PREVIEW_BOX.height,
    toJSON: () => ({}),
  } as DOMRect;
};

anyGlobal.IS_REACT_ACT_ENVIRONMENT = true;
