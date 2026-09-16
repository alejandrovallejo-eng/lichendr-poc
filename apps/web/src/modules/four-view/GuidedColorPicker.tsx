"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { acceptColorAddition, classifyTrunkColors, confirmedColorConfig, MAX_COLOR_SAMPLES, OVERLAY_RGB,
  proposeColorAddition, sampleColor, type ColorClass, type ColorConfig, type ColorResult, type ColorSample } from "../region-suggestions/trunk-colors";
import { rasterizeTrunk, type TrunkPoint } from "../region-suggestions/trunk-outline";

type Pixels = { width: number; height: number; rgba: Uint8ClampedArray };
type Proposal = Awaited<ReturnType<typeof proposeColorAddition>>;
const detail = (e: unknown) => e instanceof Error ? e.message : "No se pudo preparar el tono.";
export const PROPOSAL_RGB = [255, 0, 212] as const;
const rgb = (sample: ColorSample) => `rgb(${sample.rgb.join(",")})`;

// Display only: the magenta mask is NOT the sampled colour or a class label.
// A dark edge remains visible on pale lichen, without changing any mask pixels.
export function proposalDisplayPixels(mask: Uint8Array, width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const edge = i % width === 0 || i % width === width - 1 || i < width || i >= width * (height - 1)
      || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width];
    data.set(edge ? [71, 0, 61, 245] : [...PROPOSAL_RGB, 185], i * 4);
  }
  return data;
}

export function GuidedToneMarker({ sample, width, height }: { sample: ColorSample; width: number; height: number }) {
  return <g aria-label="Punto del color elegido" pointerEvents="none" transform={`translate(${sample.x * width} ${sample.y * height})`}>
    <circle r="14" fill="none" stroke="white" strokeWidth="4" />
    <circle r="12" fill="none" stroke="#790064" strokeWidth="3" />
    <circle r="7" fill={rgb(sample)} stroke="white" strokeWidth="2" />
    <path d="M-21 0h5 M16 0h5 M0-21v5 M0 16v5" stroke="#790064" strokeWidth="3" />
  </g>;
}

// A proposal is ephemeral. Only explicit acceptance is written to the existing
// guided review. Group identity is independent of the sampled RGB.
export function useGuidedColorPicker(pixels: Pixels | null, outline: TrunkPoint[], config: ColorConfig,
  active: boolean, onChange: (config: ColorConfig) => void) {
  const working = useMemo(() => confirmedColorConfig(config), [config]);
  const groups = working.confirmed!.groups;
  const [target, setTarget] = useState<ColorClass>(3);
  const label = groups.some(g => g.label === target) ? target : groups[0].label;
  const [pending, setPending] = useState<ColorSample | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [base, setBase] = useState<{ config: ColorConfig; pixels: Pixels; outline: TrunkPoint[]; result: ColorResult } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState(false);
  const [tolerance, setTolerance] = useState(config.tolerance);
  const serial = useRef(0);
  const accepted = base?.config === config && base.pixels === pixels && base.outline === outline ? base.result : null;
  useEffect(() => {
    setPending(null); setProposal(null); setRemoving(false); setError(""); setNotice("");
    if (!active || !pixels || outline.length < 3) return;
    const abort = new AbortController();
    void classifyTrunkColors(pixels.rgba, pixels.width, pixels.height, outline, working, abort.signal, "lichen-only")
      .then(result => { if (!abort.signal.aborted) setBase({ config, pixels, outline, result }); })
      .catch(e => { if (!abort.signal.aborted) setError(detail(e)); });
    return () => abort.abort();
  }, [pixels, outline, config, working, active]);
  useEffect(() => {
    setProposal(null);
    if (!active || !pending || !accepted || !pixels) return;
    const abort = new AbortController(), request = ++serial.current;
    void proposeColorAddition(pixels.rgba, pixels.width, pixels.height, accepted, pending, abort.signal)
      .then(value => { if (!abort.signal.aborted && request === serial.current) setProposal(value); })
      .catch(e => { if (!abort.signal.aborted) setError(detail(e)); });
    return () => { abort.abort(); serial.current++; };
  }, [active, pending, accepted, pixels]);

  const discard = () => { serial.current++; setPending(null); setProposal(null); setRemoving(false); setNotice("Propuesta descartada. Lo aceptado no cambió."); };
  const pick = (point: TrunkPoint) => {
    if (!pixels || !accepted || !active) return;
    setError(""); setNotice("");
    if (pending && removing) {
      if (!proposal) return;
      const seed = Math.floor(point.y * pixels.height) * pixels.width + Math.floor(point.x * pixels.width);
      if (!proposal.mask[seed]) { setNotice("Toca una zona fucsia de la propuesta, no la selección aceptada."); return; }
      if ((pending.excluded?.length ?? 0) >= 64) { setError("Esta propuesta ya tiene 64 exclusiones. Descártala y elige un tono más preciso."); return; }
      setProposal(null); setPending({ ...pending, excluded: [...pending.excluded ?? [], seed] }); return;
    }
    if (pending) { setNotice("Acepta o descarta esta propuesta antes de elegir otro tono."); return; }
    if (config.samples.length >= MAX_COLOR_SAMPLES) { setError("Llegaste a 24 tonos en esta fotografía. Puedes deshacer el último añadido."); return; }
    const sample = sampleColor(pixels.rgba, pixels.width, pixels.height, rasterizeTrunk(outline, pixels.width, pixels.height), point.x, point.y, label);
    if (!sample) { setError("Toca un liquen dentro del contorno del tronco."); return; }
    setPending({ ...sample, tolerance, excluded: [] }); setProposal(null);
  };
  const accept = () => {
    if (!pending || !proposal?.added || !accepted || !pixels) return;
    const next = { ...working, tolerance, samples: [...working.samples, pending] };
    const result = acceptColorAddition(accepted, proposal.mask, pending.label);
    onChange(next);
    setBase({ config: next, pixels, outline, result });
    setPending(null); setProposal(null); setRemoving(false);
  };
  const setSimilarity = (value: number) => {
    setTolerance(value);
    if (pending) { setProposal(null); setPending({ ...pending, tolerance: value, excluded: [] }); setRemoving(false); }
  };
  const undo = () => {
    if (pending || working.samples.length <= working.confirmed!.legacyCount) return;
    onChange({ ...working, samples: working.samples.slice(0, -1) });
  };
  const addGroup = () => {
    if (pending || groups.length >= 8) return;
    const nextLabel = Array.from({ length: 8 }, (_, i) => i + 3).find(n => !groups.some(g => g.label === n)) as ColorClass;
    const group = { id: crypto.randomUUID(), label: nextLabel, name: `Liquen ${String.fromCharCode(65 + nextLabel - 3)}` };
    onChange({ ...working, confirmed: { ...working.confirmed!, groups: [...groups, group] } });
    setTarget(nextLabel);
  };
  const rename = (name: string) => {
    if (!name.trim() || pending) return;
    onChange({ ...working, confirmed: { ...working.confirmed!, groups: groups.map(g => g.label === label ? { ...g, name: name.trim().slice(0, 80) } : g) } });
  };
  return { groups, label, setTarget, pending, proposal, accepted, error, notice, removing, setRemoving,
    tolerance, setSimilarity, pick, accept, discard, undo, addGroup, rename,
    canUndo: working.samples.length > working.confirmed!.legacyCount, legacyCount: working.confirmed!.legacyCount };
}

