import AppShell from "@/components/AppShell";
import "@/app/globals.css";

export const metadata = {
  title: "LichenDR - Panel",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
