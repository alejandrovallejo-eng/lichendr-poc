"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const ssr_1 = require("@supabase/ssr");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be provided");
}
exports.supabase = (0, ssr_1.createBrowserClient)(supabaseUrl, supabaseKey);
