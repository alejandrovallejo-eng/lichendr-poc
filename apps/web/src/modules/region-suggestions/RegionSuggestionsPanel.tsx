"use client";

// Spanish review panel of the pilot: Buscando regiones → Sugiriendo etiquetas →
// Revisar. Nothing here counts anything: a suggestion is only a proposal and
// coverage is computed elsewhere, after the reviewer accepted regions and
// confirmed that the whole ROI was inspected.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type {
  PointPrompt,
  SegmentationCandidate,
  WorkerMessage,
  WorkerRequest,
} from "@/modules/vision-lab/types";
import {
  SuggestionRequestError,
  gridPromptPoints,
  regionsFromCandidates,
  requestRegionSuggestions,
} from "./client";
import {
  applyDecision,
  initialReview,
  mergeReviews,
  nextPhase,
  phaseNotice,
  restoreState,
  resultBelongsToContext,
  reviewCounts,
} from "./review";
import {
  SUGGESTION_LABELS,
  SUGGESTION_LABEL_ES,
  type ProposedRegion,
  type RegionReview,
  type RegionSuggestion,
  type SuggestionLabel,
  type SuggestionPhase,
} from "./types";
import { loadSavedBatch, saveBatch } from "./storage";

const WORKER_URL = new URL("@/modules/vision-lab/sam.worker.ts", import.meta.url);
const MODEL_SESSION = "region-suggestions-model";
const INFERENCE_SIDE = 1024;

export interface RegionSuggestionsPanelProps {
  treeSampleId: string;
  direction: string;
  imageId: string;
  file: File;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(1);

