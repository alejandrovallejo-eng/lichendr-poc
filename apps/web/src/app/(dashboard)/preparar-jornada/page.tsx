import PrepareDayWorkflow from "@/modules/prepare-day/Workflow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Preparar jornada · LichenDR",
};

export default function PrepareDayPage() {
  return <PrepareDayWorkflow />;
}
