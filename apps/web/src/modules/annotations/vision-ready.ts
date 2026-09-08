/** Wake a sleeping service before sending the image; never retry inference blindly. */
export async function waitForVisionReady(
  signal: AbortSignal,
  request: typeof fetch = fetch,
  pause = (ms: number) => new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }),
): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 6000);
    try {
      const response = await request("/api/vision/ready", {
        cache: "no-store", signal: controller.signal,
      });
      if (response.ok && (await response.json()).status === "ready") return;
    } catch {
      signal.throwIfAborted();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
    if (attempt < 14) await pause(2000);
  }
  throw new Error("El servicio de IA no pudo iniciar. Tu fotografía y tus puntos se conservan.");
}
