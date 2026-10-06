import { createHash } from "node:crypto";
export function inspectArchive(bytes) {
  if (bytes.length > 270 * 1024 * 1024) throw new Error("archive_too_large");
  const files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").split("\0")[0];
    const name = field(0, 100), size = parseInt(field(124, 12).trim(), 8);
    const checksum = parseInt(field(148, 8).trim(), 8);
    const actual = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    if (actual !== checksum || header[156] !== 48 || !/^(records\.json|manifest\.json|files\/[0-9]{6}\.bin)$/.test(name)
      || files.has(name) || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) throw new Error("invalid_tar");
    files.set(name, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const snapshot = JSON.parse(files.get("records.json")?.toString("utf8") || "null");
  const manifest = JSON.parse(files.get("manifest.json")?.toString("utf8") || "null");
  if (snapshot?.schemaVersion !== 1 || snapshot.scope !== "current_user" || manifest?.version !== 1
    || manifest.scope !== "current_user" || manifest.ownerId !== snapshot.ownerId || !snapshot.tables
    || !/^[0-9a-f-]{36}$/.test(snapshot.ownerId) || !Array.isArray(manifest.objects)) throw new Error("invalid_manifest");
  const paths = new Set(), archivePaths = new Set();
  for (const object of manifest.objects) {
    if (typeof object.path !== "string" || !object.path.startsWith(snapshot.ownerId + "/") || object.path.split("/").some(part => !part || part === "." || part === "..") || paths.has(object.path)) throw new Error("invalid_object_scope");
    paths.add(object.path);
    if (!/^files\/[0-9]{6}\.bin$/.test(object.archivePath) || archivePaths.has(object.archivePath) || typeof object.contentType !== "string" || /[\r\n]/.test(object.contentType)) throw new Error("invalid_archive_object");
    archivePaths.add(object.archivePath);
    const blob = files.get(object.archivePath);
    if (!blob || blob.length !== object.size || createHash("sha256").update(blob).digest("hex") !== object.sha256) throw new Error("file_integrity_failed");
  }
  if (files.size !== manifest.objects.length + 2) throw new Error("unlisted_archive_file");
  return { snapshot, manifest, files };
}
const ORDER = ["projects", "sites", "sampling_events", "trees", "tree_samples", "images", "image_metadata", "capture_series", "capture_views", "annotation_sets", "morphotypes", "annotation_points", "annotation_regions", "annotation_metrics", "site_environmental_contexts", "tree_sample_scientific_contexts", "pollutant_measurements", "guided_capture_reviews", "jornada_morphospecies", "ecological_quadrat_reviews"];
/** Restore to the SAME owner, only when destination records/files do not exist.
 * RLS stays active; no overwrite, migration, auth-user creation or service-role.
 */
export async function restoreArchive(db, archive) {
  const { snapshot, manifest, files } = archive;
  const { data, error } = await db.auth.getUser();
  if (error || data.user?.id !== snapshot.ownerId) throw new Error("restore_requires_original_owner");
  if (Object.keys(snapshot.tables).some(name => !ORDER.includes(name)) || ORDER.some(name => !Array.isArray(snapshot.tables[name]))) throw new Error("invalid_tables");
  if (snapshot.tables.projects.some(row => row.owner_id !== snapshot.ownerId)
    || snapshot.tables.guided_capture_reviews.some(row => row.owner_id !== snapshot.ownerId)) throw new Error("invalid_owner");
  // Validate the complete hierarchy before using RPCs or writing any records.
  const foreignKeys = { sites: [["project_id","projects"]], sampling_events: [["site_id","sites"]], trees: [["site_id","sites"]], tree_samples: [["site_id","sites"],["tree_id","trees"],["sampling_event_id","sampling_events"]], images: [["tree_sample_id","tree_samples"]], image_metadata: [["image_id","images"]], capture_series: [["tree_sample_id","tree_samples"]], capture_views: [["capture_series_id","capture_series"],["image_id","images"],["annotation_set_id","annotation_sets"],["replaces_view_id","capture_views"]], annotation_sets: [["image_id","images"],["capture_view_id","capture_views"]], morphotypes: [["annotation_set_id","annotation_sets"]], annotation_points: [["annotation_set_id","annotation_sets"]], annotation_regions: [["annotation_set_id","annotation_sets"]], annotation_metrics: [["annotation_set_id","annotation_sets"]], site_environmental_contexts: [["site_id","sites"],["sampling_event_id","sampling_events"]], tree_sample_scientific_contexts: [["tree_sample_id","tree_samples"]], pollutant_measurements: [["site_id","sites"]], guided_capture_reviews: [["image_id","images"],["tree_sample_id","tree_samples"]], jornada_morphospecies: [["event_id","sampling_events"]], ecological_quadrat_reviews: [["image_id","images"],["event_id","sampling_events"],["tree_sample_id","tree_samples"]] };
  for (const [name, keys] of Object.entries(foreignKeys)) for (const row of snapshot.tables[name]) for (const [key, parent] of keys) {
    if (row[key] != null && !snapshot.tables[parent].some(candidate => candidate.id === row[key])) throw new Error("restore_incomplete_hierarchy");
  }
  if ([...snapshot.tables.guided_capture_reviews,...snapshot.tables.jornada_morphospecies,...snapshot.tables.ecological_quadrat_reviews].some(row => row.owner_id !== snapshot.ownerId)) throw new Error("invalid_owner");
  // Existing write policies deliberately forbid restoring obsolete guided
  // reviews. Fail before writes; full history needs an administrative restore.
  for (const row of snapshot.tables.guided_capture_reviews) if (!snapshot.tables.capture_views.some(view => view.image_id === row.image_id && view.direction === row.direction && view.active)) throw new Error("restore_history_requires_admin");
  for (const name of ORDER) {
    const key = ["annotation_metrics","site_environmental_contexts","tree_sample_scientific_contexts","guided_capture_reviews","ecological_quadrat_reviews"].includes(name)
      ? ({annotation_metrics:"annotation_set_id",site_environmental_contexts:"sampling_event_id",tree_sample_scientific_contexts:"tree_sample_id",guided_capture_reviews:"image_id",ecological_quadrat_reviews:"image_id"})[name] : "id";
    const rows = snapshot.tables[name];
    for (let i=0;i<rows.length;i+=100) {
      const existing = await db.from(name).select(key).in(key,rows.slice(i,i+100).map(row => row[key]));
      if (existing.error || existing.data?.length) throw new Error("restore_destination_not_empty");
    }
  }
  // Preflight every path before any write. Signed URL creation does not prove
  // existence; the bounded HEAD probe uses the same owner's Storage policy.
  const storage = db.storage.from("lichen-images");
  const listing = await storage.list(snapshot.ownerId, { limit: 1 });
  if (listing.error) throw new Error("restore_storage_unavailable");
  for (const object of manifest.objects) {
    const probe = await db.storage.from("lichen-images").exists(object.path);
    if (probe.data !== false || (probe.error && ![400,404].includes(Number(probe.error.status ?? probe.error.originalError?.status)))) throw new Error("restore_storage_not_empty_or_unavailable");
  }
  const createdProjects = [], createdViews = [], createdFiles = [];
  try {
    for (const name of ORDER) {
      const rows = snapshot.tables[name];
      if (name === "jornada_morphospecies") {
        for (const row of [...rows].sort((a,b)=>a.event_id.localeCompare(b.event_id)||a.ordinal-b.ordinal)) {
          const result = await db.rpc("create_jornada_morphospecies", {p_event_id:row.event_id,p_id:row.id}).single();
          if (result.error || result.data?.ordinal !== row.ordinal) throw new Error("restore_catalog_failed");
          if (row.custom_name) { const renamed = await db.rpc("rename_jornada_morphospecies",{p_event_id:row.event_id,p_id:row.id,p_name:row.custom_name,p_expected_revision:1}); if(renamed.error)throw new Error("restore_catalog_name_failed"); }
        }
        continue;
      }
      if (name === "ecological_quadrat_reviews") {
        for(const row of rows) { const result=await db.rpc("save_ecological_quadrat",{p_image_id:row.image_id,p_event_id:row.event_id,p_tree_sample_id:row.tree_sample_id,p_direction:row.direction,p_review:row.review,p_expected_revision:0}); if(result.error)throw new Error("restore_ecology_failed"); }
        continue;
      }
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i,i+100);
        const result = await db.from(name).insert(name === "capture_views" ? batch.map(row=>({...row,annotation_set_id:null})) : batch);
        if (result.error) throw new Error(`restore_${name}_${result.error.code || "failed"}`);
        if (name === "projects") createdProjects.push(...rows.slice(i, i + 100).map(row => row.id));
        if (name === "capture_views") createdViews.push(...rows.slice(i, i + 100).map(row => row.id));
      }
    }
    for (const row of snapshot.tables.capture_views.filter(row=>row.annotation_set_id)) {
      const result=await db.from("capture_views").update({annotation_set_id:row.annotation_set_id,updated_at:row.updated_at}).eq("id",row.id);
      if(result.error)throw new Error("restore_annotation_link_failed");
    }
    for (const object of manifest.objects) {
      const uploaded = await db.storage.from("lichen-images").upload(object.path, files.get(object.archivePath), { contentType: object.contentType, upsert: false });
      if (uploaded.error) throw new Error("restore_file_failed");
      createdFiles.push(object.path);
    }
  } catch (error) {
    // Compensate only this attempt's confirmed inserts. Foreign keys and RLS
    // still protect existing rows; capture views must precede image deletion.
    if (createdProjects.length) {
      if (createdViews.length) await db.from("capture_views").delete().in("id", createdViews);
      await db.from("projects").delete().in("id", createdProjects);
    }
    if (createdFiles.length) await db.storage.from("lichen-images").remove(createdFiles);
    throw error;
  }
}
