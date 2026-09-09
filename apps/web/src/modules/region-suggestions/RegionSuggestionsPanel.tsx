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
  applyEditedMask,
  applyServerGeometry,
  gridPromptPoints,
  manualRegion,
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
  type SegmentationSession,
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
  // Dimensions of the space the grid was derived from (the analysis proxy when
  // MobileSAM prepared the view, the preview otherwise), kept for traceability.
  originalWidth: number;
  originalHeight: number;
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
  // The ROI is painted with the same brush as a mask: the trunk is delimited by
  // the reviewer, because a whole photograph is not a trunk.
  const [roiEditing, setRoiEditing] = useState(false);
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
  const previewRef = useRef<HTMLImageElement | null>(null);
  const manualCounterRef = useRef(0);

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
    setRoiEditing(false);
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
      if (first) {
        const step = first.transformChain.find((item) => item.step === "working_grid");
        setGrid({
          width: first.maskWidth,
          height: first.maskHeight,
          originalWidth: step && "originalWidth" in step ? step.originalWidth : first.maskWidth,
          originalHeight: step && "originalHeight" in step ? step.originalHeight : first.maskHeight,
        });
      }
      manualCounterRef.current = restored.regions.filter((region) =>
        region.regionId.startsWith("manual-"),
      ).length;
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

  // Working grid used for ROI and manual masks before (or without) any
  // MobileSAM proposal. When the service has not prepared the view yet, the
  // preview's own dimensions define the grid; the geometry contract is applied
  // once, here.
  const ensureGrid = useCallback((): GridState | null => {
    if (grid) return grid;
    const image = previewRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return null;
    const size = workingSize(image.naturalWidth, image.naturalHeight, MAX_WORKING_SIDE);
    const next: GridState = {
      width: size.width,
      height: size.height,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
    };
    setGrid(next);
    return next;
  }, [grid]);

  // Asks BioCLIP for labels for the regions given, WITHOUT touching their
  // pixels: this is what "retry labels" does, so a failed classification can
  // never overwrite masks the reviewer edited.
  const classify = useCallback(
    async (
      candidates: ProposedRegion[],
      workingGrid: GridState,
      generation: number,
      controller: AbortController,
    ) => {
      const usable = candidates.filter((region) => region.maskAreaPixels > 0);
      if (usable.length === 0) {
        setFailure(
          "No hay máscaras con píxeles que clasificar. Dibuja o amplía una máscara y reinténtalo.",
        );
        setPhase((current) => nextPhase(current, { type: "worker_failed" }));
        return;
      }
      const requestToken = crypto.randomUUID().replace(/-/g, "");
      const maskSetSha = maskPixelHash(usable.map((region) => region.maskSha).join("|"));
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
          usable,
          { width: workingGrid.width, height: workingGrid.height },
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
        // Only the crop geometry of the classified regions is updated; masks,
        // ROI and human decisions are untouched.
        const withGeometry = applyServerGeometry(candidates, response.geometry ?? []);
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
    },
    [completeness, direction, imageId, ownerId, persist, reviews, roiRle, treeSampleId],
  );

  // Explicit regeneration: MobileSAM proposes again and the previous proposals
  // are REPLACED. This is destructive by definition, so it is a separate action
  // from retrying a failed classification.
  const regenerate = useCallback(async () => {
    if (!ownerId) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFailure(null);
    setCached(false);
    setPhase((current) => nextPhase(current, { type: "start" }));

    let proposed: ProposedRegion[] = [];
    let workingGrid: GridState;
    let samSession: SegmentationSession | null = null;
    try {
      // Only a small reference travels: the server reads the private analysis
      // proxy after checking the owner, the image-view-tree association and the
      // four originals/proxies of the series.
      const session = await prepareSegmentationSession(
        { imageId, treeSampleId, direction },
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      samSession = session;
      const size = workingSize(session.width, session.height, MAX_WORKING_SIDE);
      workingGrid = {
        width: size.width,
        height: size.height,
        originalWidth: session.width,
        originalHeight: session.height,
      };
      const masks: Array<{ regionId: string; mask: Uint8Array; samScore: number }> = [];
      for (const [index, point] of gridPromptPoints().entries()) {
        const { candidates, recommendedIndex } = await segmentAtPoint(
          session,
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
          // The session was prepared from the analysis proxy, so these are the
          // proxy's dimensions and the masks live in the proxy space.
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
      if (samSession) void releaseSegmentationSession(samSession);
    }

    if (generationRef.current !== generation) return;
    setGrid(workingGrid);
    setRegions(proposed);
    setEditing(null);
    setReviews((current) => mergeReviews(current, proposed));
    setPhase((current) => nextPhase(current, { type: "regions_found", count: proposed.length }));
    if (proposed.length === 0) return;
    await classify(proposed, workingGrid, generation, controller);
  }, [classify, direction, imageId, ownerId, treeSampleId]);

  // Retry of the labelling step only. Nothing is resegmented, so edited masks,
  // the ROI and the decisions already taken survive untouched.
  const retryClassification = useCallback(async () => {
    if (!ownerId || regions.length === 0) return;
    const workingGrid = ensureGrid();
    if (!workingGrid) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFailure(null);
    setCached(false);
    setPhase((current) => nextPhase(current, { type: "regions_found", count: regions.length }));
    await classify(regions, workingGrid, generation, controller);
  }, [classify, ensureGrid, ownerId, regions]);

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
      const nextRegions = regions.slice();
      nextRegions[index] = applyEditedMask(region, painted, decoded.width, decoded.height);
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

  // The ROI is painted with the same brush: the trunk is delimited by the
  // reviewer on the photograph, not assumed to be the whole frame.
  const paintRoi = useCallback(
    (xNormalized: number, yNormalized: number) => {
      const workingGrid = ensureGrid();
      if (!workingGrid) return;
      const current =
        roiRle !== null
          ? decodeMaskRle(roiRle)
          : {
              mask: new Uint8Array(workingGrid.width * workingGrid.height),
              width: workingGrid.width,
              height: workingGrid.height,
            };
      if (current.width !== workingGrid.width || current.height !== workingGrid.height) return;
      const painted = applyBrush(current.mask, current.width, current.height, {
        x: xNormalized * current.width,
        y: yNormalized * current.height,
        radius: BRUSH_RADIUS * 2,
        mode: brushMode,
      });
      if (masksEqual(current.mask, painted)) return;
      const encoded = encodeMaskRle(painted, current.width, current.height);
      setRoiRle(encoded);
      persist({
        regions,
        suggestions,
        reviews,
        backend,
        completenessReviewed: completeness,
        roiRle: encoded,
      });
    },
    [
      backend,
      brushMode,
      completeness,
      ensureGrid,
      persist,
      regions,
      reviews,
      roiRle,
      suggestions,
    ],
  );

  // A mask the reviewer adds because MobileSAM missed the region — available
  // even when there is not a single proposal, since "no proposal" is not proof
  // of absence.
  const addOmittedRegion = useCallback(() => {
    const workingGrid = ensureGrid();
    if (!workingGrid) {
      setFailure("Aún no se puede dibujar: espera a que cargue la fotografía.");
      return;
    }
    if (regions.length >= MAX_REGIONS_PER_VIEW) {
      setFailure("Se alcanzó el máximo de regiones para esta vista.");
      return;
    }
    manualCounterRef.current += 1;
    const region = manualRegion(`manual-${manualCounterRef.current}`, {
      width: workingGrid.width,
      height: workingGrid.height,
      originalWidth: workingGrid.originalWidth,
      originalHeight: workingGrid.originalHeight,
      orientationAppliedUpstream: true,
      rectified: false,
    });
    const nextRegions = [...regions, region];
    const nextReviews = mergeReviews(reviews, nextRegions);
    setRegions(nextRegions);
    setReviews(nextReviews);
    setSelected(region.regionId);
    setRoiEditing(false);
    setEditing(region.regionId);
    setBrushMode("add");
    persist({
      regions: nextRegions,
      suggestions,
      reviews: nextReviews,
      backend,
      completenessReviewed: completeness,
      roiRle,
    });
  }, [
    backend,
    completeness,
    ensureGrid,
    persist,
    regions,
    reviews,
    roiRle,
    suggestions,
  ]);

  // Fallback ROI: the whole view. It is offered explicitly and labelled as such
  // because a whole photograph is NOT a trunk; the resulting percentage is
  // exploratory only.
  const setFullViewRoi = useCallback(() => {
    const workingGrid = ensureGrid();
    if (!workingGrid) return;
    const roi = new Uint8Array(workingGrid.width * workingGrid.height).fill(1);
    const encoded = encodeMaskRle(roi, workingGrid.width, workingGrid.height);
    setRoiRle(encoded);
    persist({
      regions,
      suggestions,
      reviews,
      backend,
      completenessReviewed: completeness,
      roiRle: encoded,
    });
  }, [backend, completeness, ensureGrid, persist, regions, reviews, suggestions]);

  const clearRoi = useCallback(() => {
    setRoiRle(null);
    persist({
      regions,
      suggestions,
      reviews,
      backend,
      completenessReviewed: completeness,
      roiRle: null,
    });
  }, [backend, completeness, persist, regions, reviews, suggestions]);

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
    // The reviewed ROI is drawn faithfully underneath, so what is measured is
    // what is seen.
    if (roiRle) {
      const roi = decodeMaskRle(roiRle);
      if (roi.width === grid.width && roi.height === grid.height) {
        for (let index = 0; index < roi.mask.length; index += 1) {
          if (roi.mask[index] === 0) continue;
          image.data[index * 4] = 56;
          image.data[index * 4 + 1] = 108;
          image.data[index * 4 + 2] = 189;
          image.data[index * 4 + 3] = 70;
        }
      }
    }
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
  }, [grid, regions, reviews, roiRle, selected]);

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
      roiSource:
        maskArea(roi.mask) === roi.width * roi.height
          ? "vista completa aceptada como ROI (atajo exploratorio: la fotografía no es el tronco)"
          : "tronco delimitado a mano por el revisor sobre la fotografía",
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy || !ownerId}
            className="rounded border border-emerald-500 px-3 py-1 text-emerald-200 disabled:opacity-50"
          >
            {busy ? "Procesando…" : "Proponer regiones (MobileSAM)"}
          </button>
          <button
            type="button"
            onClick={() => void retryClassification()}
            disabled={busy || !ownerId || regions.length === 0}
            className="rounded border border-sky-500 px-3 py-1 text-sky-200 disabled:opacity-50"
            title="Vuelve a pedir etiquetas a BioCLIP sin volver a segmentar: conserva las máscaras editadas, el ROI y tus decisiones."
          >
            Reintentar etiquetas (BioCLIP)
          </button>
        </div>
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
            if (!editing && !roiEditing) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width;
            const y = (event.clientY - bounds.top) / bounds.height;
            if (roiEditing) paintRoi(x, y);
            else if (editing) paint(editing, x, y);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={previewRef}
            src={previewUrl}
            alt={`Vista ${direction}`}
            className="w-full rounded"
          />
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          />
          {roiEditing || editing ? (
            <p className="absolute bottom-1 left-1 rounded bg-slate-900/80 px-2 py-0.5 text-[11px] text-emerald-200">
              {roiEditing ? "Delimitando ROI de tronco" : "Editando píxeles de la máscara"}:{" "}
              {brushMode === "add" ? "añadir" : "borrar"}
            </p>
          ) : null}
        </div>

        <ul className="space-y-2">
          {regions.length === 0 ? (
            <li className="text-xs text-slate-300">
              Sin regiones propuestas. Que no haya propuestas no demuestra ausencia de líquenes:
              revisa todo el ROI y usa «Añadir máscara omitida» para dibujar a mano las que falten
              antes de finalizar.
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
                      setRoiEditing(false);
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
          onClick={() => {
            setRoiEditing((current) => !current);
            setEditing(null);
            setBrushMode("add");
          }}
          className={`rounded border px-2 py-0.5 text-[11px] ${
            roiEditing ? "border-sky-400 text-sky-200" : "border-slate-600"
          }`}
        >
          {roiEditing ? "Terminar ROI de tronco" : "Delimitar ROI de tronco"}
        </button>
        {roiEditing ? (
          <button
            type="button"
            onClick={() => setBrushMode((mode) => (mode === "add" ? "erase" : "add"))}
            className="rounded border border-sky-600 px-2 py-0.5 text-[11px] text-sky-200"
          >
            Pincel ROI: {brushMode === "add" ? "añadir" : "borrar"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={setFullViewRoi}
          className="rounded border border-slate-600 px-2 py-0.5 text-[11px]"
          title="Atajo exploratorio: toda la fotografía no es el tronco."
        >
          Usar vista completa como ROI (exploratorio)
        </button>
        <button
          type="button"
          onClick={clearRoi}
          disabled={!roiRle}
          className="rounded border border-slate-600 px-2 py-0.5 text-[11px] disabled:opacity-50"
        >
          Borrar ROI
        </button>
        <button
          type="button"
          onClick={addOmittedRegion}
          className="rounded border border-emerald-600 px-2 py-0.5 text-[11px] text-emerald-200"
        >
          Añadir máscara omitida
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
