"use client";

/* Shared state of the workspace shell: the history list (so a new or finished
 * analysis refreshes the sidebar), the backend capabilities (loaded once) and
 * the mobile sidebar toggle. */

import { createContext, useContext } from "react";
import type { UseCapabilitiesResult } from "@/lib/api/capabilities";
import type { UseAnalysisHistoryResult } from "@/lib/api/history";

export interface WorkspaceValue {
  history: UseAnalysisHistoryResult;
  capabilities: UseCapabilitiesResult;
  /** Open the history drawer (narrow screens). */
  openSidebar: () => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside the workspace shell.");
  return value;
}
