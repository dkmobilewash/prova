import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two /catalog buttons that threw at an estimator and took his pasted
 * price list with them.
 *
 * WHO REACHES THE PAGE. `/catalog` demands MANAGE_ESTIMATING and nothing
 * else, and ESTIMATOR holds it (lib/permissions.ts) — that is the whole
 * point of the job function. So an estimator opens the page legitimately,
 * pastes two hundred rows out of a supplier's spreadsheet, previews them,
 * clicks Add, and `importCatalogEntries` calls `assertOwner`, WHICH THROWS.
 *
 * WHY A THROW IS NOT A REFUSAL HERE. Production redacts a thrown Server
 * Action message to a digest (CLAUDE.md, verified on a real production
 * build), so what he gets is the error boundary — and the boundary
 * unmounts `CatalogImport`, whose `text` is React state. The paste is gone.
 * He has no sentence telling him he is not allowed, and no way back to what
 * he typed. The same throw sits behind "Update default from actuals", which
 * additionally throws at the OWNER on an ordinary race — the page is
 * minutes old and a costed line has landed since, so `repriceDecision`
 * refuses, and that refusal was thrown too.
 *
 * THE RULE, from CLAUDE.md and from shared.ts's own doc comment:
 * `ownerRefusal` RETURNS `{ ok: false, error }` and belongs in anything
 * returning `ActionResult`; `assertOwner` THROWS and belongs only in the
 * older throw-style actions. Both of these were throw-style, so neither was
 * breaking the rule as written — they were the wrong CONTRACT for a control
 * a non-owner can actually reach with work in hand. Converting the contract
 * is the fix; `ownerRefusalCensus.test.ts` then holds it.
 *
 * AND THE SECOND HALF, which is the one that matters to the contractor: the
 * page must not render a control the action will refuse. A button that
 * explains itself after destroying your work is still a bad button. The
 * static checks at the bottom pin that, following the split
 * `IntakeForwardBox` documents — the server enforces, the flag decides
 * whether the control renders at all.
 */

const COMPANY_ID = "cmp_alpha";
const ENTRY_ID = "cat_1";

type Row = Record<string, unknown>;

const db = {
  entries: [] as Row[],
  fringeSchedules: [] as Row[],
};

const created: Row[][] = [];
const updated: Row[] = [];

const prisma = {
  lineItemCatalogEntry: {
    findMany: async () => db.entries.map((e) => ({ description: e.description })),
    findUnique: async ({ where }: { where: Row }) =>
      db.entries.find((e) => e.id === where.id) ?? null,
    createMany: async ({ data }: { data: Row[] }) => {
      created.push(data);
      return { count: data.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      updated.push({ id: where.id, ...data });
      return { id: where.id, ...data };
    },
  },
  fringeRateSchedule: {
    findMany: async () => db.fringeSchedules,
  },
};

const context = {
  id: "usr_estimator",
  role: "OWNER",
  jobFunction: null as string | null,
  company: { id: COMPANY_ID },
};

vi.mock("@prova/db", () => ({ prisma, Prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));

const { importCatalogEntries, updateCatalogDefaultsFromActuals } = await import("./actions/estimating");

/** What the page posts: the raw pasted text, and the margin checkbox. */
function importForm(csv: string) {
  const fd = new FormData();
  fd.set("csv", csv);
  return fd;
}

/** A real estimator: a MEMBER whose job function is ESTIMATOR, which is
 * exactly the principal `/catalog` lets in. */
function signInAsEstimator() {
  context.role = "MEMBER";
  context.jobFunction = "ESTIMATOR";
}

const PRICE_LIST = [
  "Description,Unit,Unit Price,Cost",
  '5/8" Type X board,SF,2.85,1.90',
  "Corner bead,LF,1.20,0.60",
].join("\n");

beforeEach(() => {
  db.entries = [];
  db.fringeSchedules = [];
  created.length = 0;
  updated.length = 0;
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("the estimator who pasted a price list", () => {
  it("is refused in a sentence he can read, not by a throw production redacts", async () => {
    signInAsEstimator();

    // The assertion is `resolves`, not `rejects`, and that IS the fix: a
    // rejected promise here is the error boundary, and the error boundary
    // is where the paste went.
    const result = await importCatalogEntries(importForm(PRICE_LIST));

    expect(result.ok).toBe(false);
    const error = result.ok ? "" : result.error;
    expect(error).toMatch(/owner/i);
    expect(error).toMatch(/price list/i);

    // And nothing was written on the way to saying so.
    expect(created).toEqual([]);
  });

  it("is refused before the database is touched at all", async () => {
    signInAsEstimator();
    let reads = 0;
    const watched = {
      ...prisma,
      lineItemCatalogEntry: {
        ...prisma.lineItemCatalogEntry,
        findMany: async () => {
          reads += 1;
          return [];
        },
      },
    };
    // Swapped in for this one call: the claim worth proving is that the
    // refusal comes first, not merely that nothing was created.
    const original = prisma.lineItemCatalogEntry.findMany;
    prisma.lineItemCatalogEntry.findMany = watched.lineItemCatalogEntry.findMany;
    try {
      await importCatalogEntries(importForm(PRICE_LIST));
    } finally {
      prisma.lineItemCatalogEntry.findMany = original;
    }
    expect(reads).toBe(0);
  });

  it("is refused the re-price button the same way", async () => {
    signInAsEstimator();

    const result = await updateCatalogDefaultsFromActuals(ENTRY_ID, new FormData());

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/owner/i);
    expect(updated).toEqual([]);
  });
});

describe("the owner's own refusals stop throwing too", () => {
  it("returns the 'nothing readable' message instead of throwing it away with the paste", async () => {
    // Not an access refusal — an ordinary mistake, pasting the wrong half of
    // a spreadsheet. It threw, so it reached the owner as the same blank
    // error boundary, and it took the paste with it just as thoroughly.
    const result = await importCatalogEntries(importForm("just some notes\nnothing tabular here"));

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/readable|preview/i);
    expect(created).toEqual([]);
  });

  it("returns the empty-paste message", async () => {
    const result = await importCatalogEntries(importForm("   "));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/paste/i);
  });

  it("returns the re-price race refusal rather than throwing it", async () => {
    // The page is minutes old: it rendered the button because the entry was
    // flagged, and a costed line landing since has moved it back inside the
    // threshold. `repriceDecision` refuses, correctly — and that refusal was
    // a `throw`, on a page whose only other outcome is silence.
    db.entries = [
      {
        id: ENTRY_ID,
        companyId: COMPANY_ID,
        defaultBudgetedUnitCost: "1.90",
        defaultUnitPrice: "2.85",
        jobLineItems: [],
      },
    ];

    const result = await updateCatalogDefaultsFromActuals(ENTRY_ID, new FormData());

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/nothing to re-price/i);
    expect(updated).toEqual([]);
  });

  it("still writes the new default when the entry really is out of date", async () => {
    // The happy path, so none of the above is passing by refusing
    // everything. Four finished lines at 2 units each, $6.00 booked per
    // line: $3.00/unit actual against a $1.90 default — well past the
    // variance threshold.
    db.entries = [
      {
        id: ENTRY_ID,
        companyId: COMPANY_ID,
        defaultBudgetedUnitCost: "1.90",
        defaultUnitPrice: "2.85",
        jobLineItems: Array.from({ length: 4 }, () => ({
          quantity: "2",
          costEntries: [{ amount: "6.00", category: "MATERIAL" }],
          timeEntries: [],
          job: { status: "COMPLETE" },
        })),
      },
    ];

    const result = await updateCatalogDefaultsFromActuals(ENTRY_ID, new FormData());

    expect(result).toEqual({ ok: true });
    expect(updated).toHaveLength(1);
    expect(updated[0].defaultBudgetedUnitCost).toBe("3.00");
    // The margin checkbox was not ticked, so the sale price is untouched:
    // "our cost went up" must not silently become "we now charge more".
    expect(updated[0].defaultUnitPrice).toBeUndefined();
  });

  it("still imports a real price list", async () => {
    const result = await importCatalogEntries(importForm(PRICE_LIST));

    expect(result).toEqual({ ok: true });
    expect(created).toHaveLength(1);
    expect(created[0]).toHaveLength(2);
  });
});

