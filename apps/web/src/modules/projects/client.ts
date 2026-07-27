import { Project } from "@/types/domain";
import type { Database } from "@/types/supabase";
import { supabase } from "@/lib/supabase/client";
import { ensureAnonymousSession } from "@/modules/auth/client";

interface ProjectRow {
  id: string;
  owner_id?: string;
  name: string;
  description: string | null;
  created_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
  };
}

export async function fetchProjects() {
  const { error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { projects: [] as Project[], error: authError };
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return { projects: [] as Project[], error: error.message };
  }

  return { projects: data?.map(mapProject) ?? [], error: null };
}

export async function createProject(name: string, description?: string) {
  const { session, error: authError } = await ensureAnonymousSession();

  if (authError) {
    return { project: null as Project | null, error: authError };
  }

  const ownerId = session?.user?.id;

  if (!ownerId) {
    return { project: null as Project | null, error: "Unable to determine authenticated user" };
  }

  const insertData: Database['public']['Tables']['projects']['Insert'] = {
    owner_id: ownerId,
    name: name.trim(),
    description: description?.trim() || null,
  };

  const { data, error } = await supabase
    .from("projects")
    .insert([insertData])
    .select("id, name, description, created_at")
    .single();

  if (error) {
    return { project: null as Project | null, error: error.message };
  }

  return { project: data ? mapProject(data) : null, error: null };
}
