"use client";

import { EXPERIMENTAL_NAMES, experimentalCounts, type ExperimentalComparison as Comparison } from "../region-suggestions/experimental";

export function ExperimentalComparison({ comparison }: { comparison?: Comparison }) {
  if (!comparison) return null;
  const counts = experimentalCounts(comparison);
  return <details style={{ fontSize: 12, border: "1px solid #d6c69d", padding: 10, borderRadius: 8 }}>
    <summary>Segunda opinión de IA · {counts.lichen}/{counts.total} ejemplos sugieren liquen{counts.undetermined ? ` · ${counts.undetermined} para revisar` : ""}</summary>
    <p style={{ marginTop: 8 }}>Revisión adicional en prueba. No cambia tu selección ni tu cobertura.</p>
    <ol style={{ paddingLeft: 20 }}>{comparison.suggestions.map((s, i) => <li key={s.regionId}>Ejemplo {i + 1}: {s.decision === "undetermined" ? "Revisar manualmente" : EXPERIMENTAL_NAMES[s.decision]}</li>)}</ol>
    {counts.undetermined ? <p>«Revisar manualmente» significa que la IA no pudo decidir, no que falte liquen.</p> : null}
  </details>;
}
