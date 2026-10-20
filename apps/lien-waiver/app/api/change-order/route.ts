import { handleChangeOrderRequest, type ChangeOrderRequestBody } from "@/lib/change-order-request";
import { clientIp, rateStore } from "@/lib/rate-limit";

/** POST: make the change order request PDF and email it. The rules are in
 * lib/change-order-request.ts; this file only adapts HTTP to them, exactly
 * as app/api/waiver/route.ts does. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: ChangeOrderRequestBody;
  try {
    body = (await request.json()) as ChangeOrderRequestBody;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }
  const result = await handleChangeOrderRequest(body ?? {}, {
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
