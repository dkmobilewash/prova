import { advancePlanIngest } from "@/lib/actions/planIngest";

/**
 * ── ONE SLICE OF A PLAN READING, OVER A PLAIN REQUEST ──
 *
 * The panel used to call `advancePlanIngest` as a Server Action, and a page's
 * Server Actions run one at a time: a wall-legend slice waiting on a model call
 * (tens of seconds) held up every other action from that tab. On Topeka (137
 * sheets) "Read the title blocks", pressed while the legend read, waited 47 s
 * for the legend's slice to come back. A route request is not queued behind
 * them. Same function, same checks (`advancePlanIngest` asks who is calling and
 * what they may see); only the transport differs.
 */
export async function POST(request: Request): Promise<Response> {
  let jobId = "";
  try {
    const body = (await request.json()) as { jobId?: unknown };
    jobId = typeof body.jobId === "string" ? body.jobId : "";
  } catch {
    jobId = "";
  }
  if (jobId === "") return Response.json({ ok: false, error: "Which reading? Reload the page." }, { status: 400 });
  return Response.json(await advancePlanIngest(jobId));
}
