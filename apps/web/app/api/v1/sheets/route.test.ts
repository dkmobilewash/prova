import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * THE SHEETS ENDPOINT, AND THE REPLAY THAT ALREADY COST A PRODUCTION 500.
 *
 * The phone queues pins when there is no signal and flushes them later, so
 * every POST here is one a retry may repeat. The punch-list route records what
 * happened on 2026-09-20 when the read-then-insert was the only protection:
 * two flushes passed the `findUnique` before either inserted, and the second
 * came back as a unique-constraint 500 — for a request whose whole purpose was
 * to be safely repeatable.
 *
 * So the case that matters most below is not "a replay returns the same row".
 * It is **"a replay that LOSES THE RACE still returns the same row"**, which
 * is the one a read-based check passes and the index does not.
 */

let context: Record<string, unknown> | null = null;
const db = {
  job: { findUnique: vi.fn() },
  sheetPage: { findMany: vi.fn(), findFirst: vi.fn() },
  sheetPin: { findUnique: vi.fn(), create: vi.fn() },
  jobMedia: { findFirst: vi.fn() },
  punchListItem: { findFirst: vi.fn() },
};

vi.mock("@/lib/auth", () => ({ requireApiContext: async () => context }));
vi.mock("@prova/db", () => ({ prisma: db }));

const { GET, POST } = await import("./route");

const FIELD = { id: "u_1", companyId: "co_1", role: "MEMBER", jobFunction: "FIELD" };
// ACCOUNTING, because it is the one job function that genuinely lacks
// MANAGE_JOBS. The first draft of this test used "ESTIMATING", which is not a
// job function this app has — ESTIMATOR is, and it HOLDS MANAGE_JOBS, so the
// assertion was about nothing. A made-up role passes a permission test by
// falling through to whatever the default is.
const OFFICE = { id: "u_2", companyId: "co_1", role: "MEMBER", jobFunction: "ACCOUNTING" };

// 42x30 — a D-size sheet, so `y` tops out at 0.714 and a square fixture
// cannot hide an axis mistake.
const PAGE = { id: "pg_1", widthPt: 3024, heightPt: 2160 };

function post(body: unknown) {
  return new NextRequest("http://localhost/api/v1/sheets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
  context = FIELD;
  db.job.findUnique.mockResolvedValue({ id: "job_1", companyId: "co_1" });
  db.sheetPage.findFirst.mockResolvedValue(PAGE);
  db.sheetPin.findUnique.mockResolvedValue(null);
  db.sheetPin.create.mockImplementation(async ({ data }: never) => ({ id: "pin_1", ...(data as object) }));
});

