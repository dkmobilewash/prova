import { handleNotifyRequest, type NotifyBody } from "@/lib/notify-request";
import { clientIp, rateStore } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400 });
  }
  const result = await handleNotifyRequest(body, { env: process.env, rate: await rateStore(), ip: clientIp(request.headers) });
  return Response.json(result.error ? { error: result.error } : { ok: true }, { status: result.status });
}
