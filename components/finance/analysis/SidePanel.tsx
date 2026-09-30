"use client";

/* The collapsible right panel (Analysis | Symbol) and the slim icon rail that
 * opens and closes it. Below 1100px the panel is an overlay drawer over the
 * main window. */

import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight, FileText, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type PanelTab = "analysis" | "symbol";

export const SIDE_PANEL_ID = "side-panel";
const TABS: { value: PanelTab; label: string }[] = [
  { value: "analysis", label: "Analysis" },
  { value: "symbol", label: "Symbol" },
];

/** True where the panel sits beside the main window (not an overlay). */
export function isWideLayout(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(min-width: 1100px)").matches;
}

export function SidePanel({
  tab,
  onTab,
  onClose,
  autoHidden = false,
  children,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  /** Open only by default: hidden by CSS where it would be an overlay, so a narrow first paint never shows the drawer. */
  autoHidden?: boolean;
  children: ReactNode;
}) {
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.value === tab);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onTab(next.value);
    document.getElementById(`side-tab-${next.value}`)?.focus();
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close side panel"
        onClick={onClose}
        className={cn("absolute inset-0 z-20 bg-[oklch(0_0_0/0.35)] min-[1100px]:hidden", autoHidden && "hidden")}
      />
      <aside
        id={SIDE_PANEL_ID}
        aria-label={tab === "analysis" ? "Analysis" : "Symbol and watchlist"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isWideLayout()) onClose();
        }}
        className={cn(
          "z-30 flex w-[400px] shrink-0 flex-col border-l border-line bg-surface",
          "max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-11 max-[1100px]:w-[min(400px,calc(100%-44px))] max-[1100px]:shadow-overlay",
          autoHidden && "max-[1100px]:hidden",
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line pl-3.5 pr-2">
          <div role="tablist" aria-label="Side panel" className="inline-flex gap-0.5 rounded-[8px] bg-hover-2 p-0.5">
            {TABS.map((t) => {
              const selected = t.value === tab;
              return (
                <button
                  key={t.value}
                  id={`side-tab-${t.value}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="side-panel-body"
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => onTab(t.value)}
                  className={cn(
                    "h-7 rounded-[6px] px-3 text-[13px] font-medium transition-colors duration-150",
                    selected ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="Collapse side panel"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-[8px] text-ink-2 transition-colors duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <div role="tabpanel" id="side-panel-body" aria-labelledby={`side-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </aside>
    </>
  );
}

export function PanelRail({ open, tab, onSelect }: { open: boolean; tab: PanelTab; onSelect: (tab: PanelTab) => void }) {
  const items: { value: PanelTab; label: string; icon: ReactNode }[] = [
    { value: "analysis", label: "Analysis", icon: <FileText size={17} aria-hidden /> },
    { value: "symbol", label: "Symbol and watchlist", icon: <List size={17} aria-hidden /> },
  ];
  return (
    <nav aria-label="Panels" className="relative z-30 flex w-11 shrink-0 flex-col items-center gap-1.5 border-l border-line bg-page pt-2">
      {items.map((item) => {
        const pressed = open && tab === item.value;
        return (
          <button
            key={item.value}
            type="button"
            aria-label={item.label}
            aria-pressed={pressed}
            aria-controls={SIDE_PANEL_ID}
            title={item.label}
            onClick={() => onSelect(item.value)}
            className={cn(
              "flex size-9 items-center justify-center rounded-[8px] transition-colors duration-150",
              pressed ? "bg-hover-2 text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
}
