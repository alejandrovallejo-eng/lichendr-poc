"use client";
import { useEffect, useState } from "react";
import { capabilityAvailable, type AnalysisCapabilities } from "../../lib/analysis-capabilities";
export function useAnalysisCapabilities(override?: AnalysisCapabilities) {
  const [value, setValue] = useState<AnalysisCapabilities | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (override) return;
    const abort = new AbortController();
    void fetch("/api/vision/capabilities", { signal: abort.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json();
      if (!body.segmentation || !body.classification || typeof body.classification.enabled !== "boolean"
        || typeof body.classification.configured !== "boolean" || typeof body.segmentation.enabled !== "boolean"
        || typeof body.segmentation.configured !== "boolean") throw new Error("invalid");
      if (!abort.signal.aborted) setValue(body);
    }).catch(() => { if (!abort.signal.aborted) setError("No se pudo comprobar la IA. Puedes revisar manualmente o reintentar."); });
    return () => abort.abort();
  }, [override, attempt]);
  const capabilities = override ?? value;
  return { capabilities, loading: !capabilities && !error, error,
    segmentation: Boolean(capabilities && capabilityAvailable(capabilities.segmentation)),
    classification: Boolean(capabilities && capabilityAvailable(capabilities.classification)),
    retry: () => { setError(""); setValue(null); setAttempt(value => value + 1); } };
}
