/* Copied from Beautiful UI (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root. */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names, letting later Tailwind classes win over conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
