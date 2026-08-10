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
