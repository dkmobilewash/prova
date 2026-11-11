/**
 * What "Report a problem" sends besides the person's words: the page's last console
 * errors and its last clicks and navigations, newest last. Recorded in memory in
 * this tab from the moment the page that has the button loads; nothing is stored or
 * sent until the person presses Send (`ReportProblemButton`).
 *
 * Only labels are kept for a click (a data attribute, an aria-label or a few words
 * of the button's own text), never what was typed into a field.
 */
const KEEP = 20;
const errors: string[] = [];
const actions: string[] = [];
let installed = false;
let lastPath = "";

/** The browser's own time of day, HH:MM:SS, to order the lines: not a calendar day. */
const stamp = () => new Date().toTimeString().slice(0, 8);
const push = (list: string[], line: string) => {
  list.push(`${stamp()} ${line.replace(/\s+/g, " ").slice(0, 280)}`);
  if (list.length > KEEP) list.shift();
};
const text = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
const notePath = () => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    push(actions, `on ${lastPath}`);
  }
};

function labelOf(el: Element): string {
  const data = [...el.attributes].find((a) => a.name.startsWith("data-") && a.name !== "data-state" && a.value.length < 60);
  const aria = el.getAttribute("aria-label");
  const own = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? "" : (el.textContent ?? "").trim().slice(0, 40);
  return [el.tagName.toLowerCase(), data ? `[${data.name}=${data.value}]` : "", aria ? `"${aria.slice(0, 40)}"` : own ? `"${own}"` : ""].filter(Boolean).join(" ");
}

export function installProblemReportBuffer(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  notePath();
  window.addEventListener("error", (event) => push(errors, `error ${event.message}${event.filename ? ` at ${event.filename}:${event.lineno}` : ""}`));
  window.addEventListener("unhandledrejection", (event) => push(errors, `unhandled rejection ${text(event.reason)}`));
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push(errors, `console.error ${args.map(text).join(" ")}`);
    original(...args);
  };
  document.addEventListener(
    "click",
    (event) => {
      notePath();
      const target = event.target instanceof Element ? event.target.closest("button, a, select, [role=button], input[type=checkbox], input[type=radio]") : null;
      if (target) push(actions, `click ${labelOf(target)}`);
    },
    true,
  );
  window.addEventListener("popstate", notePath);
}

export function problemReportLines(): { consoleErrors: string[]; actions: string[] } {
  notePath();
  return { consoleErrors: [...errors], actions: [...actions] };
}
