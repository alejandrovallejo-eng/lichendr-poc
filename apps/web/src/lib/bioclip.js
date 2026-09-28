"use strict";
/**
 * Server-side configuration of the BioCLIP worker.
 *
 * SECURITY: worker credentials never reach the browser or response/log output.
 * The existing private Cloud Run service is shared by this project's explicitly
 * authorized Preview and Production environments. Its historical resource names
 * retain "preview"; neither public access nor a service-account key is needed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIOCLIP_PREPROCESS_MODE = exports.BIOCLIP_WORKER_TIMEOUT_MS = exports.BIOCLIP_WORKER_URL = void 0;
exports.bioclipAuthHeaders = bioclipAuthHeaders;
exports.createBioclipFetch = createBioclipFetch;
exports.BIOCLIP_WORKER_URL = process.env.BIOCLIP_WORKER_URL ?? "";
exports.BIOCLIP_WORKER_TIMEOUT_MS = 120_000;
function bioclipAuthHeaders() {
    const token = process.env.BIOCLIP_WORKER_TOKEN;
    return token ? { Authorization: "Bearer " + token } : {};
}
/** Preprocessing pipeline requested from the worker. */
exports.BIOCLIP_PREPROCESS_MODE = process.env.BIOCLIP_PREPROCESS_MODE ?? "whole_crop_pad";
// Resource identifiers, not credentials. Google validates Vercel's signature,
// exact project ID and the explicitly authorized Preview/Production subjects.
const CLOUD_RUN_ORIGIN = "https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app";
const WIF_AUDIENCE = "//iam.googleapis.com/projects/838586175073/locations/global/workloadIdentityPools/lichendr-vercel-preview/providers/vercel";
const CALLER = "lichendr-vercel-preview@lichendr.iam.gserviceaccount.com";
/** A request-scoped fetch adapter: never sends Google credentials to Storage.
 * Authentication is lazy, after the existing handler's user/ownership/four-view
 * checks. No Google key file, build token, global token cache or dependency.
 */
function createBioclipFetch(request, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const enabled = options.enabled ?? process.env.BIOCLIP_GOOGLE_IAM === "1";
    if (!enabled)
        return fetchImpl;
    const environment = options.environment ?? process.env.VERCEL_ENV;
    const workerUrl = options.workerUrl ?? exports.BIOCLIP_WORKER_URL;
    let pendingToken;
    async function identityToken(signal) {
        const oidc = request.headers.get("x-vercel-oidc-token");
        if (!oidc)
            throw new Error("BioCLIP invocation identity unavailable");
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
        if (!exchange.ok)
            throw new Error("BioCLIP identity exchange failed");
        const data = await exchange.json();
        if (typeof data.access_token !== "string" || !data.access_token)
            throw new Error("BioCLIP identity exchange invalid");
        const identity = await fetchImpl("https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + CALLER + ":generateIdToken", {
            method: "POST", redirect: "error", cache: "no-store", signal,
            headers: { "content-type": "application/json", Authorization: "Bearer " + data.access_token },
            body: JSON.stringify({ audience: CLOUD_RUN_ORIGIN, includeEmail: true }),
        });
        if (!identity.ok)
            throw new Error("BioCLIP identity issuance failed");
        const result = await identity.json();
        if (typeof result.token !== "string" || !result.token)
            throw new Error("BioCLIP identity issuance invalid");
        return result.token;
    }
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const configured = new URL(workerUrl);
        if (url.origin !== configured.origin)
            return fetchImpl(input, init);
        if ((environment !== "preview" && environment !== "production") || configured.href.replace(/\/$/, "") !== CLOUD_RUN_ORIGIN)
            throw new Error("BioCLIP Google identity is restricted to the approved Preview and Production service");
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
