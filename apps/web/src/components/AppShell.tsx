"use client";
import React from "react";
import Sidebar from "./Sidebar";
import MobileNavigation from "./MobileNavigation";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <MobileNavigation />
          {children}
        </main>
      </div>
    </div>
  );
}
