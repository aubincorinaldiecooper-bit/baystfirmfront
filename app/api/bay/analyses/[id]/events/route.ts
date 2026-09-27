import type { NextRequest } from "next/server";
import { proxyEventStream } from "@/lib/server/proxy";

/* Streaming relay for GET /analyses/{id}/events. Must stay dynamic and on the
 * Node runtime so the upstream body is piped through as a ReadableStream with
 * no buffering; see lib/server/proxy.ts. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyEventStream(request, id);
}
