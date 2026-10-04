import type { NextRequest } from "next/server";
import { proxyMarketsStream } from "@/lib/server/baystProxy";

/* Streaming relay of the Baystfirm live event stream (server-sent events).
 * Dynamic and on the Node runtime so the body is piped without buffering. */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  return proxyMarketsStream(request);
}