describe("who may reach it", () => {
  it("refuses an unauthenticated caller", async () => {
    context = null;
    expect((await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).status).toBe(401);
    expect((await POST(post({}))).status).toBe(401);
  });

  it("refuses a job function without MANAGE_JOBS, in plain words", async () => {
    context = OFFICE;
    const res = await POST(post({ pageId: "pg_1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/job function/i);
  });

  it("lets a FIELD foreman through — which is the whole point", async () => {
    db.sheetPage.findMany.mockResolvedValue([]);
    expect((await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).status).toBe(200);
  });

  it("will not read another company's job", async () => {
    db.job.findUnique.mockResolvedValue({ id: "job_1", companyId: "someone_else" });
    expect((await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).status).toBe(400);
  });
});

describe("what the phone is told about a sheet", () => {
  it("sends the page size, so a tap can be mapped without opening anything", async () => {
    db.sheetPage.findMany.mockResolvedValue([
      {
        ...PAGE,
        pageNumber: 3,
        label: "A-201",
        imageUrl: "https://blob.example/sheet.png",
        imageWidthPx: 2000,
        revision: { id: "rev_1", label: "R2", set: { id: "set_1", name: "Arch" } },
        pins: [],
      },
    ]);
    const [sheet] = await (await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).json();
    // Both are needed: `y` is a fraction of the WIDTH, so the phone needs the
    // aspect to know where the bottom of the sheet is.
    expect(sheet).toMatchObject({ widthPt: 3024, heightPt: 2160, pageNumber: 3, revisionLabel: "R2" });
  });

  it("sends a sheet with no image rather than hiding it", async () => {
    // A null imageUrl is "nobody has prepared this yet", not an error. Hiding
    // it would make a drawing that exists look like one that does not.
    db.sheetPage.findMany.mockResolvedValue([
      { ...PAGE, pageNumber: 1, label: null, imageUrl: null, imageWidthPx: null,
        revision: { id: "r", label: "R1", set: { id: "s", name: "Arch" } }, pins: [] },
    ]);
    const body = await (await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).json();
    expect(body).toHaveLength(1);
    expect(body[0].imageUrl).toBeNull();
  });

  it("flattens a punch item's words onto the pin, so the phone needs no second request", async () => {
    db.sheetPage.findMany.mockResolvedValue([
      { ...PAGE, pageNumber: 1, label: null, imageUrl: null, imageWidthPx: null,
        revision: { id: "r", label: "R1", set: { id: "s", name: "Arch" } },
        pins: [{ id: "p1", x: 0.5, y: 0.3, kind: "PUNCH", note: null, mediaId: null,
                 punchItemId: "pi_1", punchItem: { description: "Patch soffit at grid C" } }] },
    ]);
    const [sheet] = await (await GET(new NextRequest("http://localhost/api/v1/sheets?jobId=job_1"))).json();
    expect(sheet.pins[0].punchItemDescription).toBe("Patch soffit at grid C");
  });
});

describe("placing a pin from the field", () => {
  it("stores a tap inside the page-width box", async () => {
    const res = await POST(post({ pageId: "pg_1", kind: "NOTE", x: 0.5, y: 0.35, note: "Hold this wall" }));
    expect(res.status).toBe(201);
    expect(db.sheetPin.create.mock.calls[0][0].data).toMatchObject({ x: 0.5, y: 0.35, companyId: "co_1" });
  });

  it("REFUSES a y that is a fine fraction and off the bottom of the sheet", async () => {
    // 0.9 is a good number and a good `y` on a tall page. On 42x30 it is below
    // the paper. Anything treating y as 0..1 of the height accepts this.
    const res = await POST(post({ pageId: "pg_1", kind: "NOTE", x: 0.5, y: 0.9, note: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/below the bottom/i);
    expect(db.sheetPin.create).not.toHaveBeenCalled();
  });

  it("will not pin another company's photo", async () => {
    db.jobMedia.findFirst.mockResolvedValue(null);
    const res = await POST(post({ pageId: "pg_1", kind: "PHOTO", x: 0.2, y: 0.2, mediaId: "m_other" }));
    expect(res.status).toBe(400);
    expect(db.sheetPin.create).not.toHaveBeenCalled();
  });

  it("will not pin onto another company's sheet", async () => {
    db.sheetPage.findFirst.mockResolvedValue(null);
    expect((await POST(post({ pageId: "pg_other", kind: "NOTE", x: 0.2, y: 0.2, note: "x" }))).status).toBe(400);
  });
});

describe("a retried flush replays instead of duplicating", () => {
  it("returns the existing pin when the read finds it", async () => {
    db.sheetPin.findUnique.mockResolvedValue({ id: "pin_existing" });
    const res = await POST(post({ pageId: "pg_1", kind: "NOTE", x: 0.2, y: 0.2, note: "x", clientOperationId: "op_1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("pin_existing");
    expect(db.sheetPin.create).not.toHaveBeenCalled();
  });

  it("STILL replays when the read misses and the insert loses the race", async () => {
    // The case that read-then-insert cannot handle and the index can. Both
    // flushes see nothing, both insert, one collides. A 500 here is the exact
    // production defect of 2026-09-20.
    db.sheetPin.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "pin_winner" });
    db.sheetPin.create.mockRejectedValue(
      new Error("Unique constraint failed on the fields: (`companyId`,`clientOperationId`)"),
    );
    const res = await POST(post({ pageId: "pg_1", kind: "NOTE", x: 0.2, y: 0.2, note: "x", clientOperationId: "op_1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("pin_winner");
  });

  it("does not swallow a different database error as a replay", async () => {
    db.sheetPin.create.mockRejectedValue(new Error("connection terminated unexpectedly"));
    await expect(
      POST(post({ pageId: "pg_1", kind: "NOTE", x: 0.2, y: 0.2, note: "x", clientOperationId: "op_1" })),
    ).rejects.toThrow(/connection terminated/);
  });
});
