import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadTaskList } from "@/lib/agents/tasks";

export const dynamic = "force-dynamic";

/**
 * The top bar's Tasks list, refreshed. The layout loads it, but Next keeps
 * a shared layout across client-side navigations rather than re-rendering
 * it, so a run that finished while you worked would keep spinning there.
 * The Tasks item asks here instead — only while its list is open or a run
 * is going, every 30s, and not while the tab is hidden
 * (components/shell/TasksMenu.tsx). Two indexed reads, no page render.
 *
 * MANAGE_ESTIMATING, the gate on /ai and on the item itself. The company
 * comes ONLY from the session. 401 for no session rather than a redirect, so
 * the caller is never handed a sign-in page to parse.
 */
export async function GET() {
  const context = await requireApiContext();
  if (!context) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!can({ role: context.role, jobFunction: context.jobFunction }, "MANAGE_ESTIMATING")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  try {
    return NextResponse.json(await loadTaskList(context.companyId));
  } catch (error) {
    // Logged, not returned — a thrown message can name a column or a host.
    console.error("[tasks] /api/agents/tasks failed", error);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }
}
