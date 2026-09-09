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
  forgetSamSession,
  registerSamSession,
  resolveSamSession,
  type SamSessionRecord,
} from "./sessions";

export interface SamServiceDeps {
  supabase: SupabaseClient;
  serviceUrl: string;
  authHeaders: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface PreparedSamSession {
  sessionId: string;
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

    registerSamSession({
      sessionId: payload.sessionId,
      ownerId,
      imageId: reference.imageId,
      treeSampleId: reference.treeSampleId,
      direction: reference.direction,
      width,
      height,
    });
    return { sessionId: payload.sessionId, width, height };
  });
}

export interface SegmentationCandidates {
  candidates: unknown[];
  recommendedIndex: number;
  session: SamSessionRecord;
}

export async function segmentWithOwnedSession(
  deps: SamServiceDeps,
  ownerId: string,
  sessionId: string,
  points: readonly SamPoint[],
): Promise<SegmentationCandidates | ContextFailure> {
  const session = resolveSamSession(sessionId, ownerId);
  if (!session) {
    // A session belonging to somebody else is indistinguishable from one that
    // never existed.
    return { error: "La sesión de segmentación no existe o ha caducado.", status: 404 };
  }
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

export async function releaseOwnedSession(
  deps: SamServiceDeps,
  ownerId: string,
  sessionId: string,
): Promise<{ released: boolean }> {
  if (!forgetSamSession(sessionId, ownerId)) return { released: false };
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
