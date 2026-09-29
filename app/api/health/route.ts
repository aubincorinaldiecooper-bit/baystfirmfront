import { checkBayReadiness } from "@/lib/server/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return checkBayReadiness();
}
