import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * THE CREW SECTION MUST RENDER WHEN THERE IS NO CREW.
 *
 * `/team` wrapped it in `{(crew.length > 0 || archivedCrewCount > 0) && …}`,
 * so a brand-new contractor's Team page offered exactly two things — invite
 * a teammate by email, or share a sign-up link — and said nothing anywhere
 * about a person who has no email address. The only working path was an
 * owner-only CSV import inside Settings that nothing on the page mentioned.
 *
 * That is the classic empty-state failure: the one affordance that creates
 * the first record is hidden until a first record exists. It is invisible to
 * everybody building the app, because they all have data. It is the entire
 * page to a union drywall sub with thirty hands and no logins — and
 * certified payroll, the apprentice ratio and the WH-347 are why he is here.
 *
 * So this file asks the question TWO WAYS, because one of them alone can be
 * satisfied while the defect is back:
 *
 *   1. RENDERED. `<CrewRoster>` with an empty crew must put the add form on
 *      screen. A component that returned null for an empty list would pass
 *      any source scan.
 *   2. READ. The page must render `<CrewRoster>` UNCONDITIONALLY. A perfect
 *      component wrapped in `{crew.length > 0 && …}` is the original bug
 *      with extra steps, and no render test of the component can see it.
 *
 * The reader half is a source scan and carries the two failure modes
 * CLAUDE.md names: it can get the answer wrong, and it can get an EMPTY
 * QUESTION. So the element is counted before it is judged, the blanking pass
 * is checked against markers it must not have eaten, and the judgement
 * itself is run over fixtures at the bottom — both a conditional wrapper and
 * a plain one — so a checker that has stopped distinguishing them fails here
 * rather than passing everything downstream.
 */

// The barrel reaches prisma and next/cache; nothing here calls an action,
// and a unit test has no business opening a connection to say so.
vi.mock("@prova/db", () => ({ prisma: {}, Prisma: {} }));
vi.mock("@/lib/actions", () => ({
  archiveCrewMember: vi.fn(),
  createCrewMember: vi.fn(),
  updateCrewMember: vi.fn(),
  importClients: vi.fn(),
  importCrew: vi.fn(),
  importJobs: vi.fn(),
  importPhaseCodes: vi.fn(),
  importVcfContacts: vi.fn(),
}));

const { CrewRoster } = await import("@/components/CrewRoster");

type Props = Parameters<typeof CrewRoster>[0];

function render(props: Partial<Props> = {}) {
  return renderToStaticMarkup(
    createElement(CrewRoster, {
      crew: [],
      archivedCount: 0,
      craftOptions: [{ id: "craft_carp", label: "UBC 405 — Carpenter" }],
      existingCrew: [],
      canManage: true,
      canSetCraft: true,
      canArchive: true,
      ...props,
    } as Props),
  );
}

const LUIS = {
  id: "m_luis",
  nameLabel: "Luis Ortega",
  employeeNumber: "114",
  craftClassificationId: "craft_carp",
  craftLabel: "UBC 405 — Carpenter",
};

