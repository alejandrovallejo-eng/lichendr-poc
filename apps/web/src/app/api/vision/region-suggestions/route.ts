import { NextRequest } from "next/server";
import {
  BIOCLIP_PREPROCESS_MODE,
  BIOCLIP_WORKER_TIMEOUT_MS,
  BIOCLIP_WORKER_URL,
  bioclipAuthHeaders,
} from "@/lib/bioclip";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  regionSuggestionsEnabled,
  regionSuggestionsWorkerConfigured,
} from "@/modules/region-suggestions/flag";
import { handleRegionSuggestions } from "@/modules/region-suggestions/server/suggest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return Response.json(
    { error: "Las sugerencias de regiones requieren POST con una referencia de imagen." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

// Thin adapter: the journey itself (authorisation, series readiness, serial
// coordination, crops, worker call and verified reuse) lives in the module, so
// it can be exercised end to end by route tests with injected dependencies.
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const result = await handleRegionSuggestions(
    {
      supabase,
      enabled: regionSuggestionsEnabled() && regionSuggestionsWorkerConfigured(),
      workerUrl: BIOCLIP_WORKER_URL,
      authHeaders: bioclipAuthHeaders(),
      preprocessMode: BIOCLIP_PREPROCESS_MODE,
      timeoutMs: BIOCLIP_WORKER_TIMEOUT_MS,
    },
    request,
  );
  return Response.json(result.body, { status: result.status });
}
