import { beforeEach, describe, expect, it, vi } from "vitest";
import { visibleToPrincipal, type Alert } from "@/lib/alerts";
import { can, type Principal } from "@/lib/permissions";

/**
 * needs_attention — the /alerts list, through /alerts' own loader.
 *
 * `loadAlerts` is faked at its boundary, and the fake does the two things
 * the real one does that this tool depends on: it answers ONLY for the
 * company it was asked about (so a handler that passed the wrong company, or
 * none, reads another tenant's list and goes red), and it filters by the
 * principal it was HANDED through the real `visibleToPrincipal` (so a
 * handler that dropped the principal — `loadAlerts` defaults a missing one
 * to OWNER — hands a foreman the billing alerts and goes red).
 */

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma, prisma: {} }));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-18", viewerTimeZone: async () => "UTC" }));

const alert = (over: Partial<Alert>): Alert => ({
  key: over.key ?? "k",
  kind: "RFI_UNANSWERED",
  severity: "OVERDUE",
  title: "RFI 4 unanswered",
  detail: "Riverside",
  href: "/rfis",
  dueOn: "2026-09-10",
  daysUntil: -8,
  amount: null,
  ...over,
});

const BY_COMPANY: Record<string, Alert[]> = {
  "co-1": [
    alert({ key: "a1", title: "RFI 4 unanswered on Riverside" }),
    alert({ key: "a2", kind: "BACKCHARGE_RESPONSE", title: "Backcharge 2 needs an answer", amount: 42000, href: "/backcharges" }),
  ],
  "co-2": [alert({ key: "b1", title: "OTHER COMPANY'S alert" })],
};
let SILENCED: Record<string, Alert[]> = {};

const loadAlerts = vi.fn(
  async (companyId: string, _userId: string, _today: string, principal: Principal = { role: "OWNER", jobFunction: null }) => ({
    visible: visibleToPrincipal(BY_COMPANY[companyId] ?? [], (capability) => can(principal, capability)),
    silenced: SILENCED[companyId] ?? [],
  }),
);
vi.mock("@/lib/alerts-query", () => ({ loadAlerts }));

const { runTool } = await import("./handlers");

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

beforeEach(() => {
  loadAlerts.mockClear();
  SILENCED = {};
});

type Row = { what: string; amount: number | null };

describe("needs_attention", () => {
  it("reads only the asker's company, through /alerts' own loader, on the reader's day", async () => {
    const result = await runTool({ companyId: "co-1", principal: OWNER, userId: "u-1" }, "needs_attention", {});
    const titles = (result.data as Row[]).map((row) => row.what);
    expect(titles).toContain("RFI 4 unanswered on Riverside");
    expect(titles).not.toContain("OTHER COMPANY'S alert");
    expect(loadAlerts).toHaveBeenCalledWith("co-1", "u-1", "2026-09-18", OWNER);
    expect(result.summary).toMatchObject({ needingAttention: 2, overdue: 2 });
    expect(result.citations).toEqual([{ label: "Alerts", href: "/alerts" }]);
  });

  it("filters by the ASKER: a foreman is not told about the backcharge at all", async () => {
    const result = await runTool({ companyId: "co-1", principal: FIELD, userId: "u-2" }, "needs_attention", {});
    const rows = result.data as Row[];
    expect(rows.map((row) => row.what)).toEqual(["RFI 4 unanswered on Riverside"]);
    expect(rows.every((row) => row.amount === null)).toBe(true);
    expect(result.summary?.needingAttention).toBe(1);
  });

  it("refuses without a person rather than falling back to the owner's list", async () => {
    const result = await runTool({ companyId: "co-1", principal: FIELD }, "needs_attention", {});
    expect(result.unavailable).toBeTruthy();
    expect(loadAlerts).not.toHaveBeenCalled();
  });

  it("says a quiet list is quiet — and names what the person silenced rather than calling it nothing", async () => {
    const empty = await runTool({ companyId: "co-3", principal: OWNER, userId: "u-1" }, "needs_attention", {});
    expect(empty.data).toEqual([]);
    expect(empty.unavailable).toMatch(/only sees dates somebody has recorded/);

    SILENCED = { "co-3": [alert({ key: "s1" }), alert({ key: "s2" })] };
    const silenced = await runTool({ companyId: "co-3", principal: OWNER, userId: "u-1" }, "needs_attention", {});
    expect(silenced.unavailable).toMatch(/2 items are silenced/);
    expect(silenced.summary?.silencedByYou).toBe(2);
  });

  /* The "go straight to" buttons. Diego, clicking the box: the answer named
   * three things on one GC and left him to find each by hand. */
  it("hands back a link per alert, straight to the record", async () => {
    const result = await runTool({ companyId: "co-1", principal: OWNER, userId: "u-1" }, "needs_attention", {});
    expect(result.links).toEqual([
      { label: "RFI 4 unanswered on Riverside", href: "/rfis", detail: "Riverside" },
      { label: "Backcharge 2 needs an answer", href: "/backcharges", detail: "Riverside" },
    ]);
  });

  it("never offers a button to a page the asker cannot open", async () => {
    // RETAINAGE_RELEASE is gated MANAGE_BILLING and points at /closeout,
    // which is MANAGE_JOBS — a real mismatch on main, recorded in
    // itemLinksCensus.test.ts's KNOWN_UNREACHABLE. ACCOUNTING holds the
    // first and not the second, so the alert reaches them and the page
    // refuses them.
    //
    // It must still be ANSWERED (they are the ones chasing the money) and
    // must not be BUTTONED. A button is a promise that the door opens.
    BY_COMPANY["co-4"] = [
      alert({ key: "r1", kind: "RETAINAGE_RELEASE", title: "Retainage on Riverside is collectable", href: "/closeout", amount: 42000 }),
      alert({ key: "r2", kind: "BACKCHARGE_RESPONSE", title: "Backcharge 2 needs an answer", href: "/backcharges" }),
    ];
    const accounting: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };
    const result = await runTool({ companyId: "co-4", principal: accounting, userId: "u-1" }, "needs_attention", {});

    const rows = result.data as { what: string }[];
    expect(rows.map((row) => row.what)).toContain("Retainage on Riverside is collectable");
    expect(result.links?.map((link) => link.href)).toEqual(["/backcharges"]);
  });
});
