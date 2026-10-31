import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── EVERY HOST OF THE VIEWER THAT KNOWS A SHEET IS A SCAN HANDS IT THE SCAN'S LINES ──
 *
 * `TakeoffPlanViewer` takes two props for a scanned sheet: `scannedPages`
 * (which pages are scans — shows Read this sheet) and `rasterByPage` (what
 * the RASTER stage read off them — what Find the walls uses instead of the
 * file's strokes, of which a scan has none). The takeoff page passed both.
 * `TakeoffWorkspace` passed the first and not the second, so in the
 * workspace — the answer-key host — Find the walls on a scanned sheet read
 * the PDF, found no strokes, and offered nothing, twice, on sheets whose
 * raster rows held four thousand lines each. Nothing failed: a missing prop
 * is its default, and the default is "no raster".
 *
 * So: a render of the viewer that passes `scannedPages` must pass
 * `rasterByPage` too. Read from source with comments stripped (the viewer
 * and the workspace both describe these props in prose), with the set of
 * hosts counted against a second expression so a renamed component fails
 * loudly rather than parsing to nothing.
 */
const ROOTS = ["app", "components"].map((d) => resolve(process.cwd(), d));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

/** Each `<TakeoffPlanViewer …>` render in a file: the text from the tag to its closing `>`. */
function renders(code: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = code.indexOf("<TakeoffPlanViewer", at);
    if (open === -1) return out;
    let depth = 0;
    let i = open;
    for (; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(code.slice(open, i));
    at = i;
  }
}

describe("the viewer's hosts and a scanned sheet", () => {
  const files = ROOTS.flatMap((root) => walk(root));
  const hosts = files.map((file) => ({ file, code: stripComments(readFileSync(file, "utf8")) })).filter((f) => f.code.includes("<TakeoffPlanViewer"));

  it("finds the hosts (the control: a renamed component would make every assertion below vacuous)", () => {
    const named = files.filter((file) => /import\s+\{[^}]*\bTakeoffPlanViewer\b[^}]*\}\s+from/.test(readFileSync(file, "utf8")));
    expect(hosts.map((h) => h.file).sort()).toEqual(named.sort());
    expect(hosts.length).toBeGreaterThanOrEqual(2);
  });

  it("a host that passes scannedPages passes rasterByPage", () => {
    for (const host of hosts) {
      for (const render of renders(host.code)) {
        if (!/\bscannedPages=/.test(render)) continue;
        expect(/\brasterByPage=/.test(render) || (/\brasterUrl=/.test(render) && /\brasterPages=/.test(render)), `${host.file.replace(process.cwd(), "")} renders the viewer with scannedPages and without rasterByPage — Find the walls will read the PDF, which a scan has no strokes in`).toBe(true);
      }
    }
    // And at least one does, or the rule is about nobody.
    expect(hosts.some((h) => renders(h.code).some((r) => /\bscannedPages=/.test(r)))).toBe(true);
  });

  it("the viewer still declares both props under these names", () => {
    const viewer = stripComments(readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8"));
    expect(viewer).toMatch(/\bscannedPages:\s*number\[\]/);
    expect(viewer).toMatch(/\brasterByPage\?:\s*Record<number/);
    expect(viewer).toMatch(/\brasterPages\?:\s*number\[\]/);
    expect(viewer).toMatch(/\brasterUrl\?:\s*string \| null/);
  });
});