  // The owner comes from the session and, once known, the saved batch is
  // restored: reload shows photographs, suggestions and reviews again without
  // re-running any model.
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      setOwnerId(data.user.id);
      const saved = loadSavedBatch(data.user.id, imageId);
      if (!saved) return;
      const restored = restoreState(saved);
      setPhase(restored.phase);
      setRegions(restored.regions);
      setSuggestions(restored.suggestions);
      setReviews(restored.reviews);
      setBackend(saved.backend ?? null);
      setCompleteness(saved.completenessReviewed ?? false);
    });
    return () => {
      active = false;
    };
  }, [imageId]);

  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const persist = useCallback(
    (
      nextRegions: ProposedRegion[],
      nextSuggestions: RegionSuggestion[],
      nextReviews: RegionReview[],
      nextBackend: string | null,
      nextCompleteness: boolean,
    ) => {
      if (!ownerId) return;
      saveBatch(ownerId, imageId, {
        regions: nextRegions,
        suggestions: nextSuggestions,
        reviews: nextReviews,
        backend: nextBackend,
        completenessReviewed: nextCompleteness,
      });
    },
    [ownerId, imageId],
  );

  const proposeRegions = useCallback(async (): Promise<SegmentationCandidate[]> => {
    const worker = workerRef.current ?? new Worker(WORKER_URL, { type: "module" });
    workerRef.current = worker;
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();

    const send = (request: WorkerRequest, expect: WorkerMessage["type"]) =>
      new Promise<WorkerMessage>((resolve, reject) => {
        const onMessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.requestId !== request.requestId) return;
          if (message.type === expect) {
            worker.removeEventListener("message", onMessage);
            resolve(message);
          } else if (message.type === "error") {
            worker.removeEventListener("message", onMessage);
            reject(new Error(message.message));
          }
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(request);
      });

    await send(
      {
        type: "load",
        sessionId: MODEL_SESSION,
        requestId: requestIdRef.current++,
        backendPreference: "auto",
      },
      "ready",
    );
    const image = {
      imageKey: `${imageId}:${file.size}`,
      blob: file,
      mimeType: file.type || "image/jpeg",
      width,
      height,
      inferenceWidth: INFERENCE_SIDE,
      inferenceHeight: INFERENCE_SIDE,
    };
    await send(
      { type: "prepare-image", sessionId: imageId, requestId: requestIdRef.current++, image },
      "image-ready",
    );

    const candidates: SegmentationCandidate[] = [];
    for (const point of gridPromptPoints()) {
      const prompt: PointPrompt = {
        x: Math.round(point.x * width),
        y: Math.round(point.y * height),
        label: 1,
      };
      const message = await send(
        {
          type: "segment",
          sessionId: imageId,
          requestId: requestIdRef.current++,
          image,
          points: [prompt],
        },
        "mask-ready",
      );
      if (message.type !== "mask-ready") continue;
      const best = message.masks[0];
      if (best) candidates.push(best);
    }
    return candidates;
  }, [file, imageId]);

  const run = useCallback(async () => {
    const requestToken = crypto.randomUUID().replace(/-/g, "");
    const expected = {
      ownerId,
      treeSampleId,
      direction,
      imageId,
      requestToken,
      suggestionVersion: "1",
    };
    setFailure(null);
    setPhase((current) => nextPhase(current, { type: "start" }));
    let proposed: ProposedRegion[] = [];
    try {
      const candidates = await proposeRegions();
      proposed = regionsFromCandidates(candidates, {
        orientation: 1,
        proxyScale: 1,
        rectified: false,
        canonicalWidth: 0,
        canonicalHeight: 0,
        preprocessMode: "whole_crop_pad",
      });
    } catch (error) {
      setFailure(
        error instanceof Error
          ? `No se pudieron proponer regiones (${error.message}).`
          : "No se pudieron proponer regiones.",
      );
      setPhase((current) => nextPhase(current, { type: "worker_failed" }));
      return;
    }
    setRegions(proposed);
    setReviews((current) => {
      const known = new Map(current.map((review) => [review.regionId, review]));
      return proposed.map((region) => known.get(region.regionId) ?? initialReview(region.regionId));
    });
    setPhase((current) => nextPhase(current, { type: "regions_found", count: proposed.length }));
    if (proposed.length === 0) return;

    try {
      const response = await requestRegionSuggestions(
        { imageId, treeSampleId, direction, requestToken },
        proposed,
      );
      // Context guard after the await: a late answer must never be applied to
      // another tree, another view or another request.
      const received = {
        ownerId: response.provenance.ownerId,
        treeSampleId: response.provenance.treeSampleId,
        direction: response.provenance.direction,
        imageId: response.provenance.imageId,
        requestToken: response.context.requestToken,
        suggestionVersion: response.provenance.suggestionVersion,
      };
      if (!resultBelongsToContext(expected, received)) {
        setFailure("La respuesta recibida no corresponde a esta vista y se descartó.");
        setPhase((current) => nextPhase(current, { type: "worker_failed" }));
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
      setSuggestions(incoming);
      setBackend(response.backend);
      setNotice(response.notice);
      setReviews((current) => {
        const merged = mergeReviews(current, incoming);
        persist(proposed, incoming, merged, response.backend, completeness);
        return merged;
      });
      setPhase((current) => nextPhase(current, { type: "labels_ready" }));
    } catch (error) {
      setFailure(
        error instanceof SuggestionRequestError
          ? error.message
          : "No se pudieron obtener sugerencias de etiqueta.",
      );
      setPhase((current) => nextPhase(current, { type: "worker_failed" }));
    }
  }, [
    completeness,
    direction,
    imageId,
    ownerId,
    persist,
    proposeRegions,
    treeSampleId,
  ]);

  const decide = useCallback(
    (regionId: string, decision: RegionReview["decision"], label?: SuggestionLabel | null) => {
      setReviews((current) => {
        try {
          const next = applyDecision(current, {
            regionId,
            decision,
            label: label ?? null,
            reviewedBy: ownerId,
            reviewedAt: new Date().toISOString(),
          });
          persist(regions, suggestions, next, backend, completeness);
          return next;
        } catch (error) {
          setFailure(error instanceof Error ? error.message : "No se pudo aplicar la revisión.");
          return current;
        }
      });
    },
    [backend, completeness, ownerId, persist, regions, suggestions],
  );

  const markMaskEdited = useCallback(
    (regionId: string) => {
      setReviews((current) => {
        const index = current.findIndex((review) => review.regionId === regionId);
        if (index < 0) return current;
        const next = current.slice();
        next[index] = { ...next[index], maskEdited: true };
        persist(regions, suggestions, next, backend, completeness);
        return next;
      });
    },
    [backend, completeness, persist, regions, suggestions],
  );

  const counts = reviewCounts(reviews);
  const info = phaseNotice(phase, regions.length, failure ?? undefined);
  const busy = phase === "searching_regions" || phase === "suggesting_labels";

  return (
    <section className="rounded-lg border border-dashed border-emerald-700/50 bg-slate-900/40 p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-emerald-200">Asistencia de regiones (piloto)</h4>
          <p className="text-xs text-slate-300">
            {info.title}: {info.detail}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded border border-emerald-500 px-3 py-1 text-emerald-200 disabled:opacity-50"
        >
          {busy ? "Procesando…" : "Proponer regiones"}
        </button>
      </header>

      {notice ? <p className="mt-2 text-xs text-amber-200">{notice}</p> : null}
      {failure ? (
        <p className="mt-2 text-xs text-amber-300">
          {failure} Tus fotografías y revisiones se conservan; puedes anotar manualmente.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={`Vista ${direction}`} className="w-full rounded" />
          <RegionOverlay regions={regions} reviews={reviews} selected={selected} />
        </div>

        <ul className="space-y-2">
          {regions.length === 0 ? (
            <li className="text-xs text-slate-300">
              Sin regiones propuestas. Que no haya propuestas no demuestra ausencia de líquenes:
              revisa la vista completa y añade máscaras omitidas antes de finalizar.
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
                  {top ? `${top.labelEs} (puntuación cruda ${top.rawScore?.toFixed(3) ?? "—"})` : "pendiente"}
                  {" · "}
                  Estado: {review?.decision === "pending" ? "pendiente de revisión" : review?.decision}
                </p>
                <p className="text-[11px] text-slate-400">
                  Puntuación SAM {region.samScore.toFixed(3)} (calidad de máscara, no evidencia de
                  liquen). La etiqueta no demuestra que todos los píxeles sean liquen.
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
                    onClick={() => markMaskEdited(region.regionId)}
                    className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200"
                  >
                    Marcar máscara editada
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
        <input
          type="checkbox"
          checked={completeness}
          onChange={(event) => {
            setCompleteness(event.target.checked);
            persist(regions, suggestions, reviews, backend, event.target.checked);
          }}
        />
        Revisé todo el ROI y añadí las máscaras omitidas.
      </label>

      <p className="mt-2 text-[11px] text-slate-400">
        Pendientes {counts.pending} · Aceptadas {counts.accepted} (liquen {counts.acceptedLichen}) ·
        Excluidas {counts.rejected} · Sin determinar {counts.undetermined} · Backend{" "}
        {backend ?? "no ejecutado"}. Porcentaje exploratorio: sin calibración no equivale a cm², no
        indica calidad del aire y no permite comparar árboles científicamente.
      </p>
    </section>
  );
}

function RegionOverlay({
  regions,
  reviews,
  selected,
}: {
  regions: readonly ProposedRegion[];
  reviews: readonly RegionReview[];
  selected: string | null;
}) {
  const width = regions[0]?.maskWidth ?? 0;
  const height = regions[0]?.maskHeight ?? 0;
  if (width <= 0 || height <= 0) return null;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {regions.map((region) => {
        const review = reviews.find((item) => item.regionId === region.regionId);
        const colour =
          review?.decision === "accepted"
            ? "#34d399"
            : review?.decision === "rejected"
              ? "#f87171"
              : "#facc15";
        return (
          <rect
            key={region.regionId}
            x={region.box.x}
            y={region.box.y}
            width={region.box.width}
            height={region.box.height}
            fill="none"
            stroke={colour}
            strokeWidth={selected === region.regionId ? 6 : 3}
          />
        );
      })}
    </svg>
  );
}
