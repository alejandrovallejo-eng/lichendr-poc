"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { loadGuidedResults } from "./guided-results-client";
import type { GuidedTreeResult } from "./guided-results";

export function useGuidedResults(eventId?: string, refreshKey = 0) {
  const [state, setState] = useState<{ rows: GuidedTreeResult[] | null; error: string; scope?: string }>({ rows: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ rows: null, error: "", scope: eventId });
    void loadGuidedResults(supabase as SupabaseClient, eventId, controller.signal)
      .then(rows => { if (current) setState({ rows, error: "", scope: eventId }); })
      .catch(error => { if (current && !controller.signal.aborted) setState({ rows: null,
        error: error instanceof Error ? error.message : "No se pudieron leer los resultados.", scope: eventId }); });
    return () => { current = false; controller.abort(); };
  }, [eventId, attempt, refreshKey]);
  return { rows: state.scope === eventId ? state.rows : null, error: state.scope === eventId ? state.error : "",
    retry: () => setAttempt(value => value + 1) };
}