/**
 * The second half: the page must not offer the control. Static, following
 * the readFileSync precedent in page-money-guards.test.ts — what these catch
 * is somebody dropping the flag in a refactor, which would silently restore
 * a button that destroys an estimator's work with every other test green.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

describe("/catalog does not render an owner-only control to a non-owner", () => {
  const page = read("app/(app)/catalog/page.tsx");
  const importer = read("components/CatalogImport.tsx");

  it("decides ownership on the page and hands it down", () => {
    expect(page).toMatch(/const isOwner = context\.role === "OWNER"/);
    expect(page).toContain("canImport={isOwner}");
  });

  it("gates the re-price form on it", () => {
    // The other control that posts to an owner-only action.
    expect(page).toMatch(/actuals\.isFlagged && isOwner &&/);
    // Through <ActionForm>, the shape #414 established for a server-rendered
    // form whose action returns a refusal — not a second hand-rolled
    // transition beside it. A bespoke CatalogRepriceForm existed for a few
    // hours on this branch and was deleted on the rebase onto #414: two
    // conventions for one thing is how this repo got sixteen copies of
    // InputError.
    expect(page).toContain("<ActionForm");
    expect(page).toContain("updateCatalogDefaultsFromActuals.bind(null, entry.id)");
  });

  it("keeps the import behind the flag rather than only styling it", () => {
    expect(importer).toContain("canImport");
    // Hidden, not disabled: a disabled button on a paste box invites the
    // paste first and explains after.
    expect(importer).toMatch(/if \(!canImport\)/);
  });

  it("renders what the action returns instead of letting it throw", () => {
    // The whole point of the conversion. A plain `<form action={…}>` here
    // means a refusal is a redacted digest and the textarea is unmounted
    // with it. `<ActionForm>` is onSubmit internally, renders the returned
    // sentence, and resets only on success — and `formActionCensus.test.ts`
    // independently fails the build on the `<form action={…}>` shape in any
    // client module, so this is the file-specific half of that.
    expect(importer).toContain("<ActionForm");
    expect(importer).not.toMatch(/<form\b[^>]*action=\{/);
    // The textarea is NOT inside the form and must not be reset: what was
    // typed has to survive the refusal that is about to be printed under it.
    expect(importer).toContain("resetOnSuccess={false}");
  });
});
