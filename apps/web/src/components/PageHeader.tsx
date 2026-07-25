"use client";
import React from "react";

export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-3xl font-semibold text-zinc-900">{title}</h1>
      {subtitle && <p className="text-sm text-zinc-600">{subtitle}</p>}
    </header>
  );
}
