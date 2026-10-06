import { VISION_SERVICE_URL, visionAuthHeaders } from "@/lib/vision";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analysisCapabilities, capabilityAvailable } from "@/lib/analysis-capabilities";
import type { SamRouteDeps } from "@/modules/region-suggestions/server/sam-handlers";

// Shared wiring for the authorised MobileSAM routes.
export async function samRouteDeps(): Promise<SamRouteDeps> {
  return {
    supabase: await createSupabaseServerClient(),
    enabled: capabilityAvailable(analysisCapabilities().segmentation),
    serviceUrl: VISION_SERVICE_URL,
    authHeaders: visionAuthHeaders(),
  };
}
