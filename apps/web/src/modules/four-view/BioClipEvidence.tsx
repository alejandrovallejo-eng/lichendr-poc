"use client";

import { useId, useState } from "react";
import type { SuggestionResponse } from "../region-suggestions/client";
import { SUGGESTION_LABEL_ES, type Box } from "../region-suggestions/types";
import { EXPERIMENTAL_NAMES } from "../region-suggestions/experimental";

type Reference = { imageId: string; treeSampleId: string; direction: string };
type Props = { ai: SuggestionResponse | null; src: string; width: number; height: number; reference: Reference };

// Use recorded server geometry, never guess a new box from a click or array
// position. Old reviews without geometry still retain their saved results.
export function evidenceItems(ai: SuggestionResponse | null, reference: Reference) {
  if (!ai?.context || Object.entries(reference).some(([key, value]) =>
    !value || ai.context[key as keyof Reference] !== value) || !Array.isArray(ai.suggestions)
    || ai.suggestions.length > 24) return [];
  return ai.suggestions.map((suggestion, index) => {
    const matches = Array.isArray(ai.geometry) ? ai.geometry.filter(g => g?.regionId === suggestion.regionId) : [];
    const box = matches.length === 1 ? matches[0].cropBoxNormalized : null;
    const valid = box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
      && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
      && box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001;
    const label = suggestion.ranking?.[0]?.label;
    const experiments = ai.experimental?.suggestions?.filter(s => s.regionId === suggestion.regionId) ?? [];
    const decision = experiments.length === 1 ? experiments[0].decision : null;
    return { id: suggestion.regionId, number: index + 1, box: valid ? box as Box : null,
      habitual: Object.hasOwn(SUGGESTION_LABEL_ES, label ?? "") ? SUGGESTION_LABEL_ES[label] : "Sin resultado disponible",
      experimental: decision && Object.hasOwn(EXPERIMENTAL_NAMES, decision) ? EXPERIMENTAL_NAMES[decision] : null };
  });
}

export function BioClipEvidence(props: Props) {
  const items = evidenceItems(props.ai, props.reference);
  if (!items.length) return null;
  // A different saved response/photo starts collapsed and at example one.
  return <EvidenceViewer key={`${props.reference.imageId}:${props.reference.direction}:${props.ai?.cacheKey ?? ""}`}
    {...props} items={items} />;
}

function EvidenceViewer({ ai, src, width, height, items }: Props & { items: ReturnType<typeof evidenceItems> }) {
  const clipId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [location, setLocation] = useState(false);
  const item = items[Math.min(selected, items.length - 1)];
  const box = item.box;
  const dimensionsValid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  const cropView = box && dimensionsValid ? `${box.x * width} ${box.y * height} ${box.width * width} ${box.height * height}` : "";
  return <details onToggle={e => setOpen(e.currentTarget.open)} style={{ fontSize: 12, border: "1px solid #b5d1c4", borderRadius: 10, padding: 10 }}>
    <summary style={{ cursor: "pointer", fontWeight: 650 }}>Ver qué revisó la IA</summary>
    {open ? <div style={{ display: "grid", gap: 8, paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <strong aria-live="polite">Ejemplo {item.number} de {items.length}</strong>
        {items.length > 1 ? <div style={{ display: "flex", gap: 4 }}>
          <button type="button" aria-label="Ejemplo anterior" disabled={selected === 0} onClick={() => { setSelected(n => n - 1); setLocation(false); }}>←</button>
          <button type="button" aria-label="Ejemplo siguiente" disabled={selected >= items.length - 1} onClick={() => { setSelected(n => n + 1); setLocation(false); }}>→</button>
        </div> : null}
      </div>
      {src && cropView && box ? <>
        <svg role="img" aria-label={location ? `Ubicación del recorte del ejemplo ${item.number}` : `Recorte enviado a BioCLIP, ejemplo ${item.number}`}
          viewBox={location ? `0 0 ${width} ${height}` : cropView}
          style={{ display: "block", width: "100%", height: 160, background: "#e7eee9", borderRadius: 6 }}>
          <defs><clipPath id={clipId}><rect x={box.x * width} y={box.y * height} width={box.width * width} height={box.height * height} /></clipPath></defs>
          <g clipPath={location ? undefined : `url(#${clipId})`}><image href={src} width={width} height={height} preserveAspectRatio="none" /></g>
          {location ? <rect x={box.x * width} y={box.y * height} width={box.width * width} height={box.height * height}
            fill="none" stroke="#d90079" strokeWidth="3" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <button type="button" aria-pressed={location} onClick={() => setLocation(v => !v)}>{location ? "Volver al recorte" : "Ubicar en la foto"}</button>
      </> : <p>No está disponible el recorte guardado de este ejemplo. No lo reconstruimos por aproximación.</p>}
      <p><strong>Revisión de IA:</strong> {item.habitual}.</p>
      {item.experimental ? <p><strong>Segunda opinión:</strong> {item.experimental === "Sin determinar" ? "Revisar manualmente" : item.experimental}.</p> : null}
      <p>La sugerencia describe este recorte, no todos los píxeles del color que elegiste. Tu selección y cobertura no cambian.</p>
      {ai?.suggestions.some(s => s.preprocess === "standard_center_crop")
        ? <p style={{ color: "#4a6156", fontSize: 11 }}>Se muestra la región enviada. El modelo la redimensiona y utiliza un recorte central.</p> : null}
    </div> : null}
  </details>;
}
