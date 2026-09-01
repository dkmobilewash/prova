import { redirect } from "next/navigation";

/** /jobs has no page of its own — the job list lives on the dashboard,
 * which is also where the nav's "Jobs & Estimates" points.
 *
 * It existed only as /jobs/[id] and /jobs/new, so typing the bare URL got
 * a raw Next.js 404 rather than anything belonging to this app. Nothing in
 * the product linked there, which is exactly why nobody found it until
 * somebody walked the app by typing URLs instead of clicking.
 *
 * A redirect rather than a duplicate list: two job lists would be two
 * things to keep agreeing, and this app has paid for that mistake more
 * than once.
 */
export default function JobsIndexPage() {
  redirect("/dashboard");
}
