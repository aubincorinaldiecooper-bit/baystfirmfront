"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * A composer with optional controls: an @ menu of mentions,
 * a / menu of commands, an options picker (e.g. an execution
 * profile), dictation, and send. Every control appears only
 * when the caller supplies its content or handler; the bar
 * never fills itself, runs a demo, or fakes a transcript.
 * Type @ or / to open the menus; ↑↓ + Enter to pick.
 * Variants: Rounded (card radius) · Pill (full radius).
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export type PromptMention = { key: string; name: string; description?: string; icon?: ReactNode };
/** `name` includes the leading slash, e.g. "/compare" */
export type PromptCommand = { key: string; name: string; description?: string };
export type PromptOption = {
  key: string;
  name: string;
  /** short trailing tag, e.g. "Default" */
  tag?: string;
  /** one-line explanation under the name */
  description?: string;
  disabled?: boolean;
  /** why the option is disabled; shown in place of the description */
  disabledReason?: string;
};
export type PromptDictation = {
  listening: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

type MenuRow = { key: string; name: string; description?: string; icon?: ReactNode };

/* the last @word or /word being typed, if any */
function parseToken(draft: string): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

const OPTIONS_MENU_WIDTH = 256;

export default function PromptBar({
  variant = "Rounded",
  tall = false,
  placeholder,
  listeningPlaceholder = "Listening…",
  ariaLabel = "Prompt",
  value,
  onValueChange,
  onSend,
  sendDisabled = false,
  mentions = [],
  onMention,
  commands = [],
  onCommand,
  options = [],
  selectedOption,
  onSelectOption,
  optionsLabel = "Options",
  dictation,
}: {
  variant?: "Rounded" | "Pill";
  /** hero sizing: a multi-line input with controls on their own row */
  tall?: boolean;
  placeholder: string;
  listeningPlaceholder?: string;
  ariaLabel?: string;
  /** controlled draft; omit to let the bar own it */
  value?: string;
  onValueChange?: (value: string) => void;
  onSend: (text: string) => void;
  /** blocks sending (e.g. while a request is being submitted); typing still works */
  sendDisabled?: boolean;
  mentions?: PromptMention[];
  onMention?: (mention: PromptMention) => void;
  commands?: PromptCommand[];
  onCommand?: (command: PromptCommand) => void;
  options?: PromptOption[];
  selectedOption?: string;
  onSelectOption?: (key: string) => void;
  /** accessible name of the options picker, e.g. "Analysis profile" */
  optionsLabel?: string;
  /** shows the microphone control, driven by the caller's real recording state */
  dictation?: PromptDictation;
}) {
  const pill = variant === "Pill";
  const [innerDraft, setInnerDraft] = useState("");
  const draft = value ?? innerDraft;
  const setDraft = (next: string) => {
    if (value === undefined) setInnerDraft(next);
    onValueChange?.(next);
  };
  const [dismissed, setDismissed] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const wide = expanded || tall;
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [optionBox, setOptionBox] = useState<{ top: number; height: number } | null>(null);
  const [optionHovered, setOptionHovered] = useState<number | null>(null);
  const [menuLeft, setMenuLeft] = useState(0);
  const [menuBottom, setMenuBottom] = useState(0);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const optionRowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const hasMentions = mentions.length > 0;
  const hasPicker = options.length > 0;
  const hasMic = Boolean(dictation);
  const listening = Boolean(dictation?.listening);

  const parsed = dismissed ? null : parseToken(draft);
  const token =
    parsed && ((parsed.kind === "at" && hasMentions) || (parsed.kind === "slash" && commands.length > 0)) ? parsed : null;
  const menu: "at" | "slash" | null = plusOpen && hasMentions ? "at" : token?.kind ?? null;
  const query = plusOpen ? "" : token?.query ?? "";

  const rows: MenuRow[] =
    menu === "at"
      ? mentions.filter((m) => m.name.toLowerCase().includes(query))
      : menu === "slash"
        ? commands.filter((c) => c.name.replace(/^\//, "").toLowerCase().startsWith(query))
        : [];

  const current = options.find((o) => o.key === selectedOption);

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  /* a single highlight glides to the active row instead of each row
   * toggling its own background — matches the gliding pill in the nav */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [menu, query, active, rows.length]);

  /* same gliding highlight in the options menu — floats to the hovered
   * row, falling back to the selected option */
  const selectedIndex = options.findIndex((o) => o.key === selectedOption);
  useLayoutEffect(() => {
    if (!optionsOpen) return;
    const target = optionRowRefs.current[optionHovered ?? selectedIndex];
    if (target) setOptionBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [optionsOpen, optionHovered, selectedIndex]);

  /* The menu is outside the clipped composer, so align it to the picker
   * trigger by measurement instead of pinning it to the far-right edge. */
  useLayoutEffect(() => {
    if (!optionsOpen || !composerAnchorRef.current || !pickerRef.current) return;
    const anchorRect = composerAnchorRef.current.getBoundingClientRect();
    const triggerRect = pickerRef.current.getBoundingClientRect();
    setMenuLeft(Math.max(0, Math.min(triggerRect.left - anchorRect.left, anchorRect.width - OPTIONS_MENU_WIDTH)));
    setMenuBottom(anchorRect.bottom - triggerRect.top + 8);
  }, [optionsOpen, wide, current?.name]);

  useEffect(() => {
    if (!optionsOpen) setOptionHovered(null);
  }, [optionsOpen]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const squareControls = 1 + (hasMentions ? 1 : 0) + (hasMic ? 1 : 0);
    const columns = 2 + (hasMentions ? 1 : 0) + (hasPicker ? 1 : 0) + (hasMic ? 1 : 0);
    const fixedControlsWidth = 28 * squareControls + (pickerRef.current?.offsetWidth ?? 0);
    const inlineGaps = 4 * (columns - 1);
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    const minHeight = 28;
    const maxHeight = 100;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded, hasMentions, hasMic, hasPicker]);

  /* clicking anywhere outside the composer closes the open menus */
  useEffect(() => {
    if (!optionsOpen && !plusOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-promptbar]")) {
        setOptionsOpen(false);
        setPlusOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [optionsOpen, plusOpen]);

  const closeMenus = () => {
    setPlusOpen(false);
    setOptionsOpen(false);
  };

  const pick = (row: MenuRow) => {
    const prefix = token ? draft.slice(0, token.start) : draft;
    if (menu === "at") {
      setDraft(`${prefix}@${row.name} `);
      const mention = mentions.find((m) => m.key === row.key);
      if (mention) onMention?.(mention);
    } else {
      setDraft(`${prefix}${row.name} `);
      const command = commands.find((c) => c.key === row.key);
      if (command) onCommand?.(command);
    }
    setPlusOpen(false);
    setDismissed(false);
    inputRef.current?.focus();
  };

  const selectOption = (option: PromptOption) => {
    if (option.disabled) return;
    onSelectOption?.(option.key);
    setOptionsOpen(false);
    inputRef.current?.focus();
  };

  const canSend = draft.trim().length > 0 && !sendDisabled;
  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    closeMenus();
  };

  /* grid placement: the inline layout puts every control on one row; the wide
   * layout moves the input to its own row above the controls */
  const inlineColumns = [
    ...(hasMentions ? [["plus", "28px"]] : []),
    ["input", "minmax(0,1fr)"],
    ...(hasPicker ? [["picker", "auto"]] : []),
    ...(hasMic ? [["mic", "28px"]] : []),
    ["send", "28px"],
  ] as const;
  const wideColumns = [
    ...(hasMentions ? [["plus", "28px"]] : []),
    ...(hasPicker ? [["picker", "auto"]] : []),
    ["spacer", "minmax(0,1fr)"],
    ...(hasMic ? [["mic", "28px"]] : []),
    ["send", "28px"],
  ] as const;
  const layout = wide ? wideColumns : inlineColumns;
  const place = (name: string): CSSProperties => {
    if (name === "input" && wide) return { gridColumn: "1 / -1", gridRow: 1 };
    const index = layout.findIndex(([key]) => key === name);
    return { gridColumn: index + 1, gridRow: wide ? 2 : 1 };
  };
  const round = pill ? "rounded-full" : "rounded-[8px]";

  return (
    <div data-promptbar className="w-full">
      {/* composer is the anchor — menus grow up from its top edge */}
      <div ref={composerAnchorRef} className="relative">
        {/* ── @ / slash menu ─────────────────────────────── */}
        {menu && (
          <div
            onMouseLeave={() => setEngaged(false)}
            className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
          >
            {/* single gliding highlight — appears once a row is hovered */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {rows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setActive(i);
                  setEngaged(true);
                }}
                onClick={() => pick(row)}
                className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
              >
                {row.icon && <span className="flex size-5.5 shrink-0 items-center justify-center text-ink-2">{row.icon}</span>}
                <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.name}</span>
                {row.description && <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.description}</span>}
              </button>
            ))}
            {rows.length === 0 && (
              <div className="flex h-9 items-center px-2 text-[12px] text-ink-3">No matches for “{query}”</div>
            )}
          </div>
        )}

        {/* ── options menu ───────────────────────────────── */}
        {optionsOpen && hasPicker && (
          <div
            role="menu"
            aria-label={optionsLabel}
            onMouseLeave={() => setOptionHovered(null)}
            className="absolute z-10 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{
              width: OPTIONS_MENU_WIDTH,
              left: menuLeft,
              bottom: menuBottom,
              animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
              transformOrigin: "bottom left",
            }}
          >
            {/* single gliding highlight — floats to the hovered / selected row */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
              style={{
                top: optionBox?.top ?? 0,
                height: optionBox?.height ?? 0,
                opacity: optionBox && optionHovered !== null ? 1 : 0,
                transition:
                  "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
              }}
            />
            {options.map((option, i) => {
              const note = option.disabled ? option.disabledReason ?? option.description : option.description;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.key === selectedOption}
                  aria-disabled={option.disabled || undefined}
                  ref={(el) => {
                    optionRowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setOptionHovered(option.disabled ? null : i)}
                  onClick={() => selectOption(option)}
                  className={`relative z-10 flex min-h-7.5 w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left ${
                    option.disabled ? "cursor-not-allowed" : ""
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={`truncate text-[12.5px] font-medium ${option.disabled ? "text-ink-3" : "text-ink"}`}>{option.name}</span>
                    {note && <span className="text-[11px] leading-snug text-ink-3">{note}</span>}
                  </span>
                  {option.tag && <span className="shrink-0 text-[11px] text-ink-3">{option.tag}</span>}
                  <span className={`shrink-0 text-ink ${option.key === selectedOption ? "" : "invisible"}`}>
                    <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── composer ───────────────────────────────────── */}
        <div
          className={`relative isolate flex flex-col overflow-hidden border border-line bg-surface shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${
            tall ? "gap-2.5 p-3.5" : "gap-1.5 p-1.5"
          } ${pill ? (wide ? "rounded-[24px]" : "rounded-full") : tall ? "rounded-[22px]" : "rounded-[14px]"}`}
        >
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
          >
            {draft}
          </span>

          <div
            ref={controlsRef}
            className="grid items-end gap-x-1 gap-y-1.5"
            style={{ gridTemplateColumns: layout.map(([, size]) => size).join(" ") }}
          >
            {hasMentions && (
              <button
                type="button"
                aria-label="Add a mention"
                aria-expanded={plusOpen}
                onClick={() => {
                  setOptionsOpen(false);
                  setPlusOpen((open) => !open);
                  inputRef.current?.focus();
                }}
                style={place("plus")}
                className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${round} ${
                  plusOpen ? "bg-hover text-ink" : ""
                }`}
              >
                <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
              </button>
            )}

            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDismissed(false);
                setPlusOpen(false);
              }}
              onKeyDown={(event) => {
                if (menu && rows.length > 0) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setEngaged(true);
                    setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
                    return;
                  }
                  if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                    event.preventDefault();
                    pick(rows[active]);
                    return;
                  }
                }
                if (event.key === "Escape") {
                  setDismissed(true);
                  closeMenus();
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={listening ? listeningPlaceholder : placeholder}
              aria-label={ariaLabel}
              style={place("input")}
              className={`${tall ? "min-h-[68px] px-2 py-2 text-[14px] leading-5" : "min-h-7 px-1 py-[5px] text-[13px] leading-[18px]"} min-w-0 w-full resize-none bg-transparent text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3`}
            />

            {hasPicker && (
              <button
                ref={pickerRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={optionsOpen}
                aria-label={current ? `${optionsLabel}: ${current.name}` : optionsLabel}
                onClick={() => {
                  setPlusOpen(false);
                  setOptionsOpen((open) => !open);
                }}
                style={place("picker")}
                className={`flex h-7 shrink-0 items-center gap-1 px-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink ${round} ${
                  wide ? "justify-self-start" : ""
                }`}
              >
                {current?.name ?? optionsLabel}
                <span className="text-ink-3">
                  <Icon size={11} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></Icon>
                </span>
              </button>
            )}

            {dictation && (
              <button
                type="button"
                aria-label={listening ? "Stop dictation" : "Start dictation"}
                aria-pressed={listening}
                disabled={dictation.disabled}
                onClick={dictation.onToggle}
                style={place("mic")}
                className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.94] disabled:opacity-50 ${round} ${
                  listening ? "bg-accent-tint text-accent-ink" : "text-ink-3 enabled:hover:bg-hover enabled:hover:text-ink"
                }`}
              >
                {listening ? (
                  <span className="flex h-3.5 items-center gap-[2.5px]">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-[2.5px] rounded-full bg-current"
                        style={{ height: "100%", animation: `eq-bounce 900ms ease-in-out ${i * 150}ms infinite` }}
                      />
                    ))}
                  </span>
                ) : (
                  <Icon size={15} strokeWidth={2}><g><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></g></Icon>
                )}
              </button>
            )}

            {/* send — tactile square (round in the pill variant) */}
            <button
              type="button"
              aria-label="Send"
              disabled={!canSend}
              onClick={send}
              style={{
                ...place("send"),
                background: canSend ? "var(--ink)" : "var(--line-strong)",
                color: canSend ? "var(--surface)" : "var(--ink-2)",
              }}
              className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${round}`}
            >
              <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
