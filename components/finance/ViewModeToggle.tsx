"use client";

import type { ViewMode } from "@/lib/markets/useViewMode";

export default function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-lg bg-line/60 p-0.5" role="group" aria-label="View mode">
      {(["simple", "details"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={`rounded-md px-3 py-1.5 text-[12px] ${
            value === mode ? "bg-ink text-surface" : "text-ink-2 hover:bg-hover-2"
          }`}
        >
          {mode === "simple" ? "Simple" : "Details"}
        </button>
      ))}
    </div>
  );
}