describe("with nobody on the crew", () => {
  it("puts a way in on the screen, not a blank space", () => {
    const html = render();
    expect(html).toContain("Nobody on the crew yet");
    // The add form itself, open, with the name fields in it — not a button
    // that would reveal one. This is the assertion the original defect
    // would have failed.
    expect(html).toContain('name="legalFirstName"');
    expect(html).toContain('name="legalLastName"');
    expect(html).toContain("Add to crew");
  });

  it("offers the spreadsheet import here, not only inside Settings", () => {
    // Forty hands typed one at a time is not a serious offer. The import
    // existed and lived somewhere nothing on this page named.
    expect(render()).toContain("Import crew");
  });

  it("says a crew member needs no email and no login", () => {
    // The sentence a union sub is looking for. Without it the page reads as
    // "everyone here needs an email address", which is the belief that makes
    // him conclude the payroll half is not real.
    expect(render()).toMatch(/don&#x27;t sign in and they don&#x27;t need an email/);
  });

  it("explains itself to somebody who may not add, instead of showing nothing", () => {
    const html = render({ canManage: false });
    expect(html).toContain("Nobody on the crew yet");
    expect(html).toContain("isn&#x27;t part of your job function");
    expect(html).not.toContain('name="legalFirstName"');
  });

  it("says so when the crew is empty because everyone was archived", () => {
    const html = render({ archivedCount: 3 });
    expect(html).toContain("has been archived");
    expect(html).toContain("3 archived crew members are kept");
  });
});

describe("with a crew", () => {
  it("names each person and what they work as", () => {
    const html = render({ crew: [LUIS] });
    expect(html).toContain("Luis Ortega");
    expect(html).toContain("UBC 405 — Carpenter");
    expect(html).toContain("No. 114");
  });

  it("keeps the add form available, collapsed behind its button", () => {
    const html = render({ crew: [LUIS] });
    expect(html).toContain("Add a crew member");
    // Collapsed once there is a list: the list is why you came.
    expect(html).not.toContain('name="legalFirstName"');
  });

  it("offers Archive only to somebody who may archive", () => {
    expect(render({ crew: [LUIS] })).toContain("Archive");
    expect(render({ crew: [LUIS], canArchive: false })).not.toContain("Archive");
  });

  it("offers no craft field when the company has not set up a craft yet", () => {
    // A brand-new company has no union local and therefore no
    // classification. An empty dropdown reads as a broken control; a
    // sentence saying where crafts come from does not.
    const html = render({ craftOptions: [] });
    expect(html).not.toContain('name="craftClassificationId"');
    expect(html).toContain("set up a union local");
  });
});

/* ------------------------------------------------------------------ *
 * The reader half: /team must render this unconditionally
 * ------------------------------------------------------------------ */

const teamPage = fileURLToPath(new URL("../app/(app)/team/page.tsx", import.meta.url));

/**
 * Comments and string literals, blanked to spaces of the SAME LENGTH.
 *
 * Length-preserving so an index into the result is an index into the
 * original. Comments have to go because the page carries a paragraph
 * quoting the very wrapper this file forbids — a comment quoting its own
 * pattern disarmed a census here once (#185). Strings have to go because a
 * brace or an `&&` inside one is not structure.
 */
function blank(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Every JSX expression container still OPEN at `index` whose own level
 * carries a conditional — `{x && <T/>}`, `{x ? <T/> : null}`.
 *
 * Nested containers are removed before the level is read, so a sibling
 * branch elsewhere in the tree is not mistaken for this element's own
 * wrapper. The walk starts at the component's `return (`, because the
 * function body's brace is open the whole way and is full of ordinary
 * conditional logic that has nothing to do with what renders.
 */
function conditionalWrappers(blanked: string, index: number): string[] {
  const start = blanked.indexOf("return (");
  expect(start, "no `return (` in the page — the scan has nothing to walk").toBeGreaterThan(-1);
  expect(start, "the element is before the return — is this the right file?").toBeLessThan(index);

  const open: number[] = [];
  for (let i = start; i < index; i += 1) {
    if (blanked[i] === "{") open.push(i);
    else if (blanked[i] === "}") open.pop();
  }

  return open
    .map((at) => {
      // The container's own level: drop everything inside nested braces.
      let depth = 0;
      let own = "";
      for (let i = at + 1; i < index; i += 1) {
        const ch = blanked[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        else if (depth === 0) own += ch;
      }
      return own;
    })
    // `?.` is optional chaining, not a ternary.
    .filter((own) => /&&/.test(own) || /\?(?!\.)/.test(own));
}

describe("the scan sees what it reasons about", () => {
  const source = readFileSync(teamPage, "utf8");
  const blanked = blank(source);

  it("finds the element exactly once, counted before it is judged", () => {
    // A rename, a move to another file, or a blanking pass that ate the
    // markup fails HERE with a count, rather than passing silently on an
    // empty question.
    expect((source.match(/<CrewRoster\b/g) ?? []).length).toBe(1);
    expect((blanked.match(/<CrewRoster\b/g) ?? []).length).toBe(1);
  });

  it("blanks comments and strings without eating the markup", () => {
    expect(blanked).toContain("<CrewRoster");
    expect(blanked).toContain("data-tour=");
    expect(blanked.length).toBe(source.length);
    // The page's own paragraph quotes the forbidden wrapper. If blanking
    // ever stops removing comments, this catches it before the rule does.
    const quoted = "archivedCrewCount > 0) && (";
    expect(source, "the page no longer quotes the wrapper it forbids").toContain(quoted);
    expect(blanked).not.toContain(quoted);
  });
});

describe("/team renders the crew section unconditionally", () => {
  it("has no conditional wrapper around <CrewRoster>", () => {
    const blanked = blank(readFileSync(teamPage, "utf8"));
    const wrappers = conditionalWrappers(blanked, blanked.indexOf("<CrewRoster"));
    expect(
      wrappers,
      "the crew section is inside a condition again — a brand-new contractor cannot add his first crew member",
    ).toEqual([]);
  });
});

/**
 * The judgement, run over markup written here on purpose.
 *
 * Without these the rule above passes on a page it can no longer read, and
 * "no conditional wrapper" would be indistinguishable from "found nothing to
 * look at". Each fixture is the shape somebody would actually write.
 */
describe("the rule can tell the two apart", () => {
  const cases: [string, string, boolean][] = [
    [
      "plain child",
      "return (\n  <div>\n    <CrewRoster crew={crew} />\n  </div>\n);",
      false,
    ],
    [
      "the original bug",
      "return (\n  <div>\n    {crew.length > 0 && <CrewRoster crew={crew} />}\n  </div>\n);",
      true,
    ],
    [
      "the original bug, parenthesised",
      "return (\n  <div>\n    {(crew.length > 0 || archived > 0) && (\n      <CrewRoster crew={crew} />\n    )}\n  </div>\n);",
      true,
    ],
    [
      "a ternary",
      "return (\n  <div>\n    {crew.length > 0 ? <CrewRoster crew={crew} /> : null}\n  </div>\n);",
      true,
    ],
    [
      "hidden two levels up",
      "return (\n  <div>\n    {isOwner && (\n      <section>\n        <CrewRoster crew={crew} />\n      </section>\n    )}\n  </div>\n);",
      true,
    ],
    [
      "a conditional SIBLING, which is not a wrapper",
      "return (\n  <div>\n    {invites.length > 0 && <Pending />}\n    <CrewRoster crew={crew} />\n  </div>\n);",
      false,
    ],
    [
      "an optional chain in the container, which is not a ternary",
      "return (\n  <div>\n    {list?.map((row) => (\n      <CrewRoster key={row.id} crew={row.crew} />\n    ))}\n  </div>\n);",
      false,
    ],
    [
      "a comment quoting the bug",
      "return (\n  <div>\n    {/* was {crew.length > 0 && ( … )} */}\n    <CrewRoster crew={crew} />\n  </div>\n);",
      false,
    ],
  ];

  for (const [name, fixture, conditional] of cases) {
    it(`${conditional ? "flags" : "allows"}: ${name}`, () => {
      const blanked = blank(fixture);
      const found = conditionalWrappers(blanked, blanked.indexOf("<CrewRoster"));
      expect(found.length > 0).toBe(conditional);
    });
  }
});
