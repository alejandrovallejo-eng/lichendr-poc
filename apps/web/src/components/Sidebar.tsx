"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  accountNavigation,
  advancedNavigation,
  managementNavigation,
  primaryNavigation,
  resultsNavigation,
  type NavItem,
} from "@/config/navigation";

function NavSection({ title, items, pathname }: { title?: string; items: readonly NavItem[]; pathname: string | null }) {
  return (
    <div className="space-y-1">
      {title ? <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-white/60">{title}</p> : null}
      {items.map((item) => {
        const active = pathname === item.path || (item.path !== "/" && pathname?.startsWith(item.path));
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`block rounded-xl px-3 py-2 transition-colors ${active ? "bg-[#225447] text-white" : "text-white/90 hover:bg-[#225447]"}`}
            aria-current={active ? "page" : undefined}
          >
            <span className={active ? "border-l-4 border-[#D9BD67] pl-2" : "pl-2"}>{item.label}</span>
            {item.description ? <span className="mt-1 block pl-2 text-xs text-white/70">{item.description}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 hidden md:block p-4" style={{ background: "var(--ld-sidebar)" }}>
      <div className="mb-6 font-semibold text-white">LichenDR</div>
      <Link href="/preparar-jornada" className="mb-4 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 font-semibold text-white" style={{ background: "var(--ld-green)" }}>
        Nueva jornada
      </Link>
      <nav className="flex flex-col gap-3">
        <NavSection items={primaryNavigation} pathname={pathname} />
        <NavSection title="Indicadores" items={resultsNavigation} pathname={pathname} />
        <NavSection title="Gestión" items={managementNavigation} pathname={pathname} />
        <NavSection title="Herramientas avanzadas" items={advancedNavigation} pathname={pathname} />
        <NavSection title="Cuenta" items={accountNavigation} pathname={pathname} />
      </nav>
    </aside>
  );
}
