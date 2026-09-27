"use client";
/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root.
 * Modified: demo content removed. */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * RECORDS TABLE
 * A dense, scrollable data table: sticky header and first
 * column, click-to-sort headers, drag-to-resize columns,
 * optional row selection and an optional footer row.
 * Columns and rows come from the caller; an empty row list
 * renders nothing. Cells render exactly what `cell` returns:
 * the table never computes, fills or animates values.
 * ───────────────────────────────────────────────────────── */

type SortValue = string | number | null | undefined;

export type RecordsColumn<Row> = {
  key: string;
  header: string;
  icon?: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** makes the column sortable; null/undefined sort last */
  sortValue?: (row: Row) => SortValue;
  /** "end" right-aligns the column (use for numbers) */
  align?: "start" | "end";
  /** tabular numerals for comparable figures */
  numeric?: boolean;
  /** initial width in px; measured from the layout when omitted */
  width?: number;
  minWidth?: number;
  /** footer cell, e.g. a count or a total the caller computed */
  footer?: ReactNode;
};

export type RecordsSort = { key: string; dir: 1 | -1 };

const DEFAULT_MIN_WIDTH = 96;

function Icon({ children, size = 14, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Checkbox({ checked, mixed = false, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  return (
    <label className="records-checkbox" title={label} onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} aria-checked={mixed ? "mixed" : checked} />
      <span className={`records-checkbox-box ${checked || mixed ? "is-active" : ""}`}>
        {mixed ? <span className="records-checkbox-dash" /> : checked ? <Icon size={12}><path d="m5 12 4 4L19 6" /></Icon> : null}
      </span>
    </label>
  );
}

/* ── cell building blocks ──────────────────────────────── */

const TAG_PALETTE = {
  amber: "oklch(0.76 0.13 70)",
  lime: "oklch(0.77 0.16 122)",
  yellow: "oklch(0.80 0.15 101)",
  purple: "oklch(0.62 0.18 293)",
  orange: "oklch(0.71 0.16 48)",
  cyan: "oklch(0.72 0.10 221)",
  red: "oklch(0.64 0.19 27)",
  magenta: "oklch(0.66 0.21 323)",
  green: "oklch(0.70 0.13 162)",
  pink: "oklch(0.67 0.19 3)",
  neutral: "var(--ink-3)",
} as const;

export type RecordsTone = keyof typeof TAG_PALETTE;

/** a tinted label chip */
export function RecordsTag({ label, tone = "neutral" }: { label: string; tone?: RecordsTone }) {
  return (
    <span className="records-tag" style={{ "--tag-base": TAG_PALETTE[tone] } as React.CSSProperties}>
      {label}
    </span>
  );
}

/** a status dot and label; pass a CSS colour such as "var(--orange)" */
export function RecordsStatus({ label, color }: { label: string; color: string }) {
  return (
    <span className="records-strength">
      <span className="records-strength-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

/** an external link that truncates inside its cell */
export function RecordsLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="records-link" href={href} title={label} target="_blank" rel="noreferrer">
      <span className="records-link-label">{label}</span>
      <Icon size={12}><path d="M14 5h5v5M19 5l-8 8" /></Icon>
    </a>
  );
}

/** muted placeholder for a value the data does not have */
export function RecordsEmpty({ label = "—" }: { label?: string }) {
  return <span className="records-muted">{label}</span>;
}

/* ── header ────────────────────────────────────────────── */

function HeaderCell<Row>({
  column,
  sort,
  onSort,
  onResizeStart,
  resizing,
  sticky,
  leading,
}: {
  column: RecordsColumn<Row>;
  sort: RecordsSort | null;
  onSort: (key: string) => void;
  onResizeStart: (event: React.PointerEvent<HTMLSpanElement>) => void;
  resizing: boolean;
  sticky: boolean;
  leading?: ReactNode;
}) {
  const sortable = Boolean(column.sortValue);
  const sorted = sort?.key === column.key;
  const end = column.align === "end";
  const content = (
    <>
      {column.icon && <span className="records-header-icon">{column.icon}</span>}
      <span className="truncate">{column.header}</span>
      {sortable && (
        <span
          aria-hidden
          className={`records-sort ${sorted ? "is-visible" : ""}`}
          style={{ transform: sorted && sort?.dir === -1 ? "rotate(180deg)" : undefined }}
        >
          <Icon size={12}><path d="M12 5v14M5 12l7 7 7-7" /></Icon>
        </span>
      )}
    </>
  );
  const buttonClass = `records-header-button${end ? " flex-row-reverse" : ""}`;
  return (
    <th
      className={`records-header-cell${sticky ? " records-sticky-cell" : ""}`}
      aria-sort={sorted ? (sort?.dir === 1 ? "ascending" : "descending") : undefined}
      scope="col"
    >
      <div className="flex items-center">
        {leading && <span className="flex shrink-0 items-center pl-1.5">{leading}</span>}
        {sortable ? (
          <button type="button" className={buttonClass} onClick={() => onSort(column.key)}>
            {content}
          </button>
        ) : (
          <div className={buttonClass}>{content}</div>
        )}
      </div>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.header} column`}
        className={`records-resize-handle ${resizing ? "is-resizing" : ""}`}
        onPointerDown={onResizeStart}
      />
    </th>
  );
}

function isMissing(value: SortValue): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

/** ascending order for `dir` 1, descending for -1; missing values always last */
function compare(a: SortValue, b: SortValue, dir: 1 | -1): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return order * dir;
}

/* ── table ─────────────────────────────────────────────── */

export default function RecordsTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  selectable = false,
  onSelectionChange,
  initialSort = null,
  fill = false,
}: {
  /** accessible name of the table */
  label: string;
  columns: RecordsColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** row numbers with hover checkboxes, plus a select-all in the first header */
  selectable?: boolean;
  onSelectionChange?: (keys: string[]) => void;
  initialSort?: RecordsSort | null;
  fill?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<RecordsSort | null>(initialSort);
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const columnSignature = columns.map((column) => column.key).join("|");

  /* Let the table lay out once, then capture the rendered widths before paint.
   * From then on every column is explicit, so a resize changes only the dragged
   * column and the table's total width. Re-measured when the column set changes. */
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
    const measured: Record<string, number> = {};
    columns.forEach((column, index) => {
      const width = headers[index]?.getBoundingClientRect().width ?? 0;
      measured[column.key] = Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, column.width ?? width);
    });
    setWidths(measured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSignature]);

  const visibleRows = useMemo(() => {
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((a, b) => compare(value(a), value(b), sort.dir));
  }, [rows, columns, sort]);

  if (rows.length === 0 || columns.length === 0) return null;

  const keys = visibleRows.map(rowKey);
  const allSelected = keys.length > 0 && keys.every((key) => selected.has(key));
  const partiallySelected = !allSelected && keys.some((key) => selected.has(key));

  const commitSelection = (next: Set<string>) => {
    setSelected(next);
    onSelectionChange?.([...next]);
  };
  const toggleRow = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commitSelection(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) keys.forEach((key) => next.delete(key));
    else keys.forEach((key) => next.add(key));
    commitSelection(next);
  };
  const toggleSort = (key: string) =>
    setSort((current) => (current?.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const widthOf = (column: RecordsColumn<Row>) =>
    widths?.[column.key] ?? column.width ?? column.minWidth ?? DEFAULT_MIN_WIDTH;

  const startColumnResize = (column: RecordsColumn<Row>) => (event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const minWidth = column.minWidth ?? DEFAULT_MIN_WIDTH;
    const startX = event.clientX;
    const startWidth = widthOf(column);
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setResizing(column.key);

    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      setWidths((current) => ({ ...(current ?? {}), [column.key]: width }));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      setResizing(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const tableWidth = columns.reduce((sum, column) => sum + widthOf(column), 0);
  const hasFooter = columns.some((column) => column.footer !== undefined);
  const cellClass = (column: RecordsColumn<Row>, index: number) =>
    [
      "records-cell",
      index === 0 ? "records-sticky-cell" : "",
      index === 0 && selectable ? "records-company-cell" : "",
      column.align === "end" ? "text-right" : "",
      column.numeric ? "tabular-nums" : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div className={`records-shell${fill ? " is-fill" : ""}`}>
      <div className="records-scroll" tabIndex={0} role="region" aria-label={label}>
        <table
          ref={tableRef}
          className="records-table"
          aria-label={label}
          style={{ width: widths ? tableWidth : "100%", minWidth: tableWidth }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: widthOf(column) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <HeaderCell
                  key={column.key}
                  column={column}
                  sort={sort}
                  onSort={toggleSort}
                  onResizeStart={startColumnResize(column)}
                  resizing={resizing === column.key}
                  sticky={index === 0}
                  leading={
                    index === 0 && selectable ? (
                      <Checkbox checked={allSelected} mixed={partiallySelected} onChange={toggleAll} label="Select all rows" />
                    ) : undefined
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => {
              const key = keys[rowIndex];
              const selectedRow = selected.has(key);
              return (
                <tr key={key} className={`records-row ${selectedRow ? "is-selected" : ""}`} aria-selected={selectable ? selectedRow : undefined}>
                  {columns.map((column, index) => (
                    <td key={column.key} className={cellClass(column, index)}>
                      {index === 0 && selectable && (
                        <>
                          <span className="records-rownum">{rowIndex + 1}</span>
                          <Checkbox checked={selectedRow} onChange={() => toggleRow(key)} label={`Select row ${rowIndex + 1}`} />
                        </>
                      )}
                      {column.cell(row, rowIndex)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {hasFooter && (
            <tfoot>
              <tr className="records-calculation-row">
                {columns.map((column, index) => (
                  <td key={column.key} className={cellClass(column, index).replace(" records-company-cell", "")}>
                    {column.footer !== undefined && <span className="records-footer-value">{column.footer}</span>}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
