// Owner-scoped registry of MobileSAM sessions.
//
// A session id returned by the vision service is a bearer of segmentation
// capability: whoever knows it can segment that photograph. The pilot therefore
// never lets the browser address the shared `/api/vision/segment` route with a
// session it did not obtain through the assisted journey. Every session created
// here is recorded with its owner, image and view, and every later operation is
// checked against that record.

export interface SamSessionRecord {
  sessionId: string;
  ownerId: string;
  imageId: string;
  treeSampleId: string;
  direction: string;
  // Dimensions of the ANALYSIS PROXY the session was prepared from.
  width: number;
  height: number;
  expiresAt: number;
}

const MAX_SESSIONS = 64;
export const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new Map<string, SamSessionRecord>();

function prune(now: number): void {
  for (const [key, record] of sessions) {
    if (record.expiresAt <= now) sessions.delete(key);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next();
    if (oldest.done) break;
    sessions.delete(oldest.value);
  }
}

export function registerSamSession(
  record: Omit<SamSessionRecord, "expiresAt">,
  now: number = Date.now(),
): SamSessionRecord {
  prune(now);
  const stored: SamSessionRecord = { ...record, expiresAt: now + SESSION_TTL_MS };
  sessions.set(record.sessionId, stored);
  return stored;
}

// Returns the record only when the session exists, has not expired and belongs
// to the caller. A session of another owner is indistinguishable from one that
// never existed.
export function resolveSamSession(
  sessionId: string,
  ownerId: string,
  now: number = Date.now(),
): SamSessionRecord | null {
  prune(now);
  const record = sessions.get(sessionId);
  if (!record) return null;
  if (record.ownerId !== ownerId) return null;
  if (record.expiresAt <= now) {
    sessions.delete(sessionId);
    return null;
  }
  return record;
}

export function forgetSamSession(sessionId: string, ownerId: string): boolean {
  const record = sessions.get(sessionId);
  if (!record || record.ownerId !== ownerId) return false;
  sessions.delete(sessionId);
  return true;
}

export function clearSamSessions(): void {
  sessions.clear();
}
