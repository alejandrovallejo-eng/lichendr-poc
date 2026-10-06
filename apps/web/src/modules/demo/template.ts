import { parseGuidedReview, type GuidedReview, type GuidedServices, type GuidedSession } from "../four-view/guided-flow";
import { DIRECTIONS, type Direction } from "../four-view/types";
import type { SuggestionResponse } from "../region-suggestions/client";

export const DEMO_NOTICE = "Demostración: la misma fotografía y su revisión se repiten en Norte, Este, Sur y Oeste. No son cuatro lados reales ni observaciones independientes. Los resultados de IA están grabados; abrir el ejemplo no ejecuta un análisis nuevo.";
export const DEMO_PROJECT_NAME = "Ejemplo LichenDR · cuatro vistas";
export const DEMO_VERSION = "public-demo-v1";
export interface DemoTemplate {
  version: 1;
  review: GuidedReview;
  evidence: Pick<SuggestionResponse, "backend" | "headWarning" | "geometry" | "suggestions">;
  photo: { width: number; height: number; sha256: string };
}
export function parseDemoTemplate(value: unknown): DemoTemplate {
  const t = value as DemoTemplate;
  const review = parseGuidedReview(JSON.stringify(t?.review));
  if (t?.version !== 1 || !review?.savedAt || !review.analysis || review.analysis.ai !== null
    || !Array.isArray(t.evidence?.suggestions) || !Array.isArray(t.evidence.geometry)
    || !Number.isSafeInteger(t.photo?.width) || !Number.isSafeInteger(t.photo?.height)
    || t.photo.width < 1 || t.photo.height < 1 || !/^[a-f0-9]{64}$/.test(t.photo.sha256))
    throw new Error("No se pudo leer el ejemplo. Reintenta la carga.");
  return { ...t, review };
}
export const demoSession: GuidedSession = {
  ownerId: "00000000-0000-4000-8000-000000000001", treeSampleId: "00000000-0000-4000-8000-000000000002",
  views: Object.fromEntries(DIRECTIONS.map((d, i) => [d, `00000000-0000-4000-8000-00000000000${i + 3}`])), completed: false,
};
function recordedReview(template: DemoTemplate, direction: Direction): GuidedReview {
  const imageId = demoSession.views[direction]!;
  // Public, synthetic context. The original account, request IDs, Storage paths
  // and signed proxy provenance are deliberately absent from this template.
  const ai: SuggestionResponse = {
    ...template.evidence,
    context: { imageId, treeSampleId: demoSession.treeSampleId, direction, requestToken: DEMO_VERSION },
    cacheKey: DEMO_VERSION, cached: true, notice: DEMO_NOTICE,
    provenance: { ownerId: demoSession.ownerId, imageId, treeSampleId: demoSession.treeSampleId, direction,
      proxySha256: template.photo.sha256, proxyManifestSignature: "", maskSetSha256: "",
      encoderId: template.evidence.suggestions[0]?.encoderId ?? "", headSha256: null,
      backend: "recorded_demonstration", preprocessVersion: "recorded", suggestionVersion: DEMO_VERSION },
  };
  return { ...template.review, analysis: { ...template.review.analysis!, ai } };
}
export function demoServices(template: DemoTemplate, photo: Blob): GuidedServices {
  const unavailable = async (): Promise<never> => { throw new Error("Crea tu copia para editar este ejemplo."); };
  return {
    cloud: { read: async ref => ({ review: recordedReview(template, ref.direction), revision: 1 }), write: unavailable },
    load: async () => demoSession, upload: unavailable, photo: async () => photo, storedPhoto: async () => photo,
  };
}
export async function loadDemo(): Promise<{ template: DemoTemplate; photo: Blob }> {
  const [data, image] = await Promise.all([fetch("/demo/v1/review.json"), fetch("/demo/v1/tree.jpg")]);
  if (!data.ok || !image.ok) throw new Error("No se pudo cargar el ejemplo. Reintenta.");
  const template = parseDemoTemplate(await data.json()), photo = await image.blob();
  const digest = await crypto.subtle.digest("SHA-256", await photo.arrayBuffer());
  if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("") !== template.photo.sha256)
    throw new Error("La fotografía del ejemplo no coincide con su revisión. Reintenta.");
  return { template, photo };
}
