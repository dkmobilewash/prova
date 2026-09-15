/**
 * Asking a human for help — the part that is pure text.
 *
 * The founding-partner one-pager promises "a compliance question at 6 AM
 * before a certified payroll deadline — you get an answer, not a queue."
 * Nothing in the product delivered on that sentence: there was no way to
 * reach us from inside the app at all. This is the modest version of it.
 *
 * DELIBERATELY IMPORT-FREE, and that is load-bearing rather than tidy.
 * `HelpButton` is a "use client" component and needs `helpSubject` and
 * `helpMailtoHref` in the browser, because the page the person was on is
 * only known client-side. `@prova/integrations` is a barrel whose entry
 * pulls in the QuickBooks and Anthropic clients, so importing one helper
 * out of it here would drag all of that into the client bundle. Everything
 * that reads configuration lives in `help-config.ts` instead, which only
 * server code imports.
 *
 * The other reason it is pure: these functions are the only thing between
 * a page path the browser handed us and an email subject line, and between
 * a person's typing and a `mailto:` URL. That is exactly the kind of
 * formatting this repo tests by executing it with real inputs.
 */

/** How long a question may be.
 *
 * Not a product opinion about how much detail helps — it is the cap that
 * stops a paste of an entire WH-347 becoming the subject of a support
 * thread nobody can read. Generous enough that nobody writing a real
 * question will meet it. */
export const MAX_HELP_MESSAGE_LENGTH = 4000;

/**
 * What the help panel can actually offer, which is a property of the
 * install rather than of the person.
 *
 * Three states rather than "works / broken", because the middle one is the
 * normal case rather than an edge: this app sends mail from the
 * CONTRACTOR'S own verified domain and deliberately has no shared sender
 * (see `readEmailConfig` — sending as the vendor is what puts a quote in a
 * GC's spam folder). On day one a new customer has no Resend key and no
 * verified from-address, so the server cannot send on their behalf and a
 * `mailto:` from their own mail client is the honest path. Pretending
 * otherwise would mean a Send button that always fails at the exact moment
 * somebody needs help most.
 */
export type HelpChannel =
  /** We can send it ourselves and record it in the message log. */
  | { kind: "send"; to: string }
  /** They send it from their own mail app; we prefill the subject only. */
  | { kind: "mailto"; to: string; reason: string }
  /** Nothing here can reach anybody, and the panel says so plainly. */
  | { kind: "unavailable"; reason: string };

/**
 * Decides which of the three it is from the two facts that settle it.
 *
 * Takes both facts as arguments rather than reading the environment, so
 * every combination is executed in the unit suite — including the two that
 * are hard to reach on a laptop.
 */
export function helpChannel(input: {
  /** `readSupportAddress` in help-config.ts, already validated. */
  supportAddress: string | null;
  /** `emailSetupProblem()` — null when this install can send mail. */
  emailProblem: string | null;
}): HelpChannel {
  if (!input.supportAddress) {
    return {
      kind: "unavailable",
      reason:
        "This install has no support address, so nothing here can reach us yet. " +
        "It needs SUPPORT_EMAIL set to the address that should receive these.",
    };
  }
  if (input.emailProblem) {
    return {
      kind: "mailto",
      to: input.supportAddress,
      reason:
        `${input.emailProblem} So we can't do the sending for you — the link below ` +
        `opens your own email app instead, which reaches exactly the same place.`,
    };
  }
  return { kind: "send", to: input.supportAddress };
}

/**
 * The page they were on, if what the browser handed us really is one.
 *
 * This string ends up in an email subject and an email body, so it is
 * treated as untrusted: `usePathname()` is where it comes from today, and
 * the action will accept whatever is posted to it regardless of what the
 * panel sent. A newline here would be a header-injection attempt in any
 * mail transport naive enough to concatenate; a `//host` or a `scheme:`
 * would put a link to somewhere else in a message that appears to describe
 * our own app.
 *
 * Returns null rather than a cleaned-up guess. "We don't know which page"
 * is a true statement; a path with the dangerous half removed is a
 * plausible-looking fiction.
 */
