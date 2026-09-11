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

// Preview pilot only. These are resource identifiers, not credentials. Google
// validates Vercel's signature, project ID and Preview subject in the provider.
const CLOUD_RUN_ORIGIN = "https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app";
const WIF_AUDIENCE = "//iam.googleapis.com/projects/838586175073/locations/global/workloadIdentityPools/lichendr-vercel-preview/providers/vercel";
const CALLER = "lichendr-vercel-preview@lichendr.iam.gserviceaccount.com";

/** A request-scoped fetch adapter: never sends Google credentials to Storage.
 * Authentication is lazy, after the existing handler's user/ownership/four-view
 * checks. No Google key file, build token, global token cache or dependency.
 */
export function createBioclipFetch(
  request: Request,
  options: {
    enabled?: boolean;
    environment?: string;
    workerUrl?: string;
    fetchImpl?: typeof fetch;
  } = {},
): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  const enabled = options.enabled ?? process.env.BIOCLIP_GOOGLE_IAM === "1";
  if (!enabled) return fetchImpl;
  const environment = options.environment ?? process.env.VERCEL_ENV;
  const workerUrl = options.workerUrl ?? BIOCLIP_WORKER_URL;
  let pendingToken: Promise<string> | undefined;

  async function identityToken(signal: AbortSignal): Promise<string> {
    const oidc = request.headers.get("x-vercel-oidc-token");
    if (!oidc) throw new Error("BioCLIP Preview identity unavailable");
    // Only the fresh invocation token is used; never fall back to a build token.
    const exchange = await fetchImpl("https://sts.googleapis.com/v1/token", {
      method: "POST", redirect: "error", cache: "no-store", signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: WIF_AUDIENCE,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectToken: oidc,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      }),
    });
    if (!exchange.ok) throw new Error("BioCLIP Preview identity exchange failed");
    const data = await exchange.json() as { access_token?: unknown };
    if (typeof data.access_token !== "string" || !data.access_token)
      throw new Error("BioCLIP Preview identity exchange invalid");
    const identity = await fetchImpl(
      "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + CALLER + ":generateIdToken",
      {
        method: "POST", redirect: "error", cache: "no-store", signal,
        headers: { "content-type": "application/json", Authorization: "Bearer " + data.access_token },
        body: JSON.stringify({ audience: CLOUD_RUN_ORIGIN, includeEmail: true }),
      },
    );
    if (!identity.ok) throw new Error("BioCLIP Preview identity issuance failed");
    const result = await identity.json() as { token?: unknown };
    if (typeof result.token !== "string" || !result.token)
      throw new Error("BioCLIP Preview identity issuance invalid");
    return result.token;
  }

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const configured = new URL(workerUrl);
    if (url.origin !== configured.origin) return fetchImpl(input, init);
    if (environment !== "preview" || configured.href.replace(/\/$/, "") !== CLOUD_RUN_ORIGIN)
      throw new Error("BioCLIP Google identity is restricted to the Preview pilot");
    if (url.pathname !== "/health" && url.pathname !== "/suggest-regions")
      throw new Error("BioCLIP Google identity path not allowed");
    const incomingSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = incomingSignal
      ? AbortSignal.any([incomingSignal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
    pendingToken ??= identityToken(signal).catch((error) => {
      pendingToken = undefined;
      throw error;
    });
    const token = await pendingToken;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // Authorization remains the worker's bearer token. IAM uses its own header.
    headers.set("X-Serverless-Authorization", "Bearer " + token);
    return fetchImpl(input, { ...init, headers, redirect: "error", cache: "no-store" });
  };
}
