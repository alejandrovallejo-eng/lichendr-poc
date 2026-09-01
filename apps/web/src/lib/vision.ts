/**
 * Server-side shared utilities for the Vision Service proxy routes.
 *
 * SECURITY: VISION_SERVICE_TOKEN must NOT have a NEXT_PUBLIC_ prefix and
 * must never be exposed to the browser bundle.
 */

export const VISION_SERVICE_URL =
  process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";

/**
 * Returns an Authorization header object when VISION_SERVICE_TOKEN is set.
 * The token is read exclusively server-side and is never included in
 * any client-facing response.
 */
export function visionAuthHeaders(): Record<string, string> {
  const token = process.env.VISION_SERVICE_TOKEN;
  return token ? { Authorization: "Bearer " + token } : {};
}
