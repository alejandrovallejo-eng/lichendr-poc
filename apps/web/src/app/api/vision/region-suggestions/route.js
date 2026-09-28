"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.dynamic = void 0;
exports.GET = GET;
exports.POST = POST;
const bioclip_1 = require("@/lib/bioclip");
const server_1 = require("@/lib/supabase/server");
const flag_1 = require("@/modules/region-suggestions/flag");
const suggest_1 = require("@/modules/region-suggestions/server/suggest");
exports.dynamic = "force-dynamic";
exports.runtime = "nodejs";
function GET() {
    return Response.json({ error: "Las sugerencias de regiones requieren POST con una referencia de imagen." }, { status: 405, headers: { Allow: "POST" } });
}
// Thin adapter: the journey itself (authorisation, series readiness, serial
// coordination, crops, worker call and verified reuse) lives in the module, so
// it can be exercised end to end by route tests with injected dependencies.
async function POST(request) {
    const supabase = await (0, server_1.createSupabaseServerClient)();
    const result = await (0, suggest_1.handleRegionSuggestions)({
        supabase,
        enabled: (0, flag_1.regionSuggestionsEnabled)() && (0, flag_1.regionSuggestionsWorkerConfigured)(),
        workerUrl: bioclip_1.BIOCLIP_WORKER_URL,
        authHeaders: (0, bioclip_1.bioclipAuthHeaders)(),
        fetchImpl: (0, bioclip_1.createBioclipFetch)(request),
        preprocessMode: bioclip_1.BIOCLIP_PREPROCESS_MODE,
        timeoutMs: bioclip_1.BIOCLIP_WORKER_TIMEOUT_MS,
    }, request);
    return Response.json(result.body, { status: result.status });
}
