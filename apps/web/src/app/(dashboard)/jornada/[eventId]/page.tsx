import JornadaWorkflow from "@/modules/jornada/Workflow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Árboles de la jornada · LichenDR",
};

export default async function JornadaPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <JornadaWorkflow eventId={eventId} />;
}
