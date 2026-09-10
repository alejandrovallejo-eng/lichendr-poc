// Real identity of the BioCLIP worker, resolved BEFORE any cache decision.
//
// A cache key is only meaningful if it names the model that produced the entry.
// The pilot used to read and write the cache under a provisional key whose
// encoder, backend and head were literally "pending"/null, so a batch computed
// with the zero-shot backend and a batch computed with a trained head collided,
// and connecting or changing a head did not invalidate anything.
//
// The worker reports its identity in `/health`. It is asked first; when it
// cannot be verified, reuse is DISABLED (nothing is read, nothing is written)
// rather than guessed.

export interface WorkerIdentity {
  encoderId: string;
  backend: string;
  headSha256: string | null;
  headError: string | null;
}

const HEALTH_TIMEOUT_MS = 10_000;

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 ? value : fallback;
}

export async function resolveWorkerIdentity(
  workerUrl: string,
  authHeaders: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkerIdentity | null> {
  try {
    const response = await fetchImpl(`${workerUrl.replace(/\/$/, "")}/health`, {
      headers: { ...authHeaders },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = ((await response.json()) ?? {}) as Record<string, unknown>;
    if (typeof body.encoderId !== "string" || typeof body.backend !== "string") return null;
    return {
      encoderId: safeText(body.encoderId, "desconocido"),
      backend: safeText(body.backend, "zeroshot"),
      headSha256: typeof body.headSha256 === "string" ? body.headSha256.slice(0, 64) : null,
      headError: typeof body.headError === "string" ? body.headError.slice(0, 300) : null,
    };
  } catch {
    return null;
  }
}

// The identity actually reported with the answer must match the identity the
// cache entry was stored under; otherwise the entry describes another model.
export function sameWorkerIdentity(a: WorkerIdentity, b: WorkerIdentity): boolean {
  return a.encoderId === b.encoderId && a.backend === b.backend && a.headSha256 === b.headSha256;
}
