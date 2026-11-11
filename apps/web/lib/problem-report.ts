/**
 * ── "REPORT A PROBLEM": WHAT A REPORT MAY CARRY, AND HOW IT READS ──
 *
 * Pure and import-free, so the button (client) and the action (server) share it
 * and the unit suite runs every branch.
 *
 * NEVER ANOTHER COMPANY'S DATA. The browser sends only what its own screen
 * showed (its console errors, its own clicks, a picture of its own plan view);
 * the job and the sheet are looked up by the action scoped to the reporter's
 * company, never taken from the client. And what the browser sends is cut down
 * here before it is mailed: query strings, tokens and keys are removed, because
 * a console error can quote a signed URL or a session token.
 */

export const MAX_REPORT_MESSAGE = 2000;
export const MAX_REPORT_LINES = 20;
export const MAX_REPORT_LINE = 300;
/** A Server Action body is capped at 1 MB; a JPEG of the plan view under this leaves room. */
export const MAX_SCREENSHOT_BYTES = 600_000;

/** Removes what must never be mailed from one line of browser text. */
export function redactLine(raw: string): string {
  return (
    raw
      // A query string or fragment on any URL: signed blob links, redirect targets, ids nobody chose to send.
      .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, "$1?…")
      // JWTs (a Clerk session is one), bearer tokens and secret-looking keys.
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[token removed]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [removed]")
      .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, "[key removed]")
      .replace(/\b(vercel_blob_rw|whsec|re)_[A-Za-z0-9_]{8,}/g, "[key removed]")
      // Control characters, which a mail client renders as garbage.
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
      .slice(0, MAX_REPORT_LINE)
  );
}

/** The browser's lines, untrusted: strings only, the newest MAX_REPORT_LINES, each redacted and cut. */
export function cleanLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((line): line is string => typeof line === "string" && line.trim() !== "")
    .slice(-MAX_REPORT_LINES)
    .map((line) => redactLine(line.trim()));
}

/** A JPEG data URL from the browser, as bytes, or why it is left out. Only a JPEG, only so big. */
export function screenshotBytes(raw: unknown): { ok: true; bytes: Buffer } | { ok: false; why: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: false, why: "no screenshot (this page has no plan view)" };
  if (typeof raw !== "string" || !raw.startsWith("data:image/jpeg;base64,")) return { ok: false, why: "the screenshot was not a JPEG, so it was left out" };
  const bytes = Buffer.from(raw.slice("data:image/jpeg;base64,".length), "base64");
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { ok: false, why: "the screenshot was not a JPEG, so it was left out" };
  if (bytes.length > MAX_SCREENSHOT_BYTES) return { ok: false, why: "the screenshot was too large, so it was left out" };
  return { ok: true, bytes };
}

/** The candidate job id a page path names: `/jobs/<id>…` or the workspace's `/takeoff/<id>…`. Only a candidate. */
export function jobIdFromReportPath(path: string): string | null {
  const match = path.match(/^\/(?:jobs|takeoff)\/([A-Za-z0-9_-]+)/);
  return match && match[1] !== "new" ? match[1]! : null;
}

export function reportSubject(input: { companyName: string; pagePath: string | null }): string {
  return ["Problem report", input.companyName, input.pagePath ?? "page not recorded"].join(" — ");
}

/** The mail: what they typed, then the context, each line saying where it came from. */
export function reportBody(input: {
  message: string;
  companyName: string;
  pagePath: string | null;
  jobName: string | null;
  sheet: string | null;
  reportedBy: { name: string | null; email: string };
  consoleErrors: string[];
  actions: string[];
  screenshot: string;
  userAgent: string | null;
}): string {
  const lines = [
    input.message.trim() || "(nothing typed)",
    "",
    "---",
    `Company: ${input.companyName}`,
    `Page: ${input.pagePath ?? "not recorded"}`,
  ];
  if (input.jobName) lines.push(`Job: ${input.jobName}`);
  if (input.sheet) lines.push(`Sheet: ${input.sheet}`);
  lines.push(`Reported by: ${input.reportedBy.name ? `${input.reportedBy.name} <${input.reportedBy.email}>` : input.reportedBy.email}`);
  lines.push(`Screenshot: ${input.screenshot}`);
  if (input.userAgent) lines.push(`Browser: ${redactLine(input.userAgent)}`);
  lines.push("", `Console errors (${input.consoleErrors.length}, newest last):`, ...(input.consoleErrors.length ? input.consoleErrors.map((l) => `  ${l}`) : ["  none"]));
  lines.push("", `Recent actions (${input.actions.length}, newest last):`, ...(input.actions.length ? input.actions.map((l) => `  ${l}`) : ["  none"]));
  return lines.join("\n");
}

/** The one line for #prova-build: who, where, what they said. The full report is the email. */
export function reportSlackText(input: { companyName: string; jobName: string | null; sheet: string | null; pagePath: string | null; message: string; consoleErrors: number }): string {
  const where = [input.jobName, input.sheet ? `sheet ${input.sheet}` : null, input.pagePath].filter(Boolean).join(" · ");
  const said = input.message.trim().replace(/\s+/g, " ").slice(0, 200) || "(nothing typed)";
  return `🐞 Problem report from ${input.companyName}${where ? ` — ${where}` : ""}: “${said}” (${input.consoleErrors} console error${input.consoleErrors === 1 ? "" : "s"}; full report in the support inbox)`;
}
