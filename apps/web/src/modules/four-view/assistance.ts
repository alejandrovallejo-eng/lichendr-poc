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
  return classification ? CLASSIFICATION_LABELS[classification] : "Pendiente de confirmación";
}

export function reprojectionLabel(error: number | null): string {
  return error === null ? "No disponible (confirmación manual)" : `${error.toFixed(2)} px`;
}