export function GuidedColorControls({ picker: p, config, onFocusPhoto, catalogue = false }: {
  picker: ReturnType<typeof useGuidedColorPicker>; config: ColorConfig; onFocusPhoto?: () => void;
  catalogue?: boolean;
}) {
  const group = p.groups.find(g => g.label === p.label)!;
  const tones = config.samples.filter(s => s.label === p.label);
  return <>
    <label style={{ fontSize: 13 }}>Estoy marcando
      <select aria-label={catalogue ? "Morfoespecie activa" : "Liquen activo"} value={p.label} disabled={!!p.pending} onChange={e => p.setTarget(Number(e.target.value) as ColorClass)}
        style={{ display: "block", width: "100%", minHeight: 44, borderRadius: 8, border: "1px solid #b5cbbc", marginTop: 4, padding: 8, font: "inherit" }}>
        {p.groups.map(g => <option key={g.id} value={g.label}>{g.name}</option>)}
      </select>
    </label>
    <div aria-label={`Tonos aceptados de ${group.name}`} style={{ border: "1px solid #d9e4dd", borderRadius: 10, padding: 10 }}>
      <p style={{ fontSize: 12, marginBottom: 6 }}><strong>{tones.length} {tones.length === 1 ? "tono aceptado" : "tonos aceptados"}</strong></p>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", maxHeight: 76, overflowY: "auto" }}>
        {tones.map((s, i) => <span key={i} title={`Tono ${i + 1}: RGB ${s.rgb.join(", ")}`} aria-label={`Tono aceptado ${i + 1}`}
          style={{ display: "inline-flex", gap: 3, alignItems: "center", fontSize: 11 }}>
          <span style={{ width: 26, height: 26, borderRadius: 6, background: rgb(s), border: "1px solid #69796d" }} />{i + 1} ✓
        </span>)}
        {!tones.length ? <span style={{ fontSize: 12 }}>Aún no has aceptado ningún color.</span> : null}
      </div>
    </div>
    {!p.pending ? <>
      <p role="status" style={{ fontSize: 13 }}>{tones.length ? `Los tonos aceptados forman una sola selección: ${group.name}. Toca otro tono de ese mismo liquen para ampliarla.` : `Toca en la foto el primer color de ${group.name}. Verás las zonas parecidas antes de aceptarlas.`}</p>
      <p style={{ fontSize: 11 }}>No selecciones colores de corteza.</p>
      <button className="g-primary" disabled={!p.accepted} onClick={onFocusPhoto} style={{ fontSize: 13 }}>{tones.length ? `+ Otro tono de ${group.name}` : `Elegir color de ${group.name}`}</button>
      <div style={{ display: "flex", gap: 6 }}>{!catalogue ? <button disabled={p.groups.length >= 8 || !p.accepted} onClick={p.addGroup} style={{ flex: 1, fontSize: 13 }}>+ Otro liquen</button> : null}
        <button disabled={!p.canUndo || !p.accepted} onClick={p.undo} style={{ fontSize: 13 }}>Deshacer añadido</button></div>
      {!catalogue ? <details><summary style={{ cursor: "pointer", fontSize: 13 }}>Nombre / identificación</summary>
        <label style={{ fontSize: 12 }}>Nombre de este grupo
          <input key={group.id + group.name} aria-label="Nombre del liquen" defaultValue={group.name} maxLength={80}
            onBlur={e => { if (e.target.value.trim() !== group.name) p.rename(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={{ width: "100%", minHeight: 44, padding: 8 }} />
        </label><p style={{ fontSize: 11 }}>Nombre aportado por ti; no confirma una especie. Los grupos son propios de esta foto.</p>
      </details> : null}
      {p.legacyCount ? <p style={{ fontSize: 11 }}>Selección anterior conservada. Los tonos nuevos no la reemplazan.</p> : null}
    </> : <>
      <div aria-label="Color capturado" style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, border: "2px solid #b50096", borderRadius: 10, background: "#fff6fd" }}>
        <span role="img" aria-label={`Color elegido: RGB ${p.pending.rgb.join(", ")}`} style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 8, background: rgb(p.pending), border: "1px solid #526057" }} />
        <div style={{ fontSize: 12, minWidth: 0 }}><strong>Color capturado ✓</strong><div title={`Tono ${tones.length + 1} para ${group.name}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Tono {tones.length + 1} para {group.name}</div><span>Aún no está aceptado.</span></div>
      </div>
      <p role="status" style={{ fontSize: 13 }}>{p.proposal && p.accepted
        ? `En fucsia: ${(100 * p.proposal.added / Math.max(1, p.accepted.total)).toFixed(1)} % nuevo del ${catalogue ? "cuadrante" : "tronco"}.`
        : "Color capturado. Buscando zonas de tonos parecidos…"}</p>
      <p style={{ fontSize: 11 }}>Fucsia = propuesta, no color real. Solo se añade al aceptar.</p>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="g-primary" disabled={!p.proposal?.added} onClick={p.accept} style={{ flex: 1, fontSize: 13 }}>Aceptar este tono</button>
        <button onClick={p.discard} style={{ fontSize: 13 }}>Descartar</button>
      </div>
      <label style={{ fontSize: 13 }}>Gama de tonos parecidos
        <input aria-label="Variación de color" style={{ width: "100%" }} type="range" min="3" max="35" value={p.tolerance}
          onChange={e => p.setSimilarity(Number(e.target.value))} />
        <span style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}><span>Más preciso</span><span>Más amplio</span></span>
      </label>
      <button aria-pressed={p.removing} disabled={!p.proposal?.added} onClick={() => p.setRemoving(!p.removing)} style={{ fontSize: 13 }}>{p.removing ? "Quitar zonas: activo" : "Quitar zona"}</button>
      {p.proposal?.conflicts ? <p style={{ fontSize: 11 }}>Las zonas de otro liquen se conservan; no se añadirán a este.</p> : null}
      {p.proposal && !p.proposal.added ? <p style={{ fontSize: 12 }}>No hay áreas nuevas. Ajusta la similitud o descarta este tono.</p> : null}
      {p.removing ? <p style={{ fontSize: 11 }}>Toca una zona fucsia para excluirla de esta propuesta.</p> : null}
    </>}
    {!p.accepted ? <p role="status" style={{ fontSize: 12 }}>Preparando selección…</p> : null}
    {p.error || p.notice ? <p role={p.error ? "alert" : "status"} style={{ fontSize: 12, color: p.error ? "#a0331e" : "inherit" }}>{p.error || p.notice}</p> : null}
  </>;
}

export function GuidedGroupCoverage({ config, counts, total }: { config: ColorConfig; counts: number[]; total: number }) {
  if (config.version !== 2 || !config.confirmed || total < 1) return null;
  return <details><summary style={{ cursor: "pointer", fontSize: 13 }}>Cobertura por liquen</summary>
    <dl style={{ fontSize: 12, margin: "8px 0" }}>{config.confirmed.groups.map(group => <div key={group.id} style={{ display: "flex", gap: 8, justifyContent: "space-between", marginBottom: 5 }}>
      <dt style={{ overflowWrap: "anywhere" }}><span style={{ display: "inline-block", width: 10, height: 10, marginRight: 4, borderRadius: 2, background: `rgb(${OVERLAY_RGB[group.label - 1].join(",")})` }} />{group.name}</dt>
      <dd style={{ margin: 0, whiteSpace: "nowrap" }}>{(100 * (counts[group.label] ?? 0) / total).toFixed(1)} %</dd>
    </div>)}</dl><p style={{ fontSize: 11 }}>Grupos marcados por ti en esta foto; no son especies verificadas.</p>
  </details>;
}
