import { redirect } from "next/navigation";

/**
 * Estimating used to be its own page. It isn't any more — a job starts as an
 * estimate, so both live on the jobs list, filtered.
 *
 * This route stays as a redirect rather than being deleted: it shipped, so
 * it may be bookmarked or linked from Slack, and a 404 would read as the
 * feature having been removed rather than moved.
 */
export default function EstimatingRedirect() {
  redirect("/dashboard?status=ESTIMATE");
}
