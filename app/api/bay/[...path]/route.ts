import type { NextRequest } from "next/server";
import { proxyRequest } from "@/lib/server/proxy";

/* GET/POST passthrough to the BayAnalytics API for every contract route
 * except the event stream, which has its own streaming handler under
 * analyses/[id]/events. The backend key is attached here, on the server. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}
