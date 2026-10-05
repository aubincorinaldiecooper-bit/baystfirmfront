import { redirect } from "next/navigation";
import { marketsRedirect } from "@/lib/navigation/legacy";

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ instrument?: string | string[] }>;
}) {
  const { instrument } = await searchParams;
  redirect(marketsRedirect(instrument));
}
