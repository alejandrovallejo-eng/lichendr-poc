import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "LichenDR - Panel",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
    </AppShell>
  );
}
