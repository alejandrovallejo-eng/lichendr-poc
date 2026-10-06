import ConnectionNotice from "@/components/ConnectionNotice";
export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  if (process.env.LICHENDR_PREVIEW_ONLY === "1" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return <ConnectionNotice previewOnly={process.env.LICHENDR_PREVIEW_ONLY === "1"} />;
  const { default: ExportWorkspace } = await import("@/modules/exports/ExportWorkspace");
  return <ExportWorkspace />;
}
