"use client";

import { Fragment } from "react";

export interface ContextTrailEntry {
  label: string;
  value?: string | null;
}

export default function ContextTrail({ entries, className = "" }: {
  entries: readonly ContextTrailEntry[];
  className?: string;
}) {
  const visible = entries.filter((entry) => entry.value && entry.value.trim().length > 0);
  if (!visible.length) return null;
  return (
    <p className={`text-sm ${className}`.trim()} style={{ color: "var(--ld-text-secondary)" }}>
      {visible.map((entry, index) => (
        <Fragment key={entry.label}>
          <span><strong style={{ color: "var(--ld-text)" }}>{entry.label}:</strong> {entry.value}</span>
          {index < visible.length - 1 ? <span aria-hidden="true"> / </span> : null}
        </Fragment>
      ))}
    </p>
  );
}
