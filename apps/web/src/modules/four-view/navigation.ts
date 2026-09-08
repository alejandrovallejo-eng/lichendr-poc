export function nextFourViewDestination(seriesId: string, currentIndex: number): string {
  if (!seriesId || !Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex > 3) {
    throw new Error("La posición de la vista no es válida.");
  }
  return currentIndex === 3
    ? `/analysis?captureSeriesId=${encodeURIComponent(seriesId)}`
    : `/annotations?captureSeriesId=${encodeURIComponent(seriesId)}&view=${currentIndex + 1}&tool=ai`;
}

export function nextTreeDestination(): string {
  return "/images";
}

// "Siguiente árbol de esta jornada": go back to the tree list of the same
// jornada, keeping project, site and jornada intact. Only the tree changes.
export function jornadaTreesDestination(eventId: string): string {
  if (!eventId) throw new Error("La jornada no es válida.");
  return `/jornada/${encodeURIComponent(eventId)}`;
}

export function captureToAnnotationsDestination(seriesId: string): string {
  if (!seriesId) throw new Error("La serie de captura no es válida.");
  return `/annotations?captureSeriesId=${encodeURIComponent(seriesId)}&view=0&tool=ai`;
}

export function orderFourViewTargets<T extends {
  direction: "N" | "E" | "S" | "W";
  annotation_set_id: string | null;
}>(views: readonly T[]): T[] {
  const byDirection = new Map(views.map((view) => [view.direction, view]));
  return (["N", "E", "S", "W"] as const).flatMap((direction) => {
    const view = byDirection.get(direction);
    return view?.annotation_set_id ? [view] : [];
  });
}
