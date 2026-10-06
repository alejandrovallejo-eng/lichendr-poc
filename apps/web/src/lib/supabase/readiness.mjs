// Shared by the HTTP health check and the explicit database verification command.
// These probes only read; they never create sessions, records or Storage objects.
export const DATABASE_TABLES = {
  projects: "id,owner_id",
  sites: "id,project_id",
  sampling_events: "id,site_id",
  trees: "id,site_id",
  tree_samples: "id,tree_id,sampling_event_id",
  images: "id,tree_sample_id,storage_path",
  image_metadata: "id,image_id",
  annotation_sets: "id,image_id,capture_view_id",
  morphotypes: "id,annotation_set_id",
  annotation_points: "id,annotation_set_id",
  annotation_regions: "id,annotation_set_id,mask_path,region_role",
  annotation_metrics: "annotation_set_id,coverage_percent",
  site_environmental_contexts: "sampling_event_id,site_id",
  tree_sample_scientific_contexts: "tree_sample_id,dbh_cm",
  pollutant_measurements: "id,site_id",
  capture_series: "id,tree_sample_id",
  capture_views: "id,image_id,direction",
  guided_capture_reviews: "image_id,revision,review",
  jornada_morphospecies: "id,event_id,custom_name,name_revision",
  ecological_quadrat_reviews: "image_id,event_id,revision",
};

/**
 * @param {{url: string, key: string, accessToken?: string, fetchImpl?: typeof fetch}} options
 */
export async function checkSupabaseConnection({ url, key, accessToken, fetchImpl = fetch }) {
  const checks = { api: "pending", authentication: "not_checked", database: "not_checked", storage: "not_checked" };
  const tables = {};
  const headers = { apikey: key, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  const base = url.replace(/\/$/, "");
  const deadline = AbortSignal.timeout(12_000);
  /** @param {string} path @param {RequestInit} [init] */
  const request = (path, init = {}) => fetchImpl(base + path, {
    ...init, headers: { ...headers, ...init.headers }, cache: "no-store",
    signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]), redirect: "error",
  });
  try {
    const response = await request("/auth/v1/settings");
    if (!response.ok) return { status: "unavailable", checks: { ...checks, api: "failed" }, tables };
    const settings = await response.json();
    if (!settings.external || typeof settings.external !== "object") {
      return { status: "unavailable", checks: { ...checks, api: "failed" }, tables };
    }
    checks.api = "ok";
    const providers = { anonymous: settings.external.anonymous_users === true, google: settings.external.google === true };
    if (!accessToken) {
      return { status: "needs_session", checks: { ...checks, authentication: "required" }, providers, tables };
    }
    checks.authentication = "pending";
    const identity = await request("/auth/v1/user");
    if (!identity.ok) {
      return { status: "needs_session", checks: { ...checks, authentication: "required" }, providers, tables };
    }
    const user = await identity.json();
    if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) {
      return { status: "unavailable", checks: { ...checks, authentication: "failed" }, providers, tables };
    }
    checks.authentication = "ok";
    const entries = Object.entries(DATABASE_TABLES);
    // Bound concurrency so a diagnostic cannot monopolise the database pool.
    for (let start = 0; start < entries.length; start += 4) {
      await Promise.all(entries.slice(start, start + 4).map(async ([table, columns]) => {
        try {
          const probe = await request(`/rest/v1/${table}?select=${encodeURIComponent(columns)}&limit=0`, { method: "HEAD" });
          tables[table] = probe.ok ? "ok" : "failed";
        } catch { tables[table] = "failed"; }
      }));
    }
    checks.database = Object.values(tables).every(value => value === "ok") ? "ok" : "failed";
    checks.storage = "pending";
    const storage = await request("/storage/v1/object/list/lichen-images", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: `${user.id}/`, limit: 1, offset: 0 }),
    });
    checks.storage = storage.ok ? "ok" : "failed";
    return { status: checks.database === "ok" && checks.storage === "ok" ? "ok" : "degraded", checks, providers, tables };
  } catch {
    for (const name of Object.keys(checks)) if (checks[name] === "pending") checks[name] = "failed";
    return { status: "unavailable", checks, tables };
  }
}
