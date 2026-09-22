"use client";
import React from "react";

export default function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 rounded-lg shadow-sm border flex flex-col items-start" style={{ background: "var(--ld-card)", borderColor: "var(--ld-border)" }}>
      <div className="text-2xl font-bold" style={{ color: "var(--ld-text)" }}>{value}</div>
      <div className="text-sm" style={{ color: "var(--ld-text-secondary)" }}>{label}</div>
    </div>
  );
}
