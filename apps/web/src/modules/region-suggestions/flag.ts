// Feature flag for the BioCLIP + MobileSAM review pilot.
//
// OFF by default, everywhere. When it is off the UI renders exactly what it
// rendered before, the client never calls the suggestion route, and the route
// itself refuses the request, so a misconfigured browser cannot reach BioCLIP.

export const REGION_SUGGESTIONS_FLAG = "NEXT_PUBLIC_BIOCLIP_SUGGESTIONS";

export function regionSuggestionsEnabled(
  environment?: Record<string, string | undefined>,
): boolean {
  // Next.js only bundles literal NEXT_PUBLIC accesses in browser code.
  return environment ? environment[REGION_SUGGESTIONS_FLAG] === "1"
    : process.env.NEXT_PUBLIC_BIOCLIP_SUGGESTIONS === "1";
}

// The worker must also be configured server-side. Both conditions are required:
// a flag on its own never sends a request anywhere.
export function regionSuggestionsWorkerConfigured(
  environment: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const url = environment.BIOCLIP_WORKER_URL ?? "";
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
