// Route handlers for the authorised MobileSAM journey.
//
// These are separated from the Next.js route files so a test can drive the
// whole route (flag, authentication, ownership, series readiness, serial
// coordination, session authorisation) with injected dependencies.
//
// Authorisation of a prepared MobileSAM session travels in a short SIGNED
// TICKET (`session-ticket.ts`), not in a module-level Map: on Vercel there is no
// affinity between the instance that prepares and the instance that segments.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  prepareSamSessionFromProxy,
  releaseOwnedSession,
  segmentWithOwnedSession,
  type SamPoint,
  type SamServiceDeps,
} from "./sam-sessions";
import { DIRECTIONS } from "./context";

export interface SamRouteDeps extends SamServiceDeps {
  supabase: SupabaseClient;
  enabled: boolean;
}

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_REFERENCE_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_POINTS = 32;

const DISABLED = {
  status: 503,
  body: {
    error: "La asistencia de regiones está desactivada en este entorno. Puedes anotar manualmente.",
  },
} as const;

async function readSmallJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
    !== "application/json"
  ) {
    throw new Error("unsupported_media_type");
  }
  const text = await request.text();
  // The real bytes are counted, not the declared Content-Length.
  if (Buffer.byteLength(text, "utf8") > MAX_REFERENCE_BYTES) throw new Error("too_large");
  return JSON.parse(text);
}

async function requireOwner(deps: SamRouteDeps): Promise<string | HandlerResult> {
  const { data, error } = await deps.supabase.auth.getUser();
  if (error || !data?.user) {
    return { status: 401, body: { error: "Debes iniciar sesión para usar la asistencia." } };
  }
  return data.user.id;
}

export async function handleSamPrepare(
  deps: SamRouteDeps,
  request: Request,
): Promise<HandlerResult> {
  // Flag OFF means not a single call reaches MobileSAM, even if the route is
  // addressed directly.
  if (!deps.enabled) return { ...DISABLED, body: { ...DISABLED.body } };
  const owner = await requireOwner(deps);
  if (typeof owner !== "string") return owner;

  let raw: unknown;
  try {
    raw = await readSmallJson(request);
  } catch (error) {
    const reason = (error as Error).message;
    return {
      status: reason === "too_large" ? 413 : reason === "unsupported_media_type" ? 415 : 400,
      body: { error: "La referencia enviada no es válida." },
    };
  }
  const reference = parseReference(raw);
  if ("error" in reference) return { status: 400, body: { error: reference.error } };

  const prepared = await prepareSamSessionFromProxy(deps, owner, reference);
  if ("error" in prepared) return { status: prepared.status, body: { error: prepared.error } };
  // Only the session and the PROXY dimensions travel back: no signed URL, no
  // storage path, no original.
  return {
    status: 200,
    body: {
      sessionId: prepared.sessionId,
      // Signed by the server, bound to this owner, session, photograph, view and
      // proxy dimensions, and short-lived. It carries no URL, path or credential.
      ticket: prepared.ticket,
      width: prepared.width,
      height: prepared.height,
      space: "analysis_proxy",
    },
  };
}

export async function handleSamSegment(
  deps: SamRouteDeps,
  request: Request,
): Promise<HandlerResult> {
  if (!deps.enabled) return { ...DISABLED, body: { ...DISABLED.body } };
  const owner = await requireOwner(deps);
  if (typeof owner !== "string") return owner;

  let raw: unknown;
  try {
    raw = await readSmallJson(request);
  } catch (error) {
    const reason = (error as Error).message;
    return {
      status: reason === "too_large" ? 413 : reason === "unsupported_media_type" ? 415 : 400,
      body: { error: "La solicitud enviada no es válida." },
    };
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  if (typeof input.sessionId !== "string" || !SESSION_ID.test(input.sessionId)) {
    return { status: 400, body: { error: "La sesión de segmentación no es válida." } };
  }
  const points = parsePoints(input.points);
  if ("error" in points) return { status: 400, body: { error: points.error } };

  const result = await segmentWithOwnedSession(
    deps,
    owner,
    input.sessionId,
    input.ticket,
    points.points,
  );
  if ("error" in result) return { status: result.status, body: { error: result.error } };
  return {
    status: 200,
    body: {
      candidates: result.candidates,
      recommendedIndex: result.recommendedIndex,
      space: "analysis_proxy",
      notice:
        "La puntuación de MobileSAM mide la calidad del recorte, no identifica liquen. "
        + "Cada máscara queda pendiente de tu revisión.",
    },
  };
}

export async function handleSamRelease(
  deps: SamRouteDeps,
  sessionId: string,
  ticket: unknown,
): Promise<HandlerResult> {
  if (!deps.enabled) return { ...DISABLED, body: { ...DISABLED.body } };
  const owner = await requireOwner(deps);
  if (typeof owner !== "string") return owner;
  if (!SESSION_ID.test(sessionId)) {
    return { status: 400, body: { error: "La sesión de segmentación no es válida." } };
  }
  const result = await releaseOwnedSession(deps, owner, sessionId, ticket);
  if ("error" in result) return { status: result.status, body: { error: result.error } };
  return { status: 200, body: { released: result.released } };
}

function parseReference(
  value: unknown,
): { imageId: string; treeSampleId: string; direction: string } | { error: string } {
  const input = (value ?? {}) as Record<string, unknown>;
  if (typeof input.imageId !== "string" || !UUID.test(input.imageId)) {
    return { error: "La referencia de imagen no es válida." };
  }
  if (typeof input.treeSampleId !== "string" || !UUID.test(input.treeSampleId)) {
    return { error: "La referencia del árbol no es válida." };
  }
  if (
    typeof input.direction !== "string"
    || !(DIRECTIONS as readonly string[]).includes(input.direction)
  ) {
    return { error: "La vista solicitada no es válida." };
  }
  return {
    imageId: input.imageId,
    treeSampleId: input.treeSampleId,
    direction: input.direction,
  };
}

function parsePoints(value: unknown): { points: SamPoint[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "Falta el punto indicado sobre la fotografía." };
  }
  if (value.length > MAX_POINTS) return { error: "Se enviaron demasiados puntos." };
  const points: SamPoint[] = [];
  for (const candidate of value) {
    const point = (candidate ?? {}) as Record<string, unknown>;
    if (
      typeof point.x !== "number"
      || typeof point.y !== "number"
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || point.x < 0
      || point.y < 0
      || (point.label !== 0 && point.label !== 1)
    ) {
      return { error: "Un punto indicado no es válido." };
    }
    points.push({ x: point.x, y: point.y, label: point.label });
  }
  return { points };
}
