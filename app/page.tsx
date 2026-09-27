import FinanceShell from "@/components/finance/FinanceShell";

/* The product starts with a question; the analysis workspace itself is not in
 * this build. This page renders the Beautiful UI shell with the one thing the
 * backend can already tell us: its real capabilities. */
export default function HomePage() {
  return <FinanceShell />;
}
