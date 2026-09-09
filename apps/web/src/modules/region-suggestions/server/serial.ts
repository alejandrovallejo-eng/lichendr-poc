// One shared serial coordinator for the WHOLE assisted journey.
//
// The four panels of a series (N, E, S, O) all go through it: preparing a
// MobileSAM session, segmenting and asking BioCLIP are queued behind the same
// tail, so the browser can never turn four panels into four parallel workers.
// Previously only the suggestion route was serialised, which left the four
// `prepare` calls racing each other.

let tail: Promise<unknown> = Promise.resolve();

export function runSerially<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task);
  tail = result.catch(() => undefined);
  return result;
}

// Test seam: the coordinator is module state, so a test can start from a known
// point instead of inheriting the tail of a previous test.
export function resetSerialCoordinator(): void {
  tail = Promise.resolve();
}
