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

function MobileSection({ title, items, pathname }: { title?: string; items: readonly NavItem[]; pathname: string | null }) {
  return (
    <div className="space-y-2">
      {title ? <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ld-text-secondary)" }}>{title}</p> : null}
      <div className="space-y-2">
        {items.map((item) => {
          const active = pathname === item.path || (item.path !== "/" && pathname?.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`block rounded-xl border px-3 py-3 text-sm ${active ? "font-semibold text-white" : ""}`}
              style={{
                background: active ? "var(--ld-sidebar)" : "#fff",
                borderColor: "var(--ld-border)",
                color: active ? "#fff" : "var(--ld-text)",
              }}
            >
              <span>{item.label}</span>
              {item.description ? <span className="mt-1 block text-xs" style={{ color: active ? "rgba(255,255,255,0.8)" : "var(--ld-text-secondary)" }}>{item.description}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function MobileNavigation() {
  const pathname = usePathname();
  return (
    <div className="mb-4 md:hidden">
      <div className="mb-3 flex gap-2">
        <Link href="/preparar-jornada" className="inline-flex flex-1 items-center justify-center rounded-lg px-4 py-3 font-semibold text-white" style={{ background: "var(--ld-sidebar)" }}>
          Nueva jornada
        </Link>
        <Link href="/cuenta" className="inline-flex items-center justify-center rounded-lg border px-4 py-3 text-sm font-medium" style={{ borderColor: "var(--ld-border)" }}>
          Mi cuenta
        </Link>
      </div>
      <details className="rounded-2xl border bg-white" style={{ borderColor: "var(--ld-border)" }}>
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold">Menú</summary>
        <nav className="space-y-4 px-4 pb-4">
          <MobileSection items={primaryNavigation} pathname={pathname} />
          <MobileSection title="Resultados" items={resultsNavigation} pathname={pathname} />
          <MobileSection title="Gestión" items={managementNavigation} pathname={pathname} />
          <MobileSection title="Herramientas avanzadas" items={advancedNavigation} pathname={pathname} />
          <MobileSection title="Cuenta" items={accountNavigation} pathname={pathname} />
        </nav>
      </details>
    </div>
  );
}
