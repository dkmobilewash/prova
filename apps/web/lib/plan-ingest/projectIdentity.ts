/**
 * ── AN UPLOAD THAT HOLDS MORE THAN ONE PROJECT (proposal-multi-project-upload.md, Diego approved 2026-11-20) ──
 *
 * "2609 Aldrich Avenue South Suite 10.pdf" bundles Excell Academy's tenant work (U+B) with Kurita's city resubmittal
 * set (Ryan A+E). The walls run counted Kurita's A101 and none of the job's walls, and nothing said so. So the sheets are
 * grouped by the project their title block names, and when two groups each own a sheet the run would count, the
 * product asks which project to take off. It never picks.
 *
 * Read from what the inventory already stores, `PlanSheetText.titleBlockText` (one line per baseline of the title-block
 * region), so it needs no new column and reads exactly what the product holds. Two pages are one project when:
 *   - they share at least two repeated title-block lines (firm, address, project name: a template prints them all), or
 *   - they carry the same labelled project number, or
 *   - their labelled project names match, one's words all within the other's ("EXCELL ACADEMY" is "EXCELL ACADEMY
 *     FOR HIGHER LEARNING").
 * A page with no repeated line and no labelled field (a scan, a one-off cover) joins no group and never forms one.
 *
 * A word signature cannot do this, which is why lines are compared whole: measured on 100 uploads, Excell and Kurita
 * both print "Brooklyn Park, Minnesota", while four single-project sets looked split only because a consultant's,
 * forms' or cover's words differed. A consultant's own title block that shares one line (the project's name) and no
 * number stays its own group, and that is harmless: a consultant's sheets are trade sheets, which the run never counts.
 */

export type ProjectPage = { pageNumber: number; titleBlockText: string | null; counted: boolean };
export type ProjectGroup = {
  pages: number[];
  /** The labelled name, else "Project <number>", else the group's first repeated line. */
  label: string;
  name: string | null;
  number: string | null;
  /** The group's repeated title-block lines, as printed: what the question shows beside the label. */
  lines: string[];
  /** Whether it owns a sheet the walls run would count. */
  counted: boolean;
};

/** Lines two pages must share to be one project's template. */
export const SHARED_LINES_MIN = 2;

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
const NUMBER_LABEL = /^(?:PROJECT|PROJ\.?|JOB|COMM(?:ISSION)?)\s*(?:NO\.?|NUMBER|NUM\.?|#)\s*[:.]?\s*(\S+)?/i;
const NAME_LABEL = /^(?:PROJECT\s+(?:NAME|TITLE)|JOB\s+NAME)\s*[:.]?\s*(\S.*)?$/i;
const BARE_PROJECT = /^PROJECT\s*:\s*(\S.*)$/i;
const NAME_BELOW = /^PROJECT(?:\s+INFORMATION)?\s*:?$/i;
const PLACEHOLDER = /^(?:0+|X+|#+|TBD|N\/?A|NUMBER|NO\.?)$/i;
const STOP = new Set(["FOR", "THE", "OF", "AND", "AT", "IN", "A"]);
const LABEL_ONLY = /^(?:DATE|SHEET|SCALE|DRAWN|CHECKED|APPROVED|ISSUE|REVISIONS?|DESCRIPTION|OWNER|CLIENT|ARCHITECT|CONSULTANTS?)\b/i;

/** A line worth comparing: some words, not a bare number, date or sheet designation. */
function identityLine(line: string): boolean {
  const letters = (line.match(/[A-Z]/gi) ?? []).length;
  return line.length >= 8 && letters >= 5;
}

/** The labelled project name and number on one page, normalised; null where none is labelled. */
export function labelledIdentity(titleBlockText: string): { name: string | null; number: string | null } {
  const lines = titleBlockText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let name: string | null = null, number: string | null = null;
  lines.forEach((line, i) => {
    const num = NUMBER_LABEL.exec(line);
    if (num) {
      if (number === null && num[1] && !PLACEHOLDER.test(num[1])) number = norm(num[1]).replace(/\s/g, "");
      return;
    }
    const nm = NAME_LABEL.exec(line);
    if (nm) {
      if (name === null && nm[1] && !LABEL_ONLY.test(nm[1])) name = norm(nm[1]);
      return;
    }
    const bare = BARE_PROJECT.exec(line);
    if (bare) {
      const v = bare[1]!.trim();
      // "Project: 2019015_EXC-6" is a number; "Project: Excell Academy" is a name.
      if (/^\S*\d\S*$/.test(v)) { if (number === null && !PLACEHOLDER.test(v)) number = norm(v); }
      else if (name === null && !LABEL_ONLY.test(v)) name = norm(v);
      return;
    }
    if (NAME_BELOW.test(line) && name === null) {
      const next = lines[i + 1];
      // "PROJECT INFORMATION" over "KURITA": the name is the next line, when it is words and not another label.
      if (next !== undefined && /[A-Z]{3,}/i.test(next) && !LABEL_ONLY.test(next) && !NUMBER_LABEL.test(next)) name = norm(next);
    }
  });
  return { name, number };
}

/** Whether two labelled names are one project's: every word of the shorter is in the longer. */
export function namesMatch(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.split(/[^A-Z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)));
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size > 0 && [...small].every((w) => big.has(w));
}

export function uploadProjects(pages: readonly ProjectPage[]): { groups: ProjectGroup[]; asks: boolean } {
  const read = pages.map((p) => {
    const raw = (p.titleBlockText ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
    return { page: p, raw, lines: new Set(raw.map(norm).filter(identityLine)), ...labelledIdentity(p.titleBlockText ?? "") };
  });
  const seen = new Map<string, number>();
  for (const r of read) for (const l of r.lines) seen.set(l, (seen.get(l) ?? 0) + 1);
  for (const r of read) r.lines = new Set([...r.lines].filter((l) => (seen.get(l) ?? 0) >= 2));
  const signal = read.filter((r) => r.lines.size > 0 || r.name !== null || r.number !== null);
  const parent = signal.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < signal.length; i += 1) {
    for (let j = i + 1; j < signal.length; j += 1) {
      const a = signal[i]!, b = signal[j]!;
      const shared = [...a.lines].filter((l) => b.lines.has(l)).length;
      const same = shared >= SHARED_LINES_MIN || (a.number !== null && a.number === b.number) || (a.name !== null && b.name !== null && namesMatch(a.name, b.name));
      if (same) parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map<number, typeof signal>();
  signal.forEach((r, i) => (byRoot.get(find(i)) ?? byRoot.set(find(i), []).get(find(i))!).push(r));
  const commonest = (xs: (string | null)[]) => {
    const n = new Map<string, number>();
    for (const x of xs) if (x !== null) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
  };
  const groups: ProjectGroup[] = [...byRoot.values()]
    .map((rs) => {
      const name = commonest(rs.map((r) => r.name));
      const number = commonest(rs.map((r) => r.number));
      const printed = new Map<string, string>();
      for (const r of rs) for (const raw of r.raw) if (r.lines.has(norm(raw)) && !printed.has(norm(raw))) printed.set(norm(raw), raw);
      const lines = [...printed.values()];
      const label = name ?? (number !== null ? `Project ${number}` : (lines[0] ?? "Unnamed project"));
      return { pages: rs.map((r) => r.page.pageNumber).sort((p, q) => p - q), label, name, number, lines, counted: rs.some((r) => r.page.counted) };
    })
    .sort((p, q) => p.pages[0]! - q.pages[0]!);
  return { groups, asks: groups.filter((g) => g.counted).length >= 2 };
}
