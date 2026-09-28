"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupabaseServerClient = createSupabaseServerClient;
const ssr_1 = require("@supabase/ssr");
const headers_1 = require("next/headers");
async function createSupabaseServerClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be provided");
    }
    const cookieStore = await (0, headers_1.cookies)();
    return (0, ssr_1.createServerClient)(supabaseUrl, supabaseKey, {
        cookies: {
            getAll: () => cookieStore.getAll().map((cookie) => ({
                name: cookie.name,
                value: cookie.value,
            })),
            setAll: (supabaseCookies) => {
                supabaseCookies.forEach((cookie) => {
                    if (!cookie || !cookie.name)
                        return;
                    cookieStore.set(cookie.name, cookie.value, cookie.options);
                });
            },
        },
    });
}
