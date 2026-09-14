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
import { TrunkOutlineEditor } from "./TrunkOutlineEditor";
import { clipToTrunk, parseTrunkOutline, rasterizeTrunk, trunkPromptPoints, trunkStorageKey, type TrunkPoint } from "./trunk-outline";
import {
  SUGGESTION_LABELS,
  SUGGESTION_LABEL_ES,
  type ProposedRegion,
  type RegionReview,
  type RegionSuggestion,
  type SuggestionLabel,
  type SuggestionPhase,
} from "./types";

// Must match `SUGGESTION_VERSION` in `server/suggest.ts`: a batch produced with
// another version of the crop/preprocessing contract is not applied.
const SUGGESTION_VERSION = "3";
const BRUSH_RADIUS = 12;
const VIEW_NAMES: Record<string, string> = { N: "Norte", E: "Este", S: "Sur", W: "Oeste" };
const CONTROL = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 aria-pressed:border-emerald-800 aria-pressed:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

function decisionLabel(review?: RegionReview): string {
  if (review?.decision === "accepted") {
    return `Aceptada como ${review.reviewedLabel ? SUGGESTION_LABEL_ES[review.reviewedLabel] : "sin etiqueta"}`;
  }
  if (review?.decision === "rejected") return "Excluida";
  if (review?.decision === "undetermined") return "Sin determinar";
  return "Pendiente de revisión";
}

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
  const [trunkOutline, setTrunkOutline] = useState<TrunkPoint[] | null>(null);
  const [outlineEditing, setOutlineEditing] = useState(false);
  const [outlineNotice, setOutlineNotice] = useState<string | null>(null);
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
  // Presentation only: changing focus or visibility never modifies mask pixels,
  // human decisions, saved batches or the inputs sent to either model.
  const [showMasks, setShowMasks] = useState(true);
  const [showAllMasks, setShowAllMasks] = useState(false);
  const [maskOpacity, setMaskOpacity] = useState(35);
  const [confirmRegeneration, setConfirmRegeneration] = useState(false);
  const activeRegion = regions.find((region) => region.regionId === selected) ?? regions[0];
  const activeRegionId = activeRegion?.regionId ?? null;
  const activeIndex = regions.findIndex((region) => region.regionId === activeRegionId);
  const editingPixels = editing !== null || roiEditing || outlineEditing;

  // Live run generation and abort handle. A late answer is compared against the
  // generation that is CURRENT when it arrives, never against its own echo.
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const identityRef = useRef({ ownerId: "", treeSampleId, direction, imageId });
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLImageElement | null>(null);
  const manualCounterRef = useRef(0);

  // Live mirrors of the state a slow BioCLIP answer must not roll back. They are
  // committed after every render, so a callback created before the request still
  // sees what the reviewer has done since.
  const regionsRef = useRef<ProposedRegion[]>(regions);
  const reviewsRef = useRef<RegionReview[]>(reviews);
  const roiRleRef = useRef<string | null>(roiRle);
  const completenessRef = useRef(completeness);
  useEffect(() => {
    regionsRef.current = regions;
    reviewsRef.current = reviews;
    roiRleRef.current = roiRle;
    completenessRef.current = completeness;
  }, [completeness, regions, reviews, roiRle]);

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
    setTrunkOutline(null);
    setOutlineEditing(false);
    setOutlineNotice(null);
    setSelected(null);
    setEditing(null);
    setRoiEditing(false);
    setFailure(null);
    setBackend(null);
    setNotice(null);
    setHeadWarning(null);
    setCompleteness(false);
    setCached(false);
    setShowMasks(true);
    setShowAllMasks(false);
    setMaskOpacity(35);
    setConfirmRegeneration(false);
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
      try { setTrunkOutline(parseTrunkOutline(window.localStorage.getItem(trunkStorageKey(identity)))); }
      catch { setTrunkOutline(null); }
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

  // Also restores a contour saved before the first model run (no regions yet).
  useEffect(() => {
    if (!trunkOutline) return;
    const working = ensureGrid();
    if (working) setRoiRle(encodeMaskRle(rasterizeTrunk(trunkOutline, working.width, working.height), working.width, working.height));
  }, [trunkOutline, ensureGrid]);

  const confirmTrunk = useCallback((points: TrunkPoint[]) => {
    const working = ensureGrid();
    if (!working) { setOutlineNotice("La fotografía todavía está cargando. Vuelve a confirmar el contorno."); return false; }
    const mask = rasterizeTrunk(points, working.width, working.height);
    if (maskArea(mask) === 0) { setOutlineNotice("El contorno no contiene píxeles. Amplíalo un poco."); return false; }
    const encoded = encodeMaskRle(mask, working.width, working.height);
    setTrunkOutline(points);
    setRoiRle(encoded);
    setCompleteness(false);
    setConfirmRegeneration(false);
    setOutlineNotice(regions.length
      ? "Contorno guardado. Tus regiones y decisiones anteriores siguen intactas; para buscar dentro del tronco, usa «Volver a proponer regiones»."
      : "Contorno guardado. Ya puedes pedir propuestas dentro del tronco.");
    try { window.localStorage.setItem(trunkStorageKey(storageIdentity), JSON.stringify({ version: 1, points })); }
    catch { setOutlineNotice("Contorno activo en esta pestaña, pero el navegador no pudo guardarlo. No cierres esta página."); }
    persist({ regions, suggestions, reviews, backend, completenessReviewed: false, roiRle: encoded });
    return true;
  }, [ensureGrid, regions, suggestions, reviews, backend, storageIdentity, persist]);

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

      // What the masks looked like when the request left. Anything the reviewer
      // edits while waiting is newer than the answer and wins.
      const shaAtRequest = new Map(candidates.map((region) => [region.regionId, region.maskSha]));

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
        // The answer is applied over the LIVE state, never over the snapshot
        // taken when the request started: while BioCLIP was answering the
        // reviewer may have edited a mask, painted the ROI or decided a region.
        const liveRegions = regionsRef.current;
        const stillValid = (regionId: string): boolean => {
          const live = liveRegions.find((region) => region.regionId === regionId);
          return live !== undefined && live.maskSha === shaAtRequest.get(regionId);
        };
        const incoming = response.suggestions
          .filter((suggestion) => stillValid(suggestion.regionId))
          .map((suggestion) => ({
            ...suggestion,
            backend: (response.backend === "ridge_head" ? "ridge_head" : "zeroshot") as
              | "zeroshot"
              | "ridge_head",
            encoderId: response.provenance.encoderId,
            headSha256: response.provenance.headSha256,
            preprocess: response.provenance.preprocessVersion,
            versions: { schema: response.provenance.suggestionVersion },
          }));
        // Only the crop geometry of regions whose pixels did NOT change is
        // updated; an edited mask keeps its own geometry, and ROI, completeness
        // and human decisions are read live too.
        const geometry = (response.geometry ?? []).filter((entry) => stillValid(entry.regionId));
        const withGeometry = applyServerGeometry(liveRegions, geometry);
        const mergedReviews = mergeReviews(reviewsRef.current, withGeometry);
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
          completenessReviewed: completenessRef.current,
          roiRle: roiRleRef.current,
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
    [direction, imageId, ownerId, persist, treeSampleId],
  );

  // Explicit regeneration: MobileSAM proposes again and the previous proposals
  // are REPLACED. This is destructive by definition, so it is a separate action
  // from retrying a failed classification.
  const regenerate = useCallback(async () => {
    if (!ownerId || !trunkOutline || outlineEditing) return;
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
      const trunkMask = rasterizeTrunk(trunkOutline, size.width, size.height);
      const prompts = trunkPromptPoints(trunkMask, size.width, size.height);
      if (!prompts.length) throw new Error("El contorno no contiene puntos de búsqueda.");
      const trunkRle = encodeMaskRle(trunkMask, size.width, size.height);
      setGrid(workingGrid);
      setRoiRle(trunkRle);
      roiRleRef.current = trunkRle;
      setCompleteness(false);
      completenessRef.current = false;
      const trunkHash = maskPixelHash(trunkRle);
      const masks: Array<{ regionId: string; mask: Uint8Array; samScore: number }> = [];
      for (const [index, point] of prompts.entries()) {
        const { candidates, recommendedIndex } = await segmentAtPoint(
          session,
          point,
          controller.signal,
        );
        if (generationRef.current !== generation) return;
        const best = pickBestCandidate(candidates, recommendedIndex);
        if (!best) continue;
        const decoded = await decodeMaskToWorkingGrid(best.maskDataUrl, size.width, size.height);
        const mask = clipToTrunk(decoded, trunkMask);
        if (generationRef.current !== generation) return;
        if (maskArea(mask) === 0) continue;
        masks.push({ regionId: `sam-trunk-${trunkHash}-${index}`, mask, samScore: best.score });
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
  }, [classify, direction, imageId, ownerId, treeSampleId, trunkOutline, outlineEditing]);

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
    // `regions_found` is ignored outside `searching_regions`, so a retry from
    // `unavailable` used to keep showing "Asistencia no disponible" even when the
    // labels arrived. `retry_labels` is the event for retrying only this step.
    setPhase((current) => nextPhase(current, { type: "retry_labels" }));
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
    if (!showMasks && !editingPixels) return;
    const image = context.createImageData(grid.width, grid.height);
    // The reviewed ROI is drawn faithfully underneath, so what is measured is
    // what is seen.
    if (roiRle && (roiEditing || showAllMasks)) {
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
    // Draw the focused region last, so an overlapping proposal cannot hide it.
    const visibleRegions = regions
      .filter((region) => !roiEditing && (showAllMasks || region.regionId === activeRegionId))
      .sort((a, b) => Number(a.regionId === activeRegionId) - Number(b.regionId === activeRegionId));
    for (const region of visibleRegions) {
      const review = reviews.find((item) => item.regionId === region.regionId);
      const colour =
        review?.decision === "accepted"
          ? [52, 211, 153]
          : review?.decision === "rejected"
            ? [248, 113, 113]
            : review?.decision === "undetermined"
              ? [148, 163, 184]
              : [250, 204, 21];
      const alpha = Math.round(255 * maskOpacity / 100 * (region.regionId === activeRegionId ? 1 : 0.45));
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
  }, [activeRegionId, editingPixels, grid, maskOpacity, regions, reviews, roiEditing, roiRle, showAllMasks, showMasks]);

  // Preserve earlier decisions in storage, but don't count orphaned region IDs
  // after an explicit regeneration changes the proposal set.
  const counts = reviewCounts(reviews.filter(review => regions.some(region => region.regionId === review.regionId)));
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
    <section aria-label={`Revisión de regiones · ${VIEW_NAMES[direction] ?? direction}`} className="rounded-xl border border-emerald-200 bg-white p-4 text-sm text-slate-900 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4" style={{ display: "flex" }}>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Identificación asistida · piloto</p>
          <h4 className="mt-1 text-xl font-semibold">{VIEW_NAMES[direction] ?? direction}: revisar regiones</h4>
          <p className="mt-2 text-slate-700">{info.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => regions.length ? setConfirmRegeneration(true) : void regenerate()}
            disabled={busy || !ownerId || editingPixels || !trunkOutline}
            className="min-h-11 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Procesando…" : regions.length ? "Volver a proponer regiones" : "Proponer regiones (MobileSAM)"}
          </button>
          <button
            type="button"
            onClick={() => void retryClassification()}
            disabled={busy || !ownerId || regions.length === 0 || outlineEditing}
            className={CONTROL}
            title="Conserva las máscaras editadas, el área delimitada y tus decisiones. No vuelve a segmentar."
          >
            Reintentar etiquetas (BioCLIP)
          </button>
        </div>
      </header>

      {confirmRegeneration ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950" role="alert">
          <p>Volver a proponer regiones reemplaza las máscaras actuales. Para conservarlas, reintenta solo las etiquetas.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={CONTROL} onClick={() => setConfirmRegeneration(false)}>Conservar mis regiones</button>
            <button type="button" disabled={busy || editingPixels || !trunkOutline} className={CONTROL} onClick={() => { setConfirmRegeneration(false); void regenerate(); }}>Confirmar nueva propuesta</button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
        <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-900">Fotografía guardada</span>
        <span className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-900">
          IA: {busy ? info.title : phase === "unavailable" ? "requiere reintento" : suggestions.length > 0 ? `${suggestions.length} sugerencias recibidas` : info.title.toLowerCase()}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-800">
          Revisión: {counts.pending} pendientes · {counts.accepted + counts.rejected + counts.undetermined} revisadas
        </span>
      </div>
      <p className="mt-3 text-slate-700">La identificación y la calibración son pasos distintos. Una sugerencia de IA no confirma la especie ni una medición de cobertura.</p>
      <TrunkOutlineEditor key={`${ownerId}:${imageId}:${direction}`} src={previewUrl} viewName={VIEW_NAMES[direction] ?? direction} points={trunkOutline}
        disabled={busy || !ownerId || editing !== null || roiEditing} onConfirm={confirmTrunk} onEditingChange={setOutlineEditing} />
      <p className="mt-2 text-xs text-slate-600">El contorno se guarda en este navegador para esta fotografía, árbol y vista. No cambia la imagen original ni inicia la IA por sí solo.</p>
      {outlineNotice ? <p className="mt-2 rounded-lg bg-sky-50 p-3 text-sky-950" role="status">{outlineNotice}</p> : null}
      {!trunkOutline ? <p className="mt-2 font-medium text-sky-950">Primero confirma el contorno del tronco para habilitar nuevas propuestas.</p> : null}

      {notice ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{notice}</p> : null}
      {headWarning ? <p className="mt-2 text-sm text-amber-900">Cabeza entrenada: {headWarning}</p> : null}
      {failure ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950" role="alert">
          {failure} Tus fotografías y revisiones se conservan; puedes anotar manualmente.
        </p>
      ) : null}

      <div className={`${outlineEditing ? "hidden" : "grid"} mt-5 items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]`}>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showMasks || editingPixels} disabled={editingPixels} onChange={(event) => setShowMasks(event.target.checked)} className="h-4 w-4 accent-emerald-800" />
              Mostrar máscaras
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={showAllMasks} disabled={editingPixels || !showMasks} onChange={(event) => setShowAllMasks(event.target.checked)} className="h-4 w-4 accent-emerald-800" />
              Ver todas las regiones
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              Opacidad
              <input type="range" min="10" max="80" step="5" value={maskOpacity} disabled={!showMasks && !editingPixels} onChange={(event) => setMaskOpacity(Number(event.target.value))} className="w-24 accent-emerald-800" />
              <span className="tabular-nums">{maskOpacity}%</span>
            </label>
          </div>
          <div
            className="relative overflow-hidden rounded-lg bg-slate-100"
            onClick={(event) => {
              if (!editing && !roiEditing) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - bounds.left) / bounds.width;
              const y = (event.clientY - bounds.top) / bounds.height;
              if (roiEditing) paintRoi(x, y);
              else if (editing) paint(editing, x, y);
            }}
          >
            {/* Keep image + overlay in the SAME unstretched box: no letterboxing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={previewRef} src={previewUrl} alt={`Vista ${VIEW_NAMES[direction] ?? direction}`} className="block h-auto w-full" onLoad={() => { ensureGrid(); }} />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
            {trunkOutline ? <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <polygon points={trunkOutline.map(p => `${p.x * 1000},${p.y * 1000}`).join(" ")} fill="none" stroke="#0284c7" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg> : null}
            {editingPixels ? (
              <p className="pointer-events-none absolute bottom-2 left-2 right-2 rounded bg-slate-950/90 px-3 py-2 text-sm text-white">
                {roiEditing ? "Delimitando área de tronco" : "Editando píxeles de la máscara"}: {brushMode === "add" ? "añadir" : "borrar"}. Pulsa sobre la fotografía.
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {roiEditing ? "Azul: área de tronco que estás delimitando." : showMasks ? "Amarillo: pendiente · verde: aceptada · rojo: excluida · gris: sin determinar." : "Fotografía sin superposiciones. Las máscaras y decisiones siguen guardadas."}
          </p>
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
          {regions.length > 0 ? (
            <nav aria-label={`Elegir región · ${direction}`}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" className={CONTROL} disabled={activeIndex <= 0 || editingPixels} onClick={() => setSelected(regions[activeIndex - 1].regionId)}>Anterior</button>
                <p className="font-semibold tabular-nums" aria-live="polite">Región {activeIndex + 1} de {regions.length}</p>
                <button type="button" className={CONTROL} disabled={activeIndex >= regions.length - 1 || editingPixels} onClick={() => setSelected(regions[activeIndex + 1].regionId)}>Siguiente</button>
              </div>
              <label className="mt-3 block text-sm font-medium">
                Ir a una región
                <select className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" value={activeRegionId ?? ""} disabled={editingPixels} onChange={(event) => setSelected(event.target.value)}>
                  {regions.map((region, index) => (
                    <option key={region.regionId} value={region.regionId}>Región {index + 1} · {decisionLabel(reviews.find((review) => review.regionId === region.regionId))}</option>
                  ))}
                </select>
              </label>
              {editingPixels ? <p className="mt-2 text-xs text-sky-900">Termina la edición para cambiar de región.</p> : null}
            </nav>
          ) : null}
          <ul className="mt-4 space-y-3">
            {regions.length === 0 ? (
              <li className="text-sm text-slate-700">
                Sin regiones propuestas. Que no haya propuestas no demuestra ausencia de líquenes:
                revisa toda la fotografía y usa «Añadir máscara omitida» para dibujar las que falten.
              </li>
            ) : null}
            {activeRegion ? [activeRegion].map((region) => {
              const suggestion = suggestions.find((item) => item.regionId === region.regionId);
              const review = reviews.find((item) => item.regionId === region.regionId);
              const top = suggestion?.ranking?.[0];
              return (
                <li key={region.regionId} data-region-id={region.regionId}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sugerencia de la IA</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-950">{top?.labelEs ?? "Sin etiqueta"}</p>
                  <p className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium">{decisionLabel(review)}{review?.maskEdited ? " · máscara editada" : ""}</p>
                  <p className="mt-3 text-sm text-slate-700">Comprueba la zona resaltada. Tú decides qué contiene; nada se acepta automáticamente.</p>
                  <div className="mt-4 grid gap-2">
                    {SUGGESTION_LABELS.map((label) => (
                      <button key={label} type="button" onClick={() => decide(region.regionId, "accepted", label)} className={CONTROL} aria-pressed={review?.decision === "accepted" && review.reviewedLabel === label}>
                        Aceptar como {SUGGESTION_LABEL_ES[label]}
                      </button>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => decide(region.regionId, "rejected")} className={CONTROL} aria-pressed={review?.decision === "rejected"}>Excluir</button>
                      <button type="button" onClick={() => decide(region.regionId, "undetermined")} className={CONTROL} aria-pressed={review?.decision === "undetermined"}>Sin determinar</button>
                    </div>
                    <button type="button" onClick={() => {
                      setSelected(region.regionId);
                      setRoiEditing(false);
                      setEditing((current) => current === region.regionId ? null : region.regionId);
                    }} className={CONTROL}>
                      {editing === region.regionId ? "Terminar edición" : "Editar máscara"}
                    </button>
                    {editing === region.regionId ? (
                      <button type="button" onClick={() => setBrushMode((mode) => mode === "add" ? "erase" : "add")} className={CONTROL}>
                        Pincel: {brushMode === "add" ? "añadir" : "borrar"}
                      </button>
                    ) : null}
                  </div>
                  <details className="mt-4 border-t border-slate-200 pt-3">
                    <summary className="cursor-pointer text-sm font-medium">Detalles de esta sugerencia</summary>
                    <p className="mt-2 text-xs text-slate-700">
                      {top ? `${top.labelEs} (puntuación cruda ${top.rawScore?.toFixed(3) ?? "—"})` : "Etiqueta pendiente"}.
                      Las puntuaciones no son probabilidades ni porcentajes de certeza.
                    </p>
                    <p className="mt-2 text-xs text-slate-700">
                      Puntuación SAM {region.samScore.toFixed(3)} ({region.regionId.startsWith("sam-trunk-") ? "candidato original antes de recortarlo al tronco; " : ""}calidad de máscara, no evidencia de liquen) · {region.maskAreaPixels} px de máscara.
                      La etiqueta no demuestra que todos los píxeles sean liquen.
                    </p>
                  </details>
                </li>
              );
            }) : null}
          </ul>
        </div>
      </div>

      <details className={`${outlineEditing ? "hidden" : ""} mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4`}>
        <summary className="cursor-pointer font-semibold">Área de tronco y regiones que faltan</summary>
        <p className="mt-3 text-slate-700">Delimita el tronco (ROI), añade regiones omitidas y comprueba toda el área antes de interpretar la cobertura.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!trunkOutline ? <button type="button" onClick={() => { setRoiEditing((current) => !current); setEditing(null); setBrushMode("add"); }} className={CONTROL}>
            {roiEditing ? "Terminar ROI de tronco" : "Delimitar ROI de tronco"}
          </button> : null}
          {roiEditing ? (
            <button type="button" onClick={() => setBrushMode((mode) => mode === "add" ? "erase" : "add")} className={CONTROL}>
              Pincel ROI: {brushMode === "add" ? "añadir" : "borrar"}
            </button>
          ) : null}
          <button type="button" onClick={addOmittedRegion} className={CONTROL}>Añadir máscara omitida</button>
          {!trunkOutline ? <>
            <button type="button" onClick={clearRoi} disabled={!roiRle} className={CONTROL}>Borrar ROI</button>
            <button type="button" onClick={setFullViewRoi} className={CONTROL} title="Atajo exploratorio: toda la fotografía no es el tronco.">Usar vista completa como ROI (exploratorio)</button>
          </> : <span className="text-sky-900">Área de cobertura: contorno confirmado del tronco.</span>}
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={completeness} className="mt-1 h-4 w-4 accent-emerald-800" onChange={(event) => {
            setCompleteness(event.target.checked);
            persist({ regions, suggestions, reviews, backend, completenessReviewed: event.target.checked, roiRle });
          }} />
          Revisé todo el ROI y añadí o amplié las máscaras omitidas.
        </label>
      </details>

      <p className="mt-4 text-sm text-slate-700">
        Pendientes {counts.pending} · Aceptadas {counts.accepted} (liquen {counts.acceptedLichen}) ·
        Excluidas {counts.rejected} · Sin determinar {counts.undetermined} · Máscaras editadas {counts.maskEdited}.
      </p>
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p>{coverage === null
          ? "Cobertura revisada: confirma el ROI de tronco para calcularla."
          : coverage.available
            ? `Cobertura revisada exploratoria: ${coverage.coveragePercent?.toFixed(2)} % (${coverage.intersectionPixels} px de unión aceptada sobre ${coverage.roiPixels} px de ROI). ${coverage.notice}`
            : `Cobertura revisada no disponible (${coverage.unavailableReason}). ${coverage.notice}`}</p>
        {!finalisation.canFinalize && finalisation.reason ? <p className="mt-1">{finalisation.reason}</p> : null}
        <p className="mt-1">Esta revisión no sustituye la calibración física ni permite estimar por sí sola la calidad del aire.</p>
      </div>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer">Información del modelo</summary>
        <p className="mt-2">Backend {backend ?? "no ejecutado"}{cached ? " (reutilizado de caché)" : ""} · versión de sugerencias {SUGGESTION_VERSION}.</p>
      </details>
    </section>
  );
}
