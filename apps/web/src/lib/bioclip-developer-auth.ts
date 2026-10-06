import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
export const BIOCLIP_CLOUD_RUN_ORIGIN = "https://lichendr-bioclip-preview-5ccbk3mcba-ue.a.run.app";

/** Use the signed-in developer's existing Cloud Run access from a local app.
 * No service account key, public worker or new IAM grant is needed.
 */
export function createDeveloperBioclipFetch(options: {
  workerUrl: string;
  fetchImpl?: typeof fetch;
  identityToken?: () => Promise<string>;
}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? fetch;
  let pendingToken: Promise<string> | undefined;
  const identityToken = options.identityToken ?? (async () => {
    const cli = process.env.BIOCLIP_GCLOUD_PATH || join(homedir(), ".local/share/lichendr/google-cloud-sdk/bin/gcloud");
    try {
      const { stdout } = await exec(cli, ["auth", "print-identity-token", "--quiet"], {
        timeout: 15_000, maxBuffer: 16_384,
        env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1", CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: "true" },
      });
      const token = stdout.trim();
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("invalid_identity");
      return token;
    } catch {
      throw new Error("BioCLIP requiere iniciar sesión en Google Cloud CLI con acceso al proyecto lichendr.");
    }
  });
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const configured = new URL(options.workerUrl);
    if (url.origin !== configured.origin) return fetchImpl(input, init);
    if (configured.href.replace(/\/$/, "") !== BIOCLIP_CLOUD_RUN_ORIGIN) {
      throw new Error("BioCLIP developer identity is restricted to the approved Cloud Run service");
    }
    if (url.pathname !== "/health" && url.pathname !== "/suggest-regions") {
      throw new Error("BioCLIP developer identity path not allowed");
    }
    pendingToken ??= identityToken().catch(error => { pendingToken = undefined; throw error; });
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // Keep the worker bearer separate from Google IAM, as in the Vercel path.
    headers.set("X-Serverless-Authorization", `Bearer ${await pendingToken}`);
    return fetchImpl(input, { ...init, headers, redirect: "error", cache: "no-store" });
  };
}
