"use client";
import React from "react";

export default function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="p-6 bg-white rounded-lg shadow-sm border">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600">Este módulo aún está en construcción.</p>
    </div>
  );
}
