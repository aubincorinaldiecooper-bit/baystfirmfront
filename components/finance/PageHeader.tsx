"use client";

import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { useWorkspace } from "./workspace";

/* The page pane's top bar: the history toggle on narrow screens, a title and
 * the page's own actions, then the theme toggle. */
export default function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  const { openSidebar } = useWorkspace();
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-2 py-1 sm:px-4">
      <button
        type="button"
        aria-label="Open history"
        onClick={openSidebar}
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 transition-colors duration-150 hover:bg-hover-2 hover:text-ink md:hidden"
      >
        <Menu size={18} aria-hidden />
      </button>
      <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      <ThemeToggle />
    </header>
  );
}
