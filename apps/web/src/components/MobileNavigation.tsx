"use client";
import React from "react";
import Link from "next/link";
import navigation from "@/config/navigation";

export default function MobileNavigation() {
  return (
    <nav className="flex gap-2 lg:hidden overflow-x-auto py-2">
      {navigation.map((n) => (
        <Link key={n.path} href={n.path} className="px-3 py-2 rounded-md bg-white/60 border">
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
