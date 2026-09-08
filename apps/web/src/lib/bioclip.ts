/**
 * Server-side configuration of the local BioCLIP worker.
 *
 * SECURITY: `BIOCLIP_WORKER_URL` and `BIOCLIP_WORKER_TOKEN` are read only on the
 * server. The token has no NEXT_PUBLIC_ prefix, never reaches the browser
 * bundle and is never echoed in a response, in a UI string or in a log line.
 *
 * The worker is expected to run on the reviewer's own machine
 * (http://127.0.0.1:8500 by default when configured). No tunnel is opened here
 * and no hosting is provisioned: where this worker will live is still an open
 * decision, documented in services/bioclip/README.md.
 */

export const BIOCLIP_WORKER_URL = process.env.BIOCLIP_WORKER_URL ?? "";
export const BIOCLIP_WORKER_TIMEOUT_MS = 120_000;

export function bioclipAuthHeaders(): Record<string, string> {
  const token = process.env.BIOCLIP_WORKER_TOKEN;
  return token ? { Authorization: "Bearer " + token } : {};
}

/** Preprocessing pipeline requested from the worker. */
export const BIOCLIP_PREPROCESS_MODE = process.env.BIOCLIP_PREPROCESS_MODE ?? "whole_crop_pad";
