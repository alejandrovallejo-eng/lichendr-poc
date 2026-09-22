// MobileSAM sessions prepared from the PRIVATE ANALYSIS PROXY.
//
// The original photograph is never sent through Vercel to the segmentation
// service again. Two reasons, both real:
//
// * the vision service rejects an image whose decoded size exceeds
//   `MAX_DECODED_PIXELS` (20 MP) BEFORE reducing it — a 5712x4284 photograph
//   (24.47 MP) is answered with "Decoded image is too large". That limit is not
//   raised here;
// * the deterministic 2048 px JPEG proxy is already generated, verified and
//   stored privately, and the assisted pipeline already works in proxy pixels.
//
// So the browser sends only a small image REFERENCE; the server authorises it,
// reads the proxy through a short-lived signed URL and forwards those bytes to
// the segmentation service. The resulting session is bound to its owner.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeViewContext,
  downloadProxyBytes,
  isContextFailure,
  type ContextFailure,
  type ViewReference,
} from "./context";
import { runSerially } from "./serial";
import {
  issueSessionTicket,
  verifySessionTicket,
  type SessionTicketClaims,
} from "./session-ticket";

export interface SamServiceDeps {
  supabase: SupabaseClient;
  serviceUrl: string;
  authHeaders: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface PreparedSamSession {
  sessionId: string;
  // Signed authorisation of this session. It replaces the module-level Map that
  // could not survive a different serverless instance; it does NOT replace the
  // ownership check, which is applied to it on every use.
  ticket: string;
  width: number;
  height: number;
}

export interface SamPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export async function prepareSamSessionFromProxy(
  deps: SamServiceDeps,
  ownerId: string,
  reference: ViewReference,
): Promise<PreparedSamSession | ContextFailure> {
  // Authorisation and readiness FIRST: not a single byte reaches MobileSAM
  // before the owner, the image-view-tree association and the four
  // originals/proxies of the series have been verified.
  const context = await authorizeViewContext(deps.supabase, ownerId, reference);
  if (isContextFailure(context)) return context;

  const fetchImpl = deps.fetchImpl ?? fetch;
  // The whole assisted journey shares one serial coordinator, so four panels
  // cannot turn into four parallel preparations.
  return runSerially(async () => {
    let proxyBytes: Buffer;
    try {
      proxyBytes = await downloadProxyBytes(
        deps.supabase,
        context.proxy.proxyPath,
        context.proxy.proxySizeBytes,
        fetchImpl,
      );
    } catch {
      return {
        error: "No se pudo leer la versión de análisis de la fotografía.",
        status: 422,
      };
    }

    const body = new FormData();
    body.append(
      "image",
      new Blob([new Uint8Array(proxyBytes)], { type: "image/jpeg" }),
      `${reference.imageId}.jpg`,
    );

    let payload: Record<string, unknown>;
    let status: number;
    try {
      const response = await fetchImpl(`${deps.serviceUrl.replace(/\/$/, "")}/prepare`, {
        method: "POST",
        headers: { ...deps.authHeaders },
        body,
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      status = response.status;
      payload = ((await response.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return {
        error:
          "El servicio de segmentación no está disponible. Tus fotografías y revisiones se conservan.",
        status: 503,
      };
    }
    if (status < 200 || status >= 300 || typeof payload.sessionId !== "string") {
      // Upstream text is never forwarded verbatim: it could carry a path.
      return { error: "MobileSAM no pudo preparar esta vista.", status: 502 };
    }
    const width = Number(payload.width);
    const height = Number(payload.height);
    if (
      !Number.isSafeInteger(width)
      || !Number.isSafeInteger(height)
      || width <= 0
      || height <= 0
    ) {
      return { error: "MobileSAM devolvió dimensiones inválidas.", status: 502 };
    }
    if (!SESSION_ID.test(payload.sessionId)) {
      return { error: "MobileSAM devolvió una sesión inválida.", status: 502 };
    }

    const ticket = issueSessionTicket({
      sessionId: payload.sessionId,
      ownerId,
      imageId: reference.imageId,
      treeSampleId: reference.treeSampleId,
      direction: reference.direction,
      width,
      height,
    });
    return { sessionId: payload.sessionId, ticket, width, height };
  });
}

export interface SegmentationCandidates {
  candidates: unknown[];
  recommendedIndex: number;
  session: SessionTicketClaims;
}

// Authorises a ticket for a given owner and, when it is valid, verifies AGAIN
// that the photograph it names is still that view of that tree sample. The
// ticket says what the server checked when it prepared the session; it is not
// taken as a substitute for the current state of the database.
async function authorizeTicket(
  deps: SamServiceDeps,
  ownerId: string,
  sessionId: string,
  ticket: unknown,
): Promise<SessionTicketClaims | ContextFailure> {
  const verified = verifySessionTicket(ticket, ownerId);
  if ("failure" in verified) {
    if (verified.failure === "not_configured") {
      return {
        error: "La asistencia no está configurada para firmar sesiones en este entorno.",
        status: 503,
      };
    }
    // Forged, tampered, expired and foreign tickets are indistinguishable from
    // a session that never existed.
    return { error: "La sesión de segmentación no existe o ha caducado.", status: 404 };
  }
  if (verified.claims.sessionId !== sessionId) {
    return { error: "La sesión de segmentación no existe o ha caducado.", status: 404 };
  }
  const { data: view, error } = await deps.supabase
    .from("capture_views")
    .select("id, direction, image_id, capture_series_id, capture_series!inner(id, tree_sample_id)")
    .eq("image_id", verified.claims.imageId)
    .eq("direction", verified.claims.direction)
    .eq("active", true)
    .maybeSingle();
  const series = (view as { capture_series?: { tree_sample_id?: string } } | null)?.capture_series;
  if (error || !view || series?.tree_sample_id !== verified.claims.treeSampleId) {
    return { error: "Esa fotografía ya no corresponde a esta vista de este árbol.", status: 404 };
  }
  return verified.claims;
}

export async function segmentWithOwnedSession(
  deps: SamServiceDeps,
  ownerId: string,
  sessionId: string,
  ticket: unknown,
  points: readonly SamPoint[],
): Promise<SegmentationCandidates | ContextFailure> {
  const session = await authorizeTicket(deps, ownerId, sessionId, ticket);
  if ("error" in session) return session;
  const fetchImpl = deps.fetchImpl ?? fetch;
  return runSerially(async () => {
    let payload: Record<string, unknown>;
    let status: number;
    try {
      const response = await fetchImpl(`${deps.serviceUrl.replace(/\/$/, "")}/segment`, {
        method: "POST",
        headers: { "content-type": "application/json", ...deps.authHeaders },
        body: JSON.stringify({ sessionId, points }),
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      status = response.status;
      payload = ((await response.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return { error: "El servicio de segmentación no está disponible.", status: 503 };
    }
    if (status < 200 || status >= 300 || !Array.isArray(payload.candidates)) {
      return { error: "MobileSAM no pudo proponer regiones en esta vista.", status: 502 };
    }
    const recommendedIndex = Number(payload.recommendedIndex);
    return {
      candidates: payload.candidates,
      recommendedIndex: Number.isSafeInteger(recommendedIndex) ? recommendedIndex : 0,
      session,
    };
  });
}

// Releasing a session is asking the vision service to forget it, which is the
// only place where the session really exists. There is no local state to clear,
// so a release works from any instance.
export async function releaseOwnedSession(
  deps: SamServiceDeps,
  ownerId: string,
  sessionId: string,
  ticket: unknown,
): Promise<{ released: boolean } | ContextFailure> {
  const session = await authorizeTicket(deps, ownerId, sessionId, ticket);
  if ("error" in session) return session;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    await fetchImpl(
      `${deps.serviceUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: { ...deps.authHeaders },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
  } catch {
    // The service expires its own sessions; a failure here is not a review error.
  }
  return { released: true };
}
