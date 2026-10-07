import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCloudReview } from "../four-view/guided-cloud";
import { buildGuidedResults, type ResultSource } from "../four-view/guided-results";
import type { GuidedServices } from "../four-view/guided-flow";

export interface ReviewProject { id: string; name: string; owner_id: string; contributor_name: string; photo_count: number; created_at: string }
type ReviewSource = ResultSource & { images: { id: string; tree_sample_id: string; storage_path: string; original_filename: string; created_at: string }[] };
export async function listReviewProjects(db: SupabaseClient): Promise<ReviewProject[]> {
  const { data, error } = await db.rpc("list_review_projects");
  if (error || !Array.isArray(data)) throw new Error("No se pudieron cargar los espacios compartidos. Reintenta.");
  return data;
}
export async function readReviewProject(db: SupabaseClient, projectId: string) {
  const { data, error } = await db.rpc("read_review_project", { p_project_id: projectId });
  if (error || !data || !Array.isArray(data.projects) || data.projects.length !== 1 || data.projects[0].id !== projectId)
    throw new Error("Este espacio no está disponible. El creador puede haber retirado el acceso; actualiza la lista.");
  const source = data as ReviewSource, ownerId = source.projects[0].owner_id;
  for (const key of ["sites", "events", "trees", "samples", "series", "captures", "reviews", "images"] as const)
    if (!Array.isArray(source[key])) throw new Error("No se pudo leer el espacio completo. Reintenta.");
  const rows = buildGuidedResults(source, ownerId);
  const noWrite = async (): Promise<never> => { throw new Error("Este acceso permite consultar el trabajo. La edición corresponde al creador."); };
  const services: GuidedServices = {
    cloud: {
      read: async ref => {
        const review = source.reviews.find(r => r.image_id === ref.imageId && r.owner_id === ref.ownerId
          && r.tree_sample_id === ref.treeSampleId && r.direction === ref.direction);
        return review ? parseCloudReview(review) : null;
      }, write: noWrite,
    }, load: noWrite, upload: noWrite,
    photo: noWrite,
    storedPhoto: async (owner, imageId) => {
      if (owner !== ownerId || !source.images.some(i => i.id === imageId)) throw new Error("La foto no pertenece a este espacio.");
      const { data: photo, error: failed } = await db.storage.from("lichen-images").download(`${ownerId}/analysis-proxies/${imageId}/v1.jpg`);
      if (failed || !photo) throw new Error("No se pudo abrir la copia de análisis de esta foto. Su creador puede preparar la imagen o puedes actualizar la lectura.");
      return photo;
    },
  };
  const originalPhoto = async (imageId: string) => {
    const image = source.images.find(i => i.id === imageId);
    if (!image || image.storage_path.split("/")[0] !== ownerId) throw new Error("La foto no pertenece a este espacio.");
    const { data: photo, error: failed } = await db.storage.from("lichen-images").download(image.storage_path);
    if (failed || !photo) throw new Error("No se pudo abrir la fotografía. Actualiza las cargas para comprobar el acceso.");
    return photo;
  };
  return { source, rows, services, originalPhoto };
}
