"use client";

// Spanish review panel of the pilot: Buscando regiones → Sugiriendo etiquetas →
// Revisar.
//
// Regions come from MobileSAM (`services/vision`) through the existing vision
// routes; the masks are REAL pixels, drawn as such, editable pixel by pixel and
// used as they are to compute the reviewed coverage. Nothing is auto-accepted:
// the ranking is a suggestion, and only what a person accepts as lichen counts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  SuggestionRequestError,
  applyServerGeometry,
  gridPromptPoints,
  maskPixelHash,
  regionsFromMasks,
  requestRegionSuggestions,
} from "./client";
import { MAX_REGIONS_PER_VIEW } from "./crop-geometry";
import { canFinalizeReview, reviewedCoverage } from "./coverage";
import { decodeMaskRle, encodeMaskRle, maskArea } from "./mask-codec";
import { applyBrush, masksEqual } from "./mask-edit";
import {
  applyDecision,
  applyMaskEdit,
  mergeReviews,
  nextPhase,
  phaseNotice,
  restoreState,
  resultBelongsToContext,
  reviewCounts,
  sameViewIdentity,
  type SuggestionContext,
} from "./review";
import {
  MAX_WORKING_SIDE,
  SegmentationServiceError,
  decodeMaskToWorkingGrid,
  pickBestCandidate,
  prepareSegmentationSession,
  releaseSegmentationSession,
  segmentAtPoint,
  workingSize,
} from "./sam-service";
import { loadSavedBatch, saveBatch } from "./storage";
import {
  SUGGESTION_LABELS,
  SUGGESTION_LABEL_ES,
  type ProposedRegion,
  type RegionReview,
  type RegionSuggestion,
  type SuggestionLabel,
  type SuggestionPhase,
} from "./types";

const SUGGESTION_VERSION = "1";
const BRUSH_RADIUS = 12;

export interface RegionSuggestionsPanelProps {
  treeSampleId: string;
  direction: string;
  imageId: string;
  file: File;
}

interface GridState {
  width: number;
  height: number;
}

