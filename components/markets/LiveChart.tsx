"use client";

/* The live tape of one instrument: every point is a recorded trade price at
 * its exchange timestamp, plotted by Liveline. No smoothing, no fill-in. */

import { Liveline } from "liveline";
import { useEffect, useState } from "react";
import { formatQuote } from "@/lib/markets/labels";
import type { Tick } from "@/lib/markets/state";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export default function LiveChart({ title, ticks }: { title: string; ticks: Tick[] }) {
  const dark = useDarkMode();
  const last = ticks[ticks.length - 1];
  return (
    <div className="rounded-[10px] bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="font-mono text-[13px] tabular-nums text-ink-2">{last ? formatQuote(last.value) : "—"}</span>
      </div>
      <div className="h-[260px]" aria-label={`Live trades for ${title}`}>
        <Liveline
          data={ticks}
          value={last?.value ?? 0}
          theme={dark ? "dark" : "light"}
          window={300}
          windows={[
            { label: "1m", secs: 60 },
            { label: "5m", secs: 300 },
            { label: "15m", secs: 900 },
          ]}
          loading={ticks.length === 0}
          emptyText="Waiting for the first trade from the backend"
          formatValue={formatQuote}
          grid
          badge
          momentum
        />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">
        {ticks.length} recorded trade{ticks.length === 1 ? "" : "s"} since this page opened.
      </p>
    </div>
  );
}
