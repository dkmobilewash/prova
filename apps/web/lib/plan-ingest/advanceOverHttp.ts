import type { ActionResultWith } from "@/lib/actions/shared";
import type { IngestView } from "./runner";

/** One slice of a reading, asked for over `/api/plan-ingest/advance` (see the route for why not an action). */
export async function advanceOverHttp(jobId: string): Promise<ActionResultWith<IngestView>> {
  try {
    const res = await fetch("/api/plan-ingest/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId }) });
    if (!res.ok && res.status !== 400) return { ok: false, error: "Reading this plan set stopped unexpectedly. Nothing was lost — try again." };
    return (await res.json()) as ActionResultWith<IngestView>;
  } catch {
    return { ok: false, error: "Reading this plan set stopped unexpectedly. Nothing was lost — try again." };
  }
}
