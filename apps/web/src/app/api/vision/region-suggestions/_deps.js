"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.samRouteDeps = samRouteDeps;
const vision_1 = require("@/lib/vision");
const server_1 = require("@/lib/supabase/server");
const flag_1 = require("@/modules/region-suggestions/flag");
// Shared wiring for the authorised MobileSAM routes.
async function samRouteDeps() {
    return {
        supabase: await (0, server_1.createSupabaseServerClient)(),
        enabled: (0, flag_1.regionSuggestionsEnabled)() && (0, flag_1.regionSuggestionsWorkerConfigured)(),
        serviceUrl: vision_1.VISION_SERVICE_URL,
        authHeaders: (0, vision_1.visionAuthHeaders)(),
    };
}
