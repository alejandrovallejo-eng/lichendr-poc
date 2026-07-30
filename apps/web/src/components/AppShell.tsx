"use client";
import React from "react";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full" style={{ background: "var(--ld-background)" }}>
      <div className="max-w-7xl mx-auto flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-6 min-w-0" style={{ color: "var(--ld-text)" }}>
          <MobileNavigation />
          <div className="mt-4">{children}</div>
        </main>
      </div>
    </div>
  );
}
