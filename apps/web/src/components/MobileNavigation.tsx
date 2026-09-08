"use client";
import React from "react";
import Link from "next/link";
import navigation from "@/config/navigation";

export default function MobileNavigation() {
  return (
    <nav className="flex gap-2 md:hidden overflow-x-auto py-2" style={{ background: "transparent" }}>
      {navigation.map((n) => (
        <Link
          key={n.path}
          href={n.path}
          className="px-3 py-2 rounded-md"
          style={{ background: "var(--ld-sidebar)", color: "white" }}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
