import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * WHO MAY REMOVE A PUNCH ITEM FROM THE PHONE, and what the phone's queue is
 * told when the row is already gone. Issue #592: the phone could add an item
 * and had no way to take one off.
 *
 * The capability and the ownership are tested SEPARATELY and from the two
 * sides that actually exist in production — a foreman (MANAGE_FIELD, not the
 * owner) and a bookkeeper (neither) — because they are two different
 * refusals with two different sentences, and a single "not allowed" test
 * passes whichever of them is missing.
 *
 * `can` and `ownerRefusal` are the real ones, deliberately. Mocking either
 * would leave this file asserting that the handler calls a function, which
 * is the census shape this repo keeps paying for; what matters is the
 * ANSWER a `FIELD` job function gets, and that answer lives in
 * lib/permissions.ts.
 */

type Context = { company: { id: string }; companyId: string; id: string; role: string; jobFunction: string | null };

const OWNER: Context = { company: { id: "co_1" }, companyId: "co_1", id: "user_1", role: "OWNER", jobFunction: null };
/** A foreman: holds MANAGE_FIELD, is not the account owner. #592's own
 * headline case, and still refused — see the handler's comment. */
const FOREMAN: Context = { ...OWNER, id: "user_2", role: "MEMBER", jobFunction: "FIELD" };
/** No MANAGE_FIELD at all. */
const BOOKKEEPER: Context = { ...OWNER, id: "user_3", role: "MEMBER", jobFunction: "ACCOUNTING" };

let context: Context | null = OWNER;
let item: { id: string; companyId: string; jobId: string } | null = null;
const deleted: string[] = [];

vi.mock("@/lib/auth", () => ({
  requireApiContext: async () => context,
  requireCompanyContext: async () => context,
}));

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: {
    punchListItem: {
      findUnique: async () => item,
      delete: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return item;
      },
    },
  },
}));

const { DELETE } = await import("./route");

function del(jobId = "job_1", itemId = "item_1") {
  const request = new NextRequest(`http://test/api/v1/jobs/${jobId}/punch-list/${itemId}`, { method: "DELETE" });
  return DELETE(request, { params: Promise.resolve({ id: jobId, itemId }) });
}

beforeEach(() => {
  context = OWNER;
  item = { id: "item_1", companyId: "co_1", jobId: "job_1" };
  deleted.length = 0;
});

describe("DELETE on a punch list item", () => {
  it("removes the item for the account owner", async () => {
    const response = await del();
    expect(response.status).toBe(200);
    expect(deleted).toEqual(["item_1"]);
  });

  it("refuses a foreman, with the same sentence the web row gives", async () => {
    // PARITY, NOT POLICY INVENTED HERE: `deletePunchListItem` in
    // lib/actions/punchLists.ts refuses a non-owner through this same
    // `ownerRefusal`. A phone that can delete what the web refuses is the
    // worse of the two bugs, so this asserts the narrower behaviour even
    // though #592's complaint is precisely that a crew member is stuck.
    context = FOREMAN;
    const response = await del();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only the account owner can remove a punch list item" });
    expect(deleted, "a non-owner deleted a field record").toEqual([]);
  });

  it("refuses somebody with no field access at all, and says which thing it is", async () => {
    context = BOOKKEEPER;
    const response = await del();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("part of your job function");
    expect(deleted).toEqual([]);
  });

  it("refuses an unauthenticated request", async () => {
    context = null;
    const response = await del();
    expect(response.status).toBe(401);
    expect(deleted).toEqual([]);
  });

  it("answers 404 — not 400 — for an item that is already gone", async () => {
    // The status is the contract with the phone's queue: a replayed delete
    // whose row has gone has done its job, and `punch-list:delete` in
    // apps/mobile/lib/sync-queue.ts settles a 404 as done rather than
    // parking it in "needs attention". A 400 there would read as a refusal.
    item = null;
    const response = await del();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Punch list item not found" });
    expect(deleted).toEqual([]);
  });

  it("will not reach into another company, however well-formed the id is", async () => {
    item = { id: "item_1", companyId: "co_2", jobId: "job_1" };
    const response = await del();
    expect(response.status).toBe(404);
    expect(deleted).toEqual([]);
  });

  it("will not remove an item that belongs to a different job on the same URL", async () => {
    // The jobId in the path is not decoration: without this check any item
    // in the company could be deleted through any job's URL.
    item = { id: "item_1", companyId: "co_1", jobId: "job_other" };
    const response = await del();
    expect(response.status).toBe(404);
    expect(deleted).toEqual([]);
  });
});
