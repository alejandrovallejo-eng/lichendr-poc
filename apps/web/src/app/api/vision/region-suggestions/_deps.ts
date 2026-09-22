import { VISION_SERVICE_URL, visionAuthHeaders } from "@/lib/vision";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  regionSuggestionsEnabled,
  regionSuggestionsWorkerConfigured,
} from "@/modules/region-suggestions/flag";
import type { SamRouteDeps } from "@/modules/region-suggestions/server/sam-handlers";

// Shared wiring for the authorised MobileSAM routes.
export async function samRouteDeps(): Promise<SamRouteDeps> {
  return {
    supabase: await createSupabaseServerClient(),
    enabled: regionSuggestionsEnabled() && regionSuggestionsWorkerConfigured(),
    serviceUrl: VISION_SERVICE_URL,
    authHeaders: visionAuthHeaders(),
  };
}
