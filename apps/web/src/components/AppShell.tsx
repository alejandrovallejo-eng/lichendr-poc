import type { ReactNode } from "react";
import Link from "next/link";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";
import WorkflowGuide from "./WorkflowGuide";
import NavIcon from "./NavIcon";
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ld-app-shell">
      <a href="#contenido" className="ld-skip-link">
        Saltar al contenido
      </a>
      <Sidebar />
      <div className="ld-main-column">
        <header className="ld-topbar">
          <Link className="ld-mobile-brand" href="/" translate="no">
            LichenDR
          </Link>
          <span className="ld-topbar-label">Cuaderno de campo</span>
          <Link href="/cuenta" className="ld-account-link">
            <span className="ld-account-avatar" aria-hidden="true">
              <NavIcon name="leaf" />
            </span>
            Mi cuenta
          </Link>
        </header>
        <div className="ld-content-container">
          <MobileNavigation />
          <WorkflowGuide />
          <main id="contenido" tabIndex={-1} className="ld-workspace">
            {children}
          </main>
          <footer className="ld-page-footer">
            <span translate="no">LichenDR</span>
            <span>Registro, revisión y trazabilidad del muestreo</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
