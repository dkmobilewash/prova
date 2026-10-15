import { handlePrefillEvent } from "@/lib/prefill-event";
import { clientIp, rateStore } from "@/lib/rate-limit";

/** POST: log "prefill_link_opened" with the link's ref. The rules are in
 * lib/prefill-event.ts; this file only adapts HTTP to them. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ref?: unknown; state?: unknown };
  const status = await handlePrefillEvent(body, { rate: await rateStore(), ip: clientIp(request.headers) });
  return new Response(null, { status });
}
