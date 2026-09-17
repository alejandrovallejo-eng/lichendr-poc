"use client";

import { EXPERIMENTAL_NAMES, experimentalCounts, type ExperimentalComparison as Comparison } from "../region-suggestions/experimental";

export function ExperimentalComparison({ comparison }: { comparison?: Comparison }) {
  if (!comparison) return null;
  const counts = experimentalCounts(comparison);
  return <details style={{ fontSize: 12, border: "1px solid #d6c69d", padding: 10, borderRadius: 8 }}>
    <summary>Comparación experimental · {counts.lichen}/{counts.total} sugieren liquen · {counts.undetermined} sin determinar</summary>
    <p style={{ marginTop: 8 }}>Modelo ampliado de prueba: no sustituye al habitual ni cambia tu cobertura. «Sin determinar» no significa ausencia de liquen.</p>
    <ol style={{ paddingLeft: 20 }}>{comparison.suggestions.map((s, i) => <li key={s.regionId}>Ejemplo {i + 1}: {EXPERIMENTAL_NAMES[s.decision]}</li>)}</ol>
    <p>No validado para identificar especies ni medir calidad del aire. Revisa siempre la fotografía.</p>
  </details>;
}
