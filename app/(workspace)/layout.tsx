import type { ReactNode } from "react";
import FinanceShell from "@/components/finance/FinanceShell";

/* Every workspace page shares the shell, so the history sidebar and the
 * capabilities stay loaded while moving between the start page and analyses. */
export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <FinanceShell>{children}</FinanceShell>;
}
