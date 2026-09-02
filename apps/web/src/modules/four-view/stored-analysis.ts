import type { CornerPoint, VisionViewResult } from "./types";
import type { ManualMeasurementMode } from "./manual-flow";

export type AnalyzeViewAction = "detect" | "confirm_corners" | "analyze_confirmed";

export function storedAnalysisRequest(
  imageId: string,
  action: AnalyzeViewAction = "detect",
  corners?: readonly CornerPoint[],
  manualMode: ManualMeasurementMode = "manual_confirmed",
): { headers: { "Content-Type": string }; body: string } {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageId,
      action,
      ...(corners ? { corners } : {}),
      ...(action !== "detect" ? { manualMode } : {}),
    }),
  };
}

export async function readStoredAnalysisResponse(response: Response): Promise<VisionViewResult> {
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "La fotografía quedó guardada, pero el servicio devolvió una respuesta inválida. Puedes reintentar el análisis.",
    );
  }
  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
    const detail = error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : typeof error === "string" ? error : null;
    const message = response.status === 503
      ? "La fotografía quedó guardada. La IA no está disponible en este momento; puedes reintentar sin volver a tomarla."
      : response.status === 413
        ? "La referencia de la fotografía fue rechazada por tamaño. La imagen original sigue guardada y puedes reintentar."
        : detail ?? "No se pudo procesar la vista. La fotografía original sigue guardada para reintentar.";
    throw new Error(message);
  }
  return body as VisionViewResult;
}
