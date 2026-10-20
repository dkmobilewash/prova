import { clientIp, rateStore } from "@/lib/rate-limit";
import { handleTicketRequest, type TicketRequestBody } from "@/lib/tm-ticket-request";

/** POST: make the T&M ticket PDF and email it to the foreman and the super.
 * The rules are in lib/tm-ticket-request.ts; this file only adapts HTTP to
 * them, exactly as app/api/change-order/route.ts does. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: TicketRequestBody;
  try {
    body = (await request.json()) as TicketRequestBody;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }
  const result = await handleTicketRequest(body ?? {}, {
    env: process.env,
    rate: await rateStore(),
    ip: clientIp(request.headers),
  });
  if (result.kind === "error") {
    return Response.json({ error: result.error, fieldErrors: result.fieldErrors }, { status: result.status });
  }
  // JSON only, never the PDF.
  return Response.json({ sentTo: result.to, notConfigured: result.notConfigured }, { headers: { "cache-control": "no-store" } });
}
