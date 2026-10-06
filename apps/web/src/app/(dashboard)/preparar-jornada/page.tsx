import ConnectionNotice from "@/components/ConnectionNotice";

export const metadata = {
  title: "Preparar jornada · LichenDR",
};

export const dynamic = "force-dynamic";

export default async function Page() {
  if (process.env.LICHENDR_PREVIEW_ONLY === "1" || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <ConnectionNotice previewOnly={process.env.LICHENDR_PREVIEW_ONLY === "1"} />;
  }
  const { default: Content } = await import("./route-content");
  return <Content />;
}
