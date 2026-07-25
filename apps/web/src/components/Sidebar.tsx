"use client";
import React from "react";
import Link from "next/link";
import navigation from "@/config/navigation";

export default function Sidebar() {
  return (
    <aside className="w-64 hidden lg:block border-r p-4">
      <div className="mb-6 font-semibold">LichenDR</div>
      <nav className="flex flex-col gap-2">
        {navigation.map((n) => (
          <Link key={n.path} href={n.path} className="px-3 py-2 rounded hover:bg-zinc-50">
            {n.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
