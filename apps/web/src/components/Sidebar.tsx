"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import navigation from "@/config/navigation";

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 hidden lg:block p-4" style={{ background: "var(--ld-sidebar)" }}>
      <div className="mb-6 font-semibold text-white">LichenDR</div>
      <nav className="flex flex-col gap-1">
        {navigation.map((n) => {
          const active = pathname === n.path || (n.path !== "/" && pathname?.startsWith(n.path));
          return (
            <Link
              key={n.path}
              href={n.path}
              className={`flex items-center px-3 py-2 rounded transition-colors ${
                active ? "bg-[#225447] text-white" : "text-white/90 hover:bg-[#225447]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <span className={active ? "border-l-4 border-[#D9BD67] pl-2" : "pl-2"}>
                {n.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
