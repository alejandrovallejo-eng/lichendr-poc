"use strict";
/**
 * Server-side shared utilities for the Vision Service proxy routes.
 *
 * SECURITY: VISION_SERVICE_TOKEN must NOT have a NEXT_PUBLIC_ prefix and
 * must never be exposed to the browser bundle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISION_SERVICE_URL = void 0;
exports.visionAuthHeaders = visionAuthHeaders;
exports.VISION_SERVICE_URL = process.env.VISION_SERVICE_URL ?? "http://127.0.0.1:8000";
/**
 * Returns an Authorization header object when VISION_SERVICE_TOKEN is set.
 * The token is read exclusively server-side and is never included in
 * any client-facing response.
 */
function visionAuthHeaders() {
    const token = process.env.VISION_SERVICE_TOKEN;
    return token ? { Authorization: "Bearer " + token } : {};
}
