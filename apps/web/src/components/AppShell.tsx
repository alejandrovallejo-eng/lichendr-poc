"use client";
import React from "react";
import Link from "next/link";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full" style={{ background: "var(--ld-background)" }}>
      <div className="max-w-7xl mx-auto flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-6 min-w-0" style={{ color: "var(--ld-text)" }}>
          <div className="mb-3 hidden justify-end md:flex"><Link href="/cuenta" className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50">Mi cuenta</Link></div>
          <MobileNavigation />
          <div className="mt-4">{children}</div>
        </main>
      </div>
    </div>
  );
}
