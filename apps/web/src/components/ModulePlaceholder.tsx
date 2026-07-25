"use client";
import React from "react";

export default function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="p-6 rounded-lg shadow-sm border" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
      <h2 className="text-xl font-semibold" style={{ color: "var(--ld-text)" }}>{title}</h2>
      <p className="mt-2 text-sm" style={{ color: "var(--ld-text-secondary)" }}>Este módulo aún está en construcción.</p>
    </div>
  );
}
