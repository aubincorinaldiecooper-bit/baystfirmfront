"use client";

import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import HeaderSearch from "./HeaderSearch";
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
      <div className="hidden max-w-[220px] min-w-0 shrink-0 truncate text-[13px] font-semibold text-ink lg:block">{title}</div>
      <HeaderSearch />
      {actions && <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>}
      <Link href="/status" className="shrink-0 rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium text-ink-2 hover:bg-hover-2 hover:text-ink">
        Status
      </Link>
      <ThemeToggle />
    </header>
  );
}