export function safePagePath(raw: string): string | null {
  const trimmed = raw.trim();
  // A query or fragment is not context worth mailing and can carry ids
  // nobody chose to send. usePathname never supplies one.
  const path = trimmed.split(/[?#]/)[0];
  if (path.length === 0 || path.length > 200) return null;
  if (!path.startsWith("/")) return null;
  // Protocol-relative: `//evil.example.com/jobs` is a different origin.
  if (path.startsWith("//")) return null;
  // Everything a Next.js route segment can contain and nothing else. No
  // whitespace, no control characters, no colon — which is what rules out
  // `javascript:` and every other scheme.
  if (!/^\/[A-Za-z0-9/_\-.~%@()[\]]*$/.test(path)) return null;
  return path;
}

/**
 * The job a job page belongs to, so the request can be filed against it.
 *
 * The id is only a candidate: the action looks it up scoped to the asker's
 * own company and ignores it if it is not theirs. Nothing here trusts it,
 * and nothing here accepts a job id from the client directly — the only
 * job that can be attached is the one named by the page they chose to send.
 */
export function jobIdFromPagePath(path: string): string | null {
  const match = path.match(/^\/jobs\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  // `/jobs/new` is a route, not a job. Excluded here so the lookup never
  // happens rather than happening and finding nothing.
  return match[1] === "new" ? null : match[1];
}

/**
 * The subject line: what it is, whose it is, where they were.
 *
 * Company and page are the two things that let us answer without a round
 * trip, and they are the two things the assignment permits in a prefilled
 * `mailto:` — so the same subject serves both channels rather than the
 * fallback quietly carrying less.
 */
export function helpSubject(input: { companyName: string; pagePath: string | null }): string {
  const parts = ["Help", input.companyName];
  if (input.pagePath) parts.push(input.pagePath);
  return parts.join(" — ");
}

/**
 * The email body: their question, then exactly the four things the panel
 * told them it would include. Nothing else.
 *
 * The job line is ABSENT rather than empty when there is no job, because
 * "Job: none" in a support mail reads as a job that could not be
 * identified, which is a different and wrong story.
 */
export function helpBody(input: {
  message: string;
  companyName: string;
  pagePath: string | null;
  jobName: string | null;
  askedBy: { name: string | null; email: string };
}): string {
  const lines = [
    input.message.trim(),
    "",
    "---",
    `Company: ${input.companyName}`,
    `Page: ${input.pagePath ?? "not recorded"}`,
  ];
  if (input.jobName) lines.push(`Job: ${input.jobName}`);
  lines.push(
    `Asked by: ${input.askedBy.name ? `${input.askedBy.name} <${input.askedBy.email}>` : input.askedBy.email}`,
  );
  return lines.join("\n");
}

/**
 * A `mailto:` carrying the subject and nothing else.
 *
 * NOT the body, deliberately. The body is whatever the person typed — the
 * one part of this most likely to be sensitive — and a URL is the one place
 * this repo will not put user content: it lands in history, in referrers
 * and in whatever a mail client logs. The subject naming the page and the
 * company is what the brief permits, and it is the half that makes the mail
 * answerable anyway.
 */
export function helpMailtoHref(to: string, subject: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Why this question can't be sent, in words that say what to do about it —
 * or null when it is fine.
 *
 * Returned rather than thrown: production redacts a thrown Server Action
 * message to a digest, and "you didn't type anything" is precisely the
 * message a person has to be able to read.
 */
export function helpMessageProblem(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "Type your question first — even one line is enough for us to start on.";
  }
  if (trimmed.length > MAX_HELP_MESSAGE_LENGTH) {
    return (
      `That's ${trimmed.length} characters and the limit is ${MAX_HELP_MESSAGE_LENGTH}. ` +
      `Send the shortest version of the question and we'll ask for the rest.`
    );
  }
  return null;
}
