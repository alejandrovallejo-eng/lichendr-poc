"use client";

import { supabase } from "@/lib/supabase/client";

export async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    return { session: null, error: sessionError.message };
  }

  if (sessionData?.session) {
    return { session: sessionData.session, error: null };
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    return { session: null, error: error.message };
  }

  return { session: data.session, error: null };
}
