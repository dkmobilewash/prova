import { clientIp, rateStore } from "@/lib/rate-limit";
import { isPublished, reviewStatus } from "@/lib/statutes/review";
import { handleWaiverRequest, type WaiverRequestBody } from "@/lib/waiver-request";

/** POST: make the PDF (and, the first time, email it). The rules are in
 * lib/waiver-request.ts; this file only adapts HTTP to them. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: WaiverRequestBody;
  try {
    body = (await request.json()) as WaiverRequestBody;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }
  const result = await handleWaiverRequest(body, {
    env: process.env,
    rate: await rateStore(),
    ip: clientIp(request.headers),
    published: (state) => isPublished(state),
    reviewed: (state) => reviewStatus(state).reviewed,
  });
  if (result.kind === "error") {
    return Response.json({ error: result.error, fieldErrors: result.fieldErrors }, { status: result.status });
  }
  return new Response(Buffer.from(result.pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "x-email-status": result.emailStatus,
      "cache-control": "no-store",
    },
  });
}
