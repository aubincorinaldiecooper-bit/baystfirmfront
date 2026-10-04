import type { NextRequest } from "next/server";
import { proxyMarketsRequest } from "@/lib/server/baystProxy";

/* GET passthrough to the Baystfirm crypto backend's read routes; the live
 * stream has its own handler under markets/stream. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyMarketsRequest(request, path);
}
