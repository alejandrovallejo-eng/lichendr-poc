"use client";
import React from "react";

export default function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-sm border flex flex-col items-start">
      <div className="text-2xl font-bold text-zinc-900">{value}</div>
      <div className="text-sm text-zinc-600">{label}</div>
    </div>
  );
}
