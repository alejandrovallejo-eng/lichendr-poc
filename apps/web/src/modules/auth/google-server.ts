import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { googleAction, linkedUserMatches } from "./google-policy";

const INTENT = "lichen-google-intent";
const intentOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/auth", maxAge: 600 };

function accountResponse(request: NextRequest, status: string) {
  const target = new URL("/cuenta", request.url);
  target.searchParams.set("status", status);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function bufferedClient(request: NextRequest, factory: typeof createServerClient) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Auth configuration unavailable");
  const jar = new Map(request.cookies.getAll().map(c => [c.name, c.value]));
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = factory(url, key, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: values => values.forEach(c => { jar.set(c.name, c.value); pending.set(c.name, c); }),
    },
  });
  return {
    client,
    // Failed/cancelled exchanges must not overwrite the original anonymous session.
    commit: (response: NextResponse) => pending.forEach(c => response.cookies.set(c.name, c.value, c.options)),
  };
}

export async function startGoogle(request: NextRequest, factory = createServerClient) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return new NextResponse("Solicitud no permitida", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { client, commit } = bufferedClient(request, factory);
    const { data, error } = await client.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") return accountResponse(request, "failed");
    const user = data.user;
    const action = String((await request.formData()).get("action") || "connect");
    let projectCount: number | null = null;
    if (user?.is_anonymous && action === "recover") {
      const result = await client.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
      if (!result.error) projectCount = result.count;
    }
    const choice = googleAction(user, action, projectCount);
    if (choice === "protect" || choice === "connected") return accountResponse(request, choice);
    const credentials = { provider: "google" as const, options: {
      redirectTo: new URL("/auth/callback", request.url).toString(),
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    } };
    const result = choice === "link"
      ? await client.auth.linkIdentity(credentials)
      : await client.auth.signInWithOAuth(credentials);
    if (result.error || !result.data.url) return accountResponse(request, "failed");
    const destination = new URL(result.data.url);
    const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
    if (destination.protocol !== "https:" ||
      (destination.origin !== supabaseOrigin && destination.origin !== "https://accounts.google.com")) {
      return accountResponse(request, "failed");
    }
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    commit(response);
    response.cookies.set(INTENT, choice === "link" ? user!.id : user ? `recover:${user.id}` : "signin", intentOptions);
    return response;
  } catch {
    return accountResponse(request, "failed");
  }
}

export async function finishGoogle(request: NextRequest, factory = createServerClient) {
  const expected = request.cookies.get(INTENT)?.value;
  const fail = (status: string) => {
    const response = accountResponse(request, status);
    response.cookies.set(INTENT, "", { ...intentOptions, maxAge: 0 });
    return response;
  };
  if (!expected) return fail("expired");
  const recovering = expected.startsWith("recover:");
  const previousId = recovering ? expected.slice(8) : expected;
  const params = request.nextUrl.searchParams;
  const errorCode = params.get("error_code");
  if (params.has("error")) {
    return fail(errorCode === "identity_already_exists" || errorCode === "email_exists" ? "conflict" : "cancelled");
  }
  const code = params.get("code");
  if (!code || code.length > 2048) return fail("expired");
  try {
    const { client, commit } = bufferedClient(request, factory);
    if (expected !== "signin") {
      const before = await client.auth.getUser();
      if (before.error || before.data.user?.id !== previousId) return fail("protect");
      if (recovering) {
        if (!before.data.user.is_anonymous) return fail("protect");
        const projects = await client.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", previousId);
        if (projects.error || projects.count !== 0) return fail("protect");
      }
    } else {
      // A session created in another tab during OAuth must not be replaced silently.
      const before = await client.auth.getUser();
      if (before.data.user || (before.error && before.error.name !== "AuthSessionMissingError")) return fail("protect");
    }
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !linkedUserMatches(recovering ? "signin" : expected, data.user)) return fail("failed");
    const response = accountResponse(request, "connected");
    commit(response);
    response.cookies.set(INTENT, "", { ...intentOptions, maxAge: 0 });
    return response;
  } catch {
    return fail("failed");
  }
}
