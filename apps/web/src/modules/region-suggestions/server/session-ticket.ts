// Stateless authorisation of a MobileSAM session: a short signed ticket.
//
// The pilot used to record every prepared session in a module-level Map and let
// `segment`/`release` look it up there. On Vercel that is not authorisation, it
// is luck: each invocation may run in a different instance and no affinity
// between `prepare` and `segment` can be required
// (https://vercel.com/docs/functions). The reproduction is in
// `routes.test.ts`: the same user, session and points answered 200 in the
// process that prepared and 404 in a fresh one, without a single upstream call.
//
// So the authorisation travels with the request instead of living in a local
// Map. The ticket is a signed statement by the server about what it verified
// when it prepared the session:
//
//   * WHO prepared it (owner id),
//   * WHICH MobileSAM session it is,
//   * WHICH photograph, tree sample and view it was prepared from,
//   * the dimensions of the analysis proxy the masks live in,
//   * and WHEN it stops being valid.
//
// It is signed with the server-only `VISION_SERVICE_TOKEN` (already used to sign
// analysis proxy manifests), never leaves the server unsigned, carries no URL,
// no path and no credential, and is useless to anybody else: the owner is
// checked against the session of the caller on every use. It replaces the local
// Map; it does NOT replace the ownership check, and the image-view-tree
// association is verified again on every use.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_TICKET_VERSION = 1;
export const SESSION_TICKET_TTL_MS = 15 * 60 * 1000;
const MAX_TICKET_BYTES = 2048;

export interface SessionTicketClaims {
  version: number;
  sessionId: string;
  ownerId: string;
  imageId: string;
  treeSampleId: string;
  direction: string;
  // Dimensions of the ANALYSIS PROXY the session was prepared from, so a later
  // segmentation cannot be reinterpreted in another coordinate space.
  width: number;
  height: number;
  expiresAt: number;
}

export type TicketFailure =
  | "not_configured"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_owner";

function signingSecret(): string {
  const secret = process.env.VISION_SERVICE_TOKEN;
  // The same requirement the analysis proxy manifests already have: without a
  // server-side secret nothing is signed and nothing is accepted.
  if (!secret || secret.length < 32) throw new Error("ticket_signing_not_configured");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("hex");
}

export function issueSessionTicket(
  claims: Omit<SessionTicketClaims, "version" | "expiresAt">,
  now: number = Date.now(),
  ttlMs: number = SESSION_TICKET_TTL_MS,
): string {
  const full: SessionTicketClaims = {
    ...claims,
    version: SESSION_TICKET_VERSION,
    expiresAt: now + ttlMs,
  };
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionTicket(
  ticket: unknown,
  ownerId: string,
  now: number = Date.now(),
): { claims: SessionTicketClaims } | { failure: TicketFailure } {
  if (typeof ticket !== "string" || ticket.length === 0 || ticket.length > MAX_TICKET_BYTES) {
    return { failure: "malformed" };
  }
  const separator = ticket.lastIndexOf(".");
  if (separator <= 0) return { failure: "malformed" };
  const payload = ticket.slice(0, separator);
  const signature = ticket.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/.test(signature)) return { failure: "malformed" };

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(payload), "hex");
  } catch {
    return { failure: "not_configured" };
  }
  // Constant-time comparison: a forged ticket must not be distinguishable by
  // how long it takes to reject it.
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    return { failure: "bad_signature" };
  }

  let claims: SessionTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { failure: "malformed" };
  }
  if (
    !claims
    || typeof claims !== "object"
    || claims.version !== SESSION_TICKET_VERSION
    || typeof claims.sessionId !== "string"
    || typeof claims.ownerId !== "string"
    || typeof claims.imageId !== "string"
    || typeof claims.treeSampleId !== "string"
    || typeof claims.direction !== "string"
    || !Number.isSafeInteger(claims.width)
    || !Number.isSafeInteger(claims.height)
    || claims.width <= 0
    || claims.height <= 0
    || !Number.isSafeInteger(claims.expiresAt)
  ) {
    return { failure: "malformed" };
  }
  if (claims.expiresAt <= now) return { failure: "expired" };
  // The owner is the session of the CALLER, never a value taken from the
  // ticket: a valid ticket of somebody else is as useless as a forged one.
  if (claims.ownerId !== ownerId) return { failure: "wrong_owner" };
  return { claims };
}
