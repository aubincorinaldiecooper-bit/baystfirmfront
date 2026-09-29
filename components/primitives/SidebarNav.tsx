"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed; adds selection by id, a per-row detail, empty/footer slots
 * for the history list and an optional controlled collapse. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
/* Icons: upstream uses the commercial @central-icons-react set. This copy uses
 * the ISC-licensed lucide-react equivalents (same `size` prop, 2px stroke), so
 * the build needs no CENTRAL_LICENSE_KEY. */
import { ChevronDown, LayoutGrid, PanelLeftClose, Search, SquarePen, X } from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";

/* ─────────────────────────────────────────────────────────
 * SIDEBAR NAV
 * Compact workspace control, primary navigation, a searchable
 * history list, and a collapse that preserves icon alignment.
 * Every label, item and history row is given by the caller:
 * empty lists render nothing, the workspace control is only a
 * menu when menu items are supplied, and the new-item and
 * footer buttons appear only when their handlers are given.
 * The history list can show a caller-given empty state and
 * a footer (e.g. "load more") under the rows.
 * ───────────────────────────────────────────────────────── */

export type SidebarNavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  /** short trailing text, e.g. a count */
  count?: string;
};

export type SidebarRecent = {
  id: string;
  label: string;
  prompt?: string;
  /** short muted trailing text, e.g. a ticker or a status */
  detail?: string;
};

export type SidebarMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

export type SidebarLabels = {
  /** heading above the history list */
  recents: string;
  /** placeholder / accessible name of the history search */
  search: string;
  /** shown when a search matches nothing */
  noMatches: string;
};

const DEFAULT_LABELS: SidebarLabels = {
  recents: "Recent",
  search: "Search",
  noMatches: "No matches",
};

type SidebarNavProps = {
  /** name shown in the workspace control */
  workspaceName: string;
  /** workspace glyph; defaults to a neutral grid icon */
  logo?: ReactNode;
  /** when present, the workspace control opens a menu of these items */
  workspaceMenu?: SidebarMenuItem[];
  navItems?: SidebarNavItem[];
  recents?: SidebarRecent[];
  /** controlled selection in the history list (matched by label) */
  activeTitle?: string | null;
  /** controlled selection in the history list by id; wins over `activeTitle` */
  activeId?: string | null;
  /** shown in place of the history list when `recents` is empty */
  recentsEmpty?: ReactNode;
  /** shown under the history rows, e.g. a load-more control */
  recentsFooter?: ReactNode;
  /** controlled collapse; omit to let the sidebar own it */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  fill?: boolean;
  /** label of the new-item button; shown together with `onNew` */
  newLabel?: string;
  onNew?: () => void;
  onPick?: (id: string, label: string, prompt?: string) => void;
  /** controlled primary-nav selection */
  activeNav?: string;
  onNavigate?: (key: string) => void;
  /** footer button; shown only when a label is given */
  footerLabel?: string;
  footerIcon?: ReactNode;
  onFooterClick?: () => void;
  labels?: Partial<SidebarLabels>;
};

