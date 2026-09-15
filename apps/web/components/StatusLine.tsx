import type { StatusReport } from "@/lib/status-sentences";

/**
 * One sentence at the top of a list page, which only raises its voice when
 * something is wrong (#241, redline item 06).
 *
 * This replaces the three-tile stat grid those pages used to open with. On
 * a normal day most tiles read 0 in the same size and weight as a real
 * alert, so colour was spent on nothing and the one figure that mattered
 * did not register. The rule now: the quiet state is one plain sentence
 * in the page's body colour, and red or amber appear ONLY for money or a
 * deadline at risk, never for a count. What counts as at risk is decided
 * per page in lib/status-sentences.ts, where it is a pure function with
 * the exact wording pinned.
 *
 * `data-status` carries the tone so a click-through can assert "this page
 * is quiet" without reading colours.
 */
export function StatusLine({ report }: { report: StatusReport }) {
  if (report.problems.length === 0) {
    return (
      <p data-status="quiet" className="mb-4 text-sm text-slate-400">
        {report.quiet}
      </p>
    );
  }

  const tone = report.problems.some((p) => p.tone === "red") ? "red" : "amber";
  const box =
    tone === "red"
      ? "border-red-500 bg-red-500/10 text-red-100"
      : "border-amber-500 bg-amber-500/10 text-amber-100";

  return (
    <div role="status" data-status={tone} className={`mb-4 rounded-md border-l-4 px-4 py-3 text-sm ${box}`}>
      {report.problems.map((problem) => (
        <p key={problem.text} className={problem.tone === "red" ? "font-medium" : ""}>
          {problem.text}
        </p>
      ))}
    </div>
  );
}
