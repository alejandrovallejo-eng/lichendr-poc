"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import navigation, { isNavActive } from "@/config/navigation";
import NavIcon from "./NavIcon";
const groups = [...new Set(navigation.map((item) => item.group))];
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="ld-sidebar">
      <Link className="ld-brand" href="/" aria-label="LichenDR, inicio">
        <span className="ld-brand-mark">
          <NavIcon name="leaf" />
        </span>
        <span translate="no">
          Lichen<span className="ld-brand-accent">DR</span>
        </span>
      </Link>
      <p className="ld-brand-caption">
        Biomonitoreo de líquenes
        <br />
        República Dominicana
      </p>
      <nav aria-label="Navegación principal">
        {groups.map((group) => (
          <div className="ld-nav-group" key={group}>
            <p className="ld-nav-label">{group}</p>
            {navigation
              .filter((item) => item.group === group)
              .map((item) => {
                const active = isNavActive(pathname, item.path);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`ld-nav-link${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      <div className="ld-sidebar-footer">
        <span className="ld-small-dot" aria-hidden="true" />
        <p>
          Del registro de campo
          <br />a la evidencia científica.
        </p>
      </div>
    </aside>
  );
}