const SIDEBAR_MOTION = {
  expandedWidth: 224,
  collapsedWidth: 52,
  duration: 280,
  copyDuration: 180,
  copyOffset: 8,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/* ─────────────────────────────────────────────────────────
 * HISTORY SEARCH STORYBOARD
 *
 *   0ms   search is triggered; the list label begins fading
 *   0ms   field grows right → left from the search control
 * 180ms   field fills the row; cursor is focused and ready
 * ───────────────────────────────────────────────────────── */
const SEARCH_MOTION = {
  duration: 180,
  closedWidth: 28,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

function GlideGroup({ children }: { children: ReactNode }) {
  return (
    <GlideMenu
      rowSelector="[data-row]"
      highlightClassName="sidebar-glide-highlight rounded-[7px] bg-hover-2"
      className="group/glide flex flex-col gap-px"
    >
      {children}
    </GlideMenu>
  );
}

function RailButton({
  icon,
  label,
  active = false,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: string;
  onClick?: () => void;
}) {
  return (
    <button
      data-row
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] px-2 text-left
        transition-[width,background-color,color,transform] duration-150 active:scale-[0.98]
        ${active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""}`}
    >
      <span className={`flex size-5 shrink-0 items-center justify-center ${active ? "text-ink" : "text-ink-2"}`}>
        {icon}
      </span>
      <span className={`sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
        {label}
      </span>
      {count && (
        <span className="sidebar-copy mr-2 shrink-0 text-[12px] font-medium tabular-nums text-ink-3">
          {count}
        </span>
      )}
    </button>
  );
}

function WorkspaceMenu({
  items,
  position,
  onClose,
}: {
  items: SidebarMenuItem[];
  position: { top: number; left: number };
  onClose: () => void;
}) {
  return createPortal(
    <div
      data-workspace-menu
      role="menu"
      className="fixed z-50 w-64 rounded-[14px] bg-surface p-1.5 shadow-overlay"
      style={{
        top: position.top,
        left: position.left,
        animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
        transformOrigin: "top left",
      }}
    >
      <GlideMenu className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
        {items.map((item) => (
          <button
            key={item.key}
            data-menu-row
            role="menuitem"
            type="button"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className="relative z-10 flex h-9 w-full items-center gap-1.5 rounded-[8px] px-2 text-left"
          >
            {item.icon && <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{item.label}</span>
          </button>
        ))}
      </GlideMenu>
    </div>,
    document.body,
  );
}

export default function SidebarNav({
  workspaceName,
  logo,
  workspaceMenu = [],
  navItems = [],
  recents = [],
  activeTitle,
  activeId,
  recentsEmpty,
  recentsFooter,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className = "",
  fill = false,
  newLabel,
  onNew,
  onPick,
  activeNav,
  onNavigate,
  footerLabel,
  footerIcon,
  onFooterClick,
  labels,
}: SidebarNavProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const [innerCollapsed, setInnerCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? innerCollapsed;
  const setCollapsed = (next: boolean) => {
    if (controlledCollapsed === undefined) setInnerCollapsed(next);
    onCollapsedChange?.(next);
  };
  const [internalNav, setInternalNav] = useState<string | null>(null);
  const currentNav = activeNav ?? internalNav;
  const selectNav = (key: string) => {
    setInternalNav(key);
    onNavigate?.(key);
  };
  /* uncontrolled selection, used only when `activeTitle` is not given */
  const [localActiveTitle, setLocalActiveTitle] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspacePosition, setWorkspacePosition] = useState({ top: 0, left: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const hasMenu = workspaceMenu.length > 0;
  const selectedTitle = activeTitle === undefined ? localActiveTitle : activeTitle;
  const visibleRecents = recents.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!workspaceOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-workspace-trigger]") && !target.closest("[data-workspace-menu]")) {
        setWorkspaceOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [workspaceOpen]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const collapse = () => {
    setCollapsed(true);
    setWorkspaceOpen(false);
    setSearchOpen(false);
    setQuery("");
  };

  const workspaceInner = (
    <>
      <span className="sidebar-logo flex size-5 shrink-0 items-center justify-center text-ink">
        {logo ?? <LayoutGrid size={18} />}
      </span>
      <span className="sidebar-copy ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2">
        {workspaceName}
      </span>
      {hasMenu && (
        <span className="sidebar-copy ml-1 flex shrink-0 text-ink-3">
          <ChevronDown size={16} />
        </span>
      )}
    </>
  );
  const workspaceClass =
    "sidebar-workspace-control absolute left-2 top-1 flex h-8 w-[164px] items-center rounded-[8px] px-2 text-left";

  return (
    <aside
      data-sidebar-collapsed={collapsed}
      aria-label="Workspace navigation"
      className={`relative flex shrink-0 overflow-hidden transition-[width] ${fill ? "h-full" : "h-[600px]"} ${className}`}
      style={{
        width: collapsed ? SIDEBAR_MOTION.collapsedWidth : SIDEBAR_MOTION.expandedWidth,
        transitionDuration: `${SIDEBAR_MOTION.duration}ms`,
        transitionTimingFunction: SIDEBAR_MOTION.easing,
        "--sidebar-copy-duration": `${SIDEBAR_MOTION.copyDuration}ms`,
        "--sidebar-copy-offset": `${SIDEBAR_MOTION.copyOffset}px`,
        "--sidebar-easing": SIDEBAR_MOTION.easing,
      } as CSSProperties}
    >
      <div className="flex min-h-0 w-[224px] shrink-0 flex-col">
        <div className="relative mb-2.5 h-10 shrink-0">
          {hasMenu ? (
            <button
              ref={workspaceButtonRef}
              data-workspace-trigger
              type="button"
              aria-haspopup="menu"
              aria-expanded={workspaceOpen}
              aria-hidden={collapsed}
              tabIndex={collapsed ? -1 : 0}
              onClick={() => {
                if (!workspaceOpen && workspaceButtonRef.current) {
                  const rect = workspaceButtonRef.current.getBoundingClientRect();
                  setWorkspacePosition({ top: rect.bottom + 6, left: rect.left });
                }
                setWorkspaceOpen((open) => !open);
              }}
              className={`${workspaceClass} transition-[background-color,transform] duration-100 hover:bg-hover-2 active:scale-[0.99]`}
            >
              {workspaceInner}
            </button>
          ) : (
            <div aria-hidden={collapsed} className={workspaceClass}>
              {workspaceInner}
            </div>
          )}

          {workspaceOpen && hasMenu && (
            <WorkspaceMenu items={workspaceMenu} position={workspacePosition} onClose={() => setWorkspaceOpen(false)} />
          )}

          <button
            type="button"
            aria-label="Collapse sidebar"
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={collapse}
            className="sidebar-collapse-control absolute right-2 top-1 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftClose size={18} />
          </button>
          <button
            type="button"
            aria-label="Expand sidebar"
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => setCollapsed(false)}
            className="sidebar-expand-control absolute left-2 top-0.5 flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftClose size={18} className="rotate-180" />
          </button>
        </div>

        {(onNew || navItems.length > 0) && (
          <GlideGroup>
            {onNew && (
              <RailButton
                icon={<SquarePen size={18} />}
                label={newLabel ?? "New"}
                onClick={() => {
                  if (activeTitle === undefined) setLocalActiveTitle(null);
                  onNew();
                }}
              />
            )}
            {navItems.map((item) => (
              <RailButton
                key={item.key}
                icon={item.icon}
                label={item.label}
                count={item.count}
                active={currentNav === item.key}
                onClick={() => selectNav(item.key)}
              />
            ))}
          </GlideGroup>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {recents.length > 0 && (
            <>
              <div className="sidebar-copy relative mx-2 mb-1 h-8">
                <div
                  aria-hidden={searchOpen}
                  className={`absolute inset-0 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-ink-3 transition-[opacity,transform] ${searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100"}`}
                  style={{ transitionDuration: `${SEARCH_MOTION.duration}ms`, transitionTimingFunction: SEARCH_MOTION.easing }}
                >
                  <ChevronDown size={16} />
                  <span>{copy.recents}</span>
                </div>

                <button
                  type="button"
                  aria-label={copy.search}
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen(true)}
                  className={`absolute right-0 top-0 z-10 flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-[opacity,background-color,color,transform] hover:bg-hover-2 hover:text-ink active:scale-[0.96] ${searchOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
                  style={{ transitionDuration: `${SEARCH_MOTION.duration}ms` }}
                >
                  <Search size={16} />
                </button>

                <div
                  className={`absolute right-0 top-0 z-20 flex h-8 items-center overflow-hidden rounded-[8px] bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2 ${searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
                  style={{
                    width: searchOpen ? "100%" : SEARCH_MOTION.closedWidth,
                    transitionDuration: `${SEARCH_MOTION.duration}ms`,
                    transitionTimingFunction: SEARCH_MOTION.easing,
                  }}
                >
                  <span className="ml-2 flex shrink-0 items-center justify-center">
                    <Search size={15} />
                  </span>
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setSearchOpen(false);
                        setQuery("");
                      }
                    }}
                    placeholder={copy.search}
                    aria-label={copy.search}
                    tabIndex={searchOpen ? 0 : -1}
                    className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
                  />
                  <button
                    type="button"
                    aria-label="Close search"
                    tabIndex={searchOpen ? 0 : -1}
                    onClick={() => {
                      setSearchOpen(false);
                      setQuery("");
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <GlideGroup>
                {visibleRecents.map((item) => {
                  const active = activeId !== undefined ? item.id === activeId : item.label === selectedTitle;
                  return (
                    <button
                      key={item.id}
                      data-row
                      type="button"
                      title={item.label}
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        if (activeTitle === undefined) setLocalActiveTitle(item.label);
                        onPick?.(item.id, item.label, item.prompt);
                      }}
                      className={`sidebar-row relative z-10 mx-2 flex h-8 items-center rounded-[8px] px-2 text-left transition-[width,background-color,color,transform] duration-150 active:scale-[0.98] ${
                        active ? "bg-hover-2 group-hover/glide:bg-transparent" : ""
                      }`}
                    >
                      <span className={`sidebar-copy min-w-0 flex-1 truncate text-[14px] font-medium ${active ? "text-ink" : "text-ink-2"}`}>
                        {item.label}
                      </span>
                      {item.detail && (
                        <span className="sidebar-copy ml-2 shrink-0 text-[11.5px] font-medium text-ink-3">{item.detail}</span>
                      )}
                    </button>
                  );
                })}
                {query && visibleRecents.length === 0 && (
                  <div className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3">{copy.noMatches}</div>
                )}
              </GlideGroup>
              {recentsFooter && <div className="sidebar-copy mx-2 mt-1">{recentsFooter}</div>}
            </>
          )}
          {recents.length === 0 && recentsEmpty && <div className="sidebar-copy mx-2">{recentsEmpty}</div>}
        </div>

        {footerLabel && (
          <div className="sidebar-copy mx-2 mt-3 w-[208px] border-t border-line pt-3">
            <button
              type="button"
              onClick={onFooterClick}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-control bg-hover-2 text-[12.5px] font-medium text-ink transition-[background-color,transform] duration-150 hover:bg-line-strong active:scale-[0.98]"
            >
              {footerIcon}
              {footerLabel}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
