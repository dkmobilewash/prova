import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skipDir } from "../censusSkipDirs";

/**
 * ── ONLY THE SAVE BUTTON WRITES A LABEL FILE ──
 *
 * A labelling session's work lives in `~/Claude Folder/takeoff/labels`, and
 * those files are the answer keys and the training data both. Chrome asked the
 * fair question: the page header says "Saved as you go", so does anything
 * write a label file on its own?
 *
 * It does not, and this is here so that stays true. "Saved as you go" is the
 * workspace's own autosave of MEASUREMENTS to the database — a different kind
 * of row entirely — and the one GET of `/api/takeoff/labels` outside the panel
 * is the restore reading a saved sheet back.
 *
 * What this would catch: an autosave effect, a beforeunload handler or a
 * keystroke quietly POSTing a partial review over a finished one. The route
 * REPLACES a sheet's labels, so a write nobody asked for is the shape that
 * costs a morning — and it is the shape this directory keeps paying for in
 * other forms.
 */
const WEB = new URL("../..", import.meta.url).pathname;
const ROOTS = ["components", "app", "lib"];

/** Every POST to the labels route, with the file it is in. */
function labelWrites(): { file: string; line: number }[] {
  const out: { file: string; line: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skipDir(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      // A test may name the route freely; it is the app's own code that must
      // not write behind the reviewer's back.
      if (/\.test\.tsx?$|\.eval\.ts$|\.dbtest\.ts$/.test(entry)) continue;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((text, at) => {
        if (!text.includes("/api/takeoff/labels")) return;
        // The fetch's method sits within a few lines of the url in every
        // caller here, so the window is read rather than the single line.
        const near = lines.slice(at, at + 8).join("\n");
        if (/method:\s*"POST"/.test(near)) out.push({ file: full.slice(WEB.length), line: at + 1 });
      });
    }
  };
  for (const root of ROOTS) walk(join(WEB, root));
  return out;
}

describe("who may write a label file", () => {
  it("is the answer-key panel's save, and nothing else", () => {
    const writes = labelWrites();
    // A SIZE assertion against something that cannot drift with the pattern:
    // a regex that matched nothing would otherwise pass every check below,
    // since nothing is ever missing from an empty list.
    expect(
      writes.length,
      "no POST to the labels route was found at all — the pattern has stopped matching, not the writers stopped writing",
    ).toBeGreaterThan(0);
    expect(writes.map((one) => one.file)).toEqual(["components/AnswerKeyPanel.tsx"]);
  });

  it("is reached only from the save handler, not from an effect", () => {
    const source = readFileSync(join(WEB, "components/AnswerKeyPanel.tsx"), "utf8");
    const at = source.indexOf('fetch("/api/takeoff/labels"');
    expect(at, "the panel's own write was not found").toBeGreaterThan(0);
    // The nearest enclosing declaration above the call. `saveLabels` is the
    // Save button's handler; a `useEffect` here would mean the page writes on
    // its own, which is the thing being ruled out.
    const before = source.slice(0, at);
    const lastFn = Math.max(
      before.lastIndexOf("async function saveLabels"),
      before.lastIndexOf("useEffect("),
    );
    expect(before.lastIndexOf("async function saveLabels")).toBe(lastFn);
  });

  it("reads a saved sheet with a GET, which is how the restore works", () => {
    // Stated as a case rather than left implicit: the workspace DOES talk to
    // this route, and a reader who finds that call should see immediately
    // that it takes nothing away.
    const source = readFileSync(join(WEB, "components/TakeoffWorkspace.tsx"), "utf8");
    const at = source.indexOf("/api/takeoff/labels");
    expect(at).toBeGreaterThan(0);
    const near = source.slice(at, at + 400);
    expect(near).not.toMatch(/method:\s*"POST"/);
    expect(near).toContain("no-store");
  });
});
