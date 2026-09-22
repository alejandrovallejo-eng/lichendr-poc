import type { FrameClassification, FrameDetectionDetails } from "./types";

const MARKER_LABELS: Record<number, string> = {
  0: "superior izquierdo",
  1: "superior derecho",
  2: "inferior izquierdo",
  3: "inferior derecho",
};

const CLASSIFICATION_LABELS: Record<FrameClassification, string> = {
  validated: "Automático validado",
  assisted: "Automático asistido",
  manual_assisted: "Manual asistido",
  manual_confirmed: "Manual confirmado · elegible para métricas validadas",
  manual_assisted_provisional: "Manual provisional · geometría estimada",
};

export function detectionMessage(detection: FrameDetectionDetails): string {
  if (!detection.missing_marker_ids.length) {
    return "Detectamos y validamos los cuatro marcadores.";
  }
  const missing = detection.missing_marker_ids
    .map((markerId) => MARKER_LABELS[markerId] ?? `ID ${markerId}`)
    .join(" y ");
  return `Detectamos ${detection.detected_marker_ids.length} de 4 marcadores: faltan ${missing}.`;
}

export function classificationLabel(classification: FrameClassification | null): string {
  return classification ? CLASSIFICATION_LABELS[classification] : "Sin clasificación final";
}

export function reprojectionLabel(error: number | null): string {
  return error === null ? "No disponible (confirmación manual)" : `${error.toFixed(2)} px`;
}

export function storedFrameClassification(source: string): FrameClassification {
  const classification = /mobile_sam_cielab:(manual_assisted_provisional|manual_confirmed|manual_assisted|assisted|validated)(?:;|$)/.exec(source)?.[1];
  return classification === "assisted"
    || classification === "manual_assisted"
    || classification === "manual_confirmed"
    || classification === "manual_assisted_provisional"
    ? classification
    : "validated";
}

export function hasProvisionalGeometry(sources: readonly string[]): boolean {
  return sources.some((source) => storedFrameClassification(source) === "manual_assisted_provisional");
}
