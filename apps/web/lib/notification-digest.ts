/**
 * Turning notices into the one email that goes out.
 *
 * **THE RULE THIS FILE EXISTS TO HOLD: nothing here invents a sentence
 * about urgency.** Every line describing a situation is `alert.title` and
 * `alert.detail`, composed by `lib/alerts.ts` from the record itself. This
 * file adds envelope and arrangement — a subject, an order, a link — and
 * nothing else.
 *
 * That is not tidiness. An undated COI and a job forecast over contract
 * value are both STANDING with a null date, and nothing in the `Alert`
 * shape distinguishes them. If this file generated a line from the rung it
 * fired on, it would email somebody that their certificate has EXPIRED
 * when the truth is that nobody ever typed a date in. `renewalTiming`
 * already says "no date recorded" for that case and the right words for
 * every other one. Passing them through is the only way to stay correct
 * about a distinction this module cannot see.
 *
 * One email per person per run, never one per alert. Three separate emails
 * about three licences is the nagging this whole feature is built to
 * avoid, arriving faster.
 */

import type { DueNotice, Rung } from "@/lib/notification-milestones";

/** How a rung reads to a person — about TIMING only, and vaguely at that.
 *
 * Deliberately carries no number. "Approaching" is sixty days for a
 * licence and thirty for a COI, because their horizons differ; this module
 * cannot know which and must not guess. The precise words are already in
 * `alert.detail` — "due in 7 days", "expired 40 days ago", "no date
 * recorded" — written by the engine, which does know.
 *
 * And none of these says "expired". Half the kinds that reach here are not
 * documents that can expire: a job forecast over budget, a backcharge
 * unanswered, an apprentice ratio breached last Tuesday.
 */
export function rungLabel(rung: Rung): string {
  switch (rung) {
    case "due":
      return "Now due";
    case "week":
      return "This week";
    case "approaching":
      return "Coming up";
    default:
      return "Needs attention";
  }
}

/** The subject line for a run.
 *
 * Names the count and the most urgent thing in it. A subject that just
 * says "Prova alerts" is one people stop opening, and a subject that names
 * a single item when there are nine is one they act on incompletely.
 *
 * Returns "" for an empty run, which callers must treat as "send nothing"
 * — there is no such thing as an empty digest worth delivering.
 */
export function digestSubject(notices: DueNotice[]): string {
  if (notices.length === 0) return "";

  const [first] = notices;
  if (notices.length === 1) return first.alert.title;

  const overdue = notices.filter((n) => n.alert.severity === "OVERDUE").length;
  const rest = notices.length - 1;
  const others = `${rest} other${rest === 1 ? "" : "s"}`;

  return overdue > 0
    ? `${first.alert.title}, and ${others} (${overdue} overdue)`
    : `${first.alert.title}, and ${others}`;
}

export type DigestLine = {
  label: string;
  title: string;
  detail: string;
  href: string;
};

/** The body, as data. Rendered by the caller so the same digest can be
 * plain text now and a template later without this logic moving. */
export function digestLines(notices: DueNotice[]): DigestLine[] {
  return notices.map((notice) => ({
    label: rungLabel(notice.rung),
    title: notice.alert.title,
    detail: notice.alert.detail,
    href: notice.alert.href,
  }));
}

/** Plain text, because it is the format that renders identically in every
 * client and cannot break. `baseUrl` is the app's own origin — the links
 * have to be absolute to survive leaving the app, and building them from a
 * request would make a digest sent by a scheduled run point at whatever
 * host happened to trigger it. */
export function digestBody(notices: DueNotice[], baseUrl: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  const lines = digestLines(notices).map(
    (line) =>
      `${line.label}: ${line.title}\n${line.detail}\n${origin}${line.href}`,
  );

  return [
    notices.length === 1
      ? "One thing needs your attention:"
      : `${notices.length} things need your attention:`,
    "",
    lines.join("\n\n"),
    "",
    "—",
    `You are getting this because you can see these on ${origin}/alerts.`,
    "Dealing with the thing itself stops the reminders — they are worked out",
    "from your records every time, not from a list somebody has to maintain.",
  ].join("\n");
}
