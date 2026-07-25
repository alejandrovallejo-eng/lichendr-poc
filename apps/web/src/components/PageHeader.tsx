"use client";
import React from "react";

export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-semibold" style={{ color: "var(--ld-text)" }}>{title}</h1>
      {subtitle && <p className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{subtitle}</p>}
    </header>
  );
}