export function RegionSuggestionsPanel({
  treeSampleId,
  direction,
  imageId,
  file,
}: RegionSuggestionsPanelProps) {
  // The owner is resolved from the session, never taken from a prop or a URL.
  const [ownerId, setOwnerId] = useState<string>("");
  const [phase, setPhase] = useState<SuggestionPhase>("idle");
  const [regions, setRegions] = useState<ProposedRegion[]>([]);
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [reviews, setReviews] = useState<RegionReview[]>([]);
  const [grid, setGrid] = useState<GridState | null>(null);
  const [roiRle, setRoiRle] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState<"add" | "erase">("add");
  const [failure, setFailure] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [headWarning, setHeadWarning] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState(false);
  const [cached, setCached] = useState(false);

  // Live run generation and abort handle. A late answer is compared against the
  // generation that is CURRENT when it arrives, never against its own echo.
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const identityRef = useRef({ ownerId: "", treeSampleId, direction, imageId });
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const storageIdentity = useMemo(
    () => ({ ownerId, treeSampleId, direction, imageId }),
    [ownerId, treeSampleId, direction, imageId],
  );

  const resetForContext = useCallback(() => {
    // Context changed: the previous run is cancelled and nothing is carried
    // over to another tree, view or photograph.
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setRegions([]);
    setSuggestions([]);
    setReviews([]);
    setGrid(null);
    setRoiRle(null);
    setSelected(null);
    setEditing(null);
    setFailure(null);
    setBackend(null);
    setNotice(null);
    setHeadWarning(null);
    setCompleteness(false);
    setCached(false);
  }, []);

  // Session owner plus restoration of the saved batch (photographs, masks with
  // the reviewer's edits, suggestions and decisions) without re-running models.
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      const identity = { ownerId: data.user.id, treeSampleId, direction, imageId };
      if (!sameViewIdentity(identityRef.current, identity)) {
        resetForContext();
        identityRef.current = identity;
      }
      setOwnerId(data.user.id);
      const saved = loadSavedBatch(identity);
      if (!saved) return;
      const restored = restoreState(saved);
      setPhase(restored.phase);
      setRegions(restored.regions);
      setSuggestions(restored.suggestions);
      setReviews(restored.reviews);
      setBackend(saved.backend ?? null);
      setCompleteness(saved.completenessReviewed ?? false);
      setRoiRle(saved.roiRle ?? null);
      const first = restored.regions[0];
      if (first) setGrid({ width: first.maskWidth, height: first.maskHeight });
    });
    return () => {
      active = false;
    };
  }, [treeSampleId, direction, imageId, resetForContext]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const persist = useCallback(
    (next: {
      regions: ProposedRegion[];
      suggestions: RegionSuggestion[];
      reviews: RegionReview[];
      backend: string | null;
      completenessReviewed: boolean;
      roiRle: string | null;
    }) => {
      if (!ownerId) return;
      saveBatch(storageIdentity, next);
    },
    [ownerId, storageIdentity],
  );

  const run = useCallback(async () => {
    if (!ownerId) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestToken = crypto.randomUUID().replace(/-/g, "");

    setFailure(null);
    setCached(false);
    setPhase((current) => nextPhase(current, { type: "start" }));

    let proposed: ProposedRegion[] = [];
    let workingGrid: GridState;
    let sessionId = "";
    try {
      const session = await prepareSegmentationSession(file, controller.signal);
      if (generationRef.current !== generation) return;
      sessionId = session.sessionId;
      const size = workingSize(session.width, session.height, MAX_WORKING_SIDE);
      workingGrid = { width: size.width, height: size.height };
      const masks: Array<{ regionId: string; mask: Uint8Array; samScore: number }> = [];
      for (const [index, point] of gridPromptPoints().entries()) {
        const { candidates, recommendedIndex } = await segmentAtPoint(
          sessionId,
          point,
          controller.signal,
        );
        if (generationRef.current !== generation) return;
        const best = pickBestCandidate(candidates, recommendedIndex);
        if (!best) continue;
        const mask = await decodeMaskToWorkingGrid(best.maskDataUrl, size.width, size.height);
        if (generationRef.current !== generation) return;
        if (maskArea(mask) === 0) continue;
        masks.push({ regionId: `sam-${index}`, mask, samScore: best.score });
      }
      proposed = regionsFromMasks(
        masks,
        {
          width: size.width,
          height: size.height,
          originalWidth: session.width,
          originalHeight: session.height,
          // EXIF orientation is applied once upstream, by the vision service
          // and by the analysis proxy; the pilot never rotates again.
          orientationAppliedUpstream: true,
          rectified: false,
        },
        MAX_REGIONS_PER_VIEW,
      );
    } catch (error) {
      if (generationRef.current !== generation) return;
      setFailure(
        error instanceof SegmentationServiceError
          ? error.message
          : "MobileSAM no pudo proponer regiones en esta vista.",
      );
      setPhase((current) => nextPhase(current, { type: "worker_failed" }));
      return;
    } finally {
      if (sessionId) void releaseSegmentationSession(sessionId);
    }

    if (generationRef.current !== generation) return;
    setGrid(workingGrid);
    setRegions(proposed);
    setReviews((current) => mergeReviews(current, proposed));
    setPhase((current) => nextPhase(current, { type: "regions_found", count: proposed.length }));
    if (proposed.length === 0) return;

    const maskSetSha = maskPixelHash(proposed.map((region) => region.maskSha).join("|"));
    const expected: SuggestionContext = {
      generation,
      ownerId,
      treeSampleId,
      direction,
      imageId,
      requestToken,
      maskSetSha,
      suggestionVersion: SUGGESTION_VERSION,
    };

    try {
      const response = await requestRegionSuggestions(
        { imageId, treeSampleId, direction, requestToken },
        proposed,
        workingGrid,
        controller.signal,
      );
      // Guard AFTER the await, against the generation live at this moment.
      const received: SuggestionContext = {
        generation,
        ownerId: response.provenance.ownerId,
        treeSampleId: response.provenance.treeSampleId,
        direction: response.provenance.direction,
        imageId: response.provenance.imageId,
        requestToken: response.context.requestToken,
        maskSetSha,
        suggestionVersion: response.provenance.suggestionVersion,
      };
      const current: SuggestionContext = { ...expected, generation: generationRef.current };
      if (!resultBelongsToContext(current, received)) {
        // A superseded or foreign answer is discarded, never applied.
        return;
      }
      const incoming = response.suggestions.map((suggestion) => ({
        ...suggestion,
        backend: (response.backend === "ridge_head" ? "ridge_head" : "zeroshot") as
          | "zeroshot"
          | "ridge_head",
        encoderId: response.provenance.encoderId,
        headSha256: response.provenance.headSha256,
        preprocess: response.provenance.preprocessVersion,
        versions: { schema: response.provenance.suggestionVersion },
      }));
      const withGeometry = applyServerGeometry(proposed, response.geometry ?? []);
      const mergedReviews = mergeReviews(reviews, withGeometry);
      setRegions(withGeometry);
      setSuggestions(incoming);
      setReviews(mergedReviews);
      setBackend(response.backend);
      setCached(response.cached === true);
      setNotice(response.notice);
      setHeadWarning(response.headWarning ?? null);
      persist({
        regions: withGeometry,
        suggestions: incoming,
        reviews: mergedReviews,
        backend: response.backend,
        completenessReviewed: completeness,
        roiRle,
      });
      setPhase((current2) => nextPhase(current2, { type: "labels_ready" }));
    } catch (error) {
      if (generationRef.current !== generation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(
        error instanceof SuggestionRequestError
          ? error.message
          : "No se pudieron obtener sugerencias de etiqueta.",
      );
      setPhase((current2) => nextPhase(current2, { type: "worker_failed" }));
    }
  }, [
    completeness,
    direction,
    file,
    imageId,
    ownerId,
    persist,
    reviews,
    roiRle,
    treeSampleId,
  ]);

  const decide = useCallback(
    (regionId: string, decision: RegionReview["decision"], label?: SuggestionLabel | null) => {
      try {
        const next = applyDecision(reviews, {
          regionId,
          decision,
          label: label ?? null,
          reviewedBy: ownerId,
          reviewedAt: new Date().toISOString(),
        });
        setReviews(next);
        persist({
          regions,
          suggestions,
          reviews: next,
          backend,
          completenessReviewed: completeness,
          roiRle,
        });
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "No se pudo aplicar la revisión.");
      }
    },
    [backend, completeness, ownerId, persist, regions, reviews, roiRle, suggestions],
  );

  // Real pixel editing: the brush rewrites the mask, the region keeps the edited
  // pixels and the decision is re-anchored on the new hash.
  const paint = useCallback(
    (regionId: string, xNormalized: number, yNormalized: number) => {
      if (!grid) return;
      const index = regions.findIndex((region) => region.regionId === regionId);
      if (index < 0) return;
      const region = regions[index];
      const decoded = decodeMaskRle(region.maskRle);
      const painted = applyBrush(decoded.mask, decoded.width, decoded.height, {
        x: xNormalized * decoded.width,
        y: yNormalized * decoded.height,
        radius: BRUSH_RADIUS,
        mode: brushMode,
      });
      if (masksEqual(decoded.mask, painted)) return;
      const maskRle = encodeMaskRle(painted, decoded.width, decoded.height);
      const nextRegions = regions.slice();
      nextRegions[index] = {
        ...region,
        maskRle,
        maskSha: maskPixelHash(maskRle),
        maskAreaPixels: maskArea(painted),
      };
      const nextReviews = applyMaskEdit(
        reviews,
        regionId,
        nextRegions[index].maskSha,
        region.maskSha,
      );
      setRegions(nextRegions);
      setReviews(nextReviews);
      persist({
        regions: nextRegions,
        suggestions,
        reviews: nextReviews,
        backend,
        completenessReviewed: completeness,
        roiRle,
      });
    },
    [backend, brushMode, completeness, grid, persist, regions, reviews, roiRle, suggestions],
  );

  // ROI: the trunk area the reviewer confirms. Without a calibrated frame it is
  // the whole view, and the resulting percentage is exploratory only.
  const setFullViewRoi = useCallback(() => {
    if (!grid) return;
    const roi = new Uint8Array(grid.width * grid.height).fill(1);
    const encoded = encodeMaskRle(roi, grid.width, grid.height);
    setRoiRle(encoded);
    persist({
      regions,
      suggestions,
      reviews,
      backend,
      completenessReviewed: completeness,
      roiRle: encoded,
    });
  }, [backend, completeness, grid, persist, regions, reviews, suggestions]);

  // Overlay: the REAL masks are painted, not their bounding boxes.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !grid) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, grid.width, grid.height);
    const image = context.createImageData(grid.width, grid.height);
    for (const region of regions) {
      const review = reviews.find((item) => item.regionId === region.regionId);
      const colour =
        review?.decision === "accepted"
          ? [52, 211, 153]
          : review?.decision === "rejected"
            ? [248, 113, 113]
            : review?.decision === "undetermined"
              ? [148, 163, 184]
              : [250, 204, 21];
      const alpha = region.regionId === selected ? 190 : 110;
      const decoded = decodeMaskRle(region.maskRle);
      if (decoded.width !== grid.width || decoded.height !== grid.height) continue;
      for (let index = 0; index < decoded.mask.length; index += 1) {
        if (decoded.mask[index] === 0) continue;
        image.data[index * 4] = colour[0];
        image.data[index * 4 + 1] = colour[1];
        image.data[index * 4 + 2] = colour[2];
        image.data[index * 4 + 3] = alpha;
      }
    }
    context.putImageData(image, 0, 0);
  }, [grid, regions, reviews, selected]);

  const counts = reviewCounts(reviews);
  const info = phaseNotice(phase, regions.length, failure ?? undefined);
  const busy = phase === "searching_regions" || phase === "suggesting_labels";

  const coverage = useMemo(() => {
    if (!grid || !roiRle) return null;
    const roi = decodeMaskRle(roiRle);
    if (roi.width !== grid.width || roi.height !== grid.height) return null;
    const acceptedLichenMasks = reviews
      .filter((review) => review.decision === "accepted" && review.reviewedLabel === "lichen")
      .map((review) => regions.find((region) => region.regionId === review.regionId))
      .filter((region): region is ProposedRegion => Boolean(region))
      .map((region) => decodeMaskRle(region.maskRle).mask);
    return reviewedCoverage({
      acceptedLichenMasks,
      roiMask: roi.mask,
      width: grid.width,
      height: grid.height,
      completenessReviewed: completeness,
      roiSource: "tronco confirmado por el revisor (vista completa sin marco calibrado)",
    });
  }, [completeness, grid, regions, reviews, roiRle]);

  const finalisation = canFinalizeReview({
    pendingCount: counts.pending,
    completenessReviewed: completeness,
  });

  return (
    <section className="rounded-lg border border-dashed border-emerald-700/50 bg-slate-900/40 p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-emerald-200">
            Asistencia de regiones (piloto) · {direction}
          </h4>
          <p className="text-xs text-slate-300">
            {info.title}: {info.detail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !ownerId}
          className="rounded border border-emerald-500 px-3 py-1 text-emerald-200 disabled:opacity-50"
        >
          {busy ? "Procesando…" : "Proponer regiones (MobileSAM)"}
        </button>
      </header>

      {notice ? <p className="mt-2 text-xs text-amber-200">{notice}</p> : null}
      {headWarning ? (
        <p className="mt-2 text-xs text-amber-300">Cabeza entrenada: {headWarning}</p>
      ) : null}
      {failure ? (
        <p className="mt-2 text-xs text-amber-300">
          {failure} Tus fotografías y revisiones se conservan; puedes anotar manualmente.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,360px)_1fr]">
        <div
          className="relative"
          onClick={(event) => {
            if (!editing) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            paint(
              editing,
              (event.clientX - bounds.left) / bounds.width,
              (event.clientY - bounds.top) / bounds.height,
            );
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={`Vista ${direction}`} className="w-full rounded" />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          />
          {editing ? (
            <p className="absolute bottom-1 left-1 rounded bg-slate-900/80 px-2 py-0.5 text-[11px] text-emerald-200">
              Editando píxeles: {brushMode === "add" ? "añadir" : "borrar"}
            </p>
          ) : null}
        </div>

        <ul className="space-y-2">
          {regions.length === 0 ? (
            <li className="text-xs text-slate-300">
              Sin regiones propuestas. Que no haya propuestas no demuestra ausencia de líquenes:
              revisa la vista completa y añade o amplía máscaras antes de finalizar.
            </li>
          ) : null}
          {regions.map((region) => {
            const suggestion = suggestions.find((item) => item.regionId === region.regionId);
            const review = reviews.find((item) => item.regionId === region.regionId);
            const top = suggestion?.ranking?.[0];
            return (
              <li
                key={region.regionId}
                className={`rounded border p-2 ${
                  selected === region.regionId ? "border-emerald-400" : "border-slate-700"
                }`}
                onMouseEnter={() => setSelected(region.regionId)}
              >
                <p className="text-xs text-slate-200">
                  Sugerencia:{" "}
                  {top
                    ? `${top.labelEs} (puntuación cruda ${top.rawScore?.toFixed(3) ?? "—"})`
                    : "pendiente"}
                  {" · "}
                  Estado:{" "}
                  {review?.decision === "pending" ? "pendiente de revisión" : review?.decision}
                  {review?.maskEdited ? " · máscara editada" : ""}
                </p>
                <p className="text-[11px] text-slate-400">
                  Puntuación SAM {region.samScore.toFixed(3)} (calidad de máscara, no evidencia de
                  liquen) · {region.maskAreaPixels} px de máscara. La etiqueta no demuestra que todos
                  los píxeles sean liquen; nada se acepta automáticamente.
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {SUGGESTION_LABELS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => decide(region.regionId, "accepted", label)}
                      className="rounded border border-emerald-600 px-2 py-0.5 text-[11px] text-emerald-200"
                    >
                      Aceptar como {SUGGESTION_LABEL_ES[label]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => decide(region.regionId, "rejected")}
                    className="rounded border border-rose-600 px-2 py-0.5 text-[11px] text-rose-200"
                  >
                    Excluir
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(region.regionId, "undetermined")}
                    className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200"
                  >
                    Sin determinar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(region.regionId);
                      setEditing((current) =>
                        current === region.regionId ? null : region.regionId,
                      );
                    }}
                    className="rounded border border-sky-600 px-2 py-0.5 text-[11px] text-sky-200"
                  >
                    {editing === region.regionId ? "Terminar edición" : "Editar máscara"}
                  </button>
                  {editing === region.regionId ? (
                    <button
                      type="button"
                      onClick={() => setBrushMode((mode) => (mode === "add" ? "erase" : "add"))}
                      className="rounded border border-sky-600 px-2 py-0.5 text-[11px] text-sky-200"
                    >
                      Pincel: {brushMode === "add" ? "añadir" : "borrar"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-200">
        <button
          type="button"
          onClick={setFullViewRoi}
          disabled={!grid}
          className="rounded border border-slate-600 px-2 py-0.5 text-[11px] disabled:opacity-50"
        >
          Confirmar ROI de tronco (vista completa)
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={completeness}
            onChange={(event) => {
              setCompleteness(event.target.checked);
              persist({
                regions,
                suggestions,
                reviews,
                backend,
                completenessReviewed: event.target.checked,
                roiRle,
              });
            }}
          />
          Revisé todo el ROI y añadí o amplié las máscaras omitidas.
        </label>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        Pendientes {counts.pending} · Aceptadas {counts.accepted} (liquen {counts.acceptedLichen}) ·
        Excluidas {counts.rejected} · Sin determinar {counts.undetermined} · Máscaras editadas{" "}
        {counts.maskEdited} · Backend {backend ?? "no ejecutado"}
        {cached ? " (reutilizado de caché)" : ""}.
      </p>

      <p className="mt-1 text-[11px] text-slate-300">
        {coverage === null
          ? "Cobertura revisada: confirma el ROI de tronco para calcularla."
          : coverage.available
            ? `Cobertura revisada exploratoria: ${coverage.coveragePercent?.toFixed(2)} % `
              + `(${coverage.intersectionPixels} px de unión aceptada sobre ${coverage.roiPixels} px de ROI). `
              + coverage.notice
            : `Cobertura revisada no disponible (${coverage.unavailableReason}). ${coverage.notice}`}
      </p>
      {!finalisation.canFinalize && finalisation.reason ? (
        <p className="mt-1 text-[11px] text-amber-200">{finalisation.reason}</p>
      ) : null}
    </section>
  );
}
