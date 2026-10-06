export interface AnalysisCapability { enabled: boolean; configured: boolean }
export interface AnalysisCapabilities {
  segmentation: AnalysisCapability;
  classification: AnalysisCapability;
}
function endpoint(value: string | undefined) {
  try { return ["http:", "https:"].includes(new URL(value || "").protocol); } catch { return false; }
}
/** Configuration only; model readiness is checked by the actual analysis routes. */
export function analysisCapabilities(env: Record<string, string | undefined> = process.env): AnalysisCapabilities {
  return {
    segmentation: { enabled: env.NEXT_PUBLIC_MOBILESAM_ASSISTANCE !== "0",
      configured: endpoint(env.VISION_SERVICE_URL) && (env.VISION_SERVICE_TOKEN?.length ?? 0) >= 32 },
    classification: { enabled: env.NEXT_PUBLIC_BIOCLIP_SUGGESTIONS === "1",
      configured: endpoint(env.BIOCLIP_WORKER_URL) && Boolean(env.BIOCLIP_WORKER_TOKEN) },
  };
}
export function capabilityAvailable(capability: AnalysisCapability) {
  return capability.enabled && capability.configured;
}
