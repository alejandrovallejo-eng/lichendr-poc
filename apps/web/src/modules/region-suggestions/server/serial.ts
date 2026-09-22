// Serial coordinator for the assisted journey, PER SERVER INSTANCE.
//
// The four panels of a series (N, E, S, O) go through it: preparing a MobileSAM
// session, segmenting and asking BioCLIP are queued behind the same tail, so a
// browser that opens four panels at once does not fan out into four concurrent
// upstream calls from the same instance. Previously only the suggestion route
// was serialised, which left the four `prepare` calls racing each other.
//
// This is NOT a global mutual exclusion. `tail` is module state and Vercel may
// run each invocation in a different instance (https://vercel.com/docs/functions),
// so two instances can call the vision service at the same time. It is a
// politeness/burst control, not the admission guarantee.
//
// The effective limit lives where the model actually runs, in the single vision
// container: `_inference_gate = asyncio.Semaphore(1)` in services/vision/app.py
// admits one inference at a time and `MAX_SESSIONS = 3` with a 15 minute TTL in
// services/vision/model.py bounds the live MobileSAM sessions. Extra callers wait
// or are rejected there; no additional infrastructure is added here.

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
