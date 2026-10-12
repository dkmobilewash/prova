import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/permissions";
import { actionsFor, buildSections, highlight, looksLikeAsk, type PaletteResponse } from "./palette";

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };
const ACCOUNTING: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };
const ESTIMATOR: Principal = { role: "MEMBER", jobFunction: "ESTIMATOR" };

const rec = (type: string, id: string, title: string) => ({
  kind: "record" as const,
  type,
  id,
  title,
  subtitle: null,
  href: type === "job" ? `/jobs/${id}` : `/${type}s`,
});

const data = (over: Partial<PaletteResponse> = {}): PaletteResponse => ({
  records: [],
  pages: [],
  recentJobs: [rec("job", "j1", "Northgate Medical Office")],
  actions: actionsFor(OWNER),
  navPages: [
    { href: "/rfis", label: "RFIs", group: "Paper trail" },
    { href: "/ask", label: "Ask C Stream", group: "Today" },
    { href: "/vendors", label: "Vendors", group: "Office" },
  ],
  ...over,
});

describe("actionsFor — only actions this person can carry out", () => {
  it("gives an owner every shortcut, Log a bid after New job and the create verbs after the original four", () => {
    expect(actionsFor(OWNER).map((a) => a.id)).toEqual([
      "new-job",
      "log-bid",
      "log-hours",
      "send-pay-app",
      "find-rfi",
      "raise-rfi",
      "daily-report",
      "add-photo",
      "new-submittal",
      "order-material",
      "add-punch",
      "log-co",
      "add-backcharge",
    ]);
  });

  it("withholds Log a bid from someone /bids refuses, query string and all", () => {
    // /bids?new=1 is /bids (MANAGE_ESTIMATING); FIELD does not hold it.
    expect(actionsFor(FIELD).map((a) => a.id)).not.toContain("log-bid");
  });

  it("opens each create on its form, gated like the page it opens — the query string does not slip the gate", () => {
    const owner = Object.fromEntries(actionsFor(OWNER).map((a) => [a.id, a]));
    expect(owner["raise-rfi"].href).toBe("/rfis?new=1");
    expect(owner["daily-report"].href).toBe("/field-reports?new=1");
    expect(owner["add-photo"].jobTab).toBe("photos");
    expect(owner["log-co"].jobTab).toBe("estimate#change-orders");
    // "/rfis?new=1" is not a ROUTE_CAPABILITY key; read as-is it would be
    // open to everyone. ACCOUNTING holds no MANAGE_JOBS or MANAGE_FIELD.
    const accounting = actionsFor(ACCOUNTING).map((a) => a.id);
    for (const id of ["raise-rfi", "new-submittal", "daily-report", "order-material", "add-punch", "add-photo"]) expect(accounting, id).not.toContain(id);
    expect(accounting).toContain("add-backcharge");
    expect(accounting).toContain("log-co");
    // FIELD: no billing, no job costs.
    const field = actionsFor(FIELD).map((a) => a.id);
    expect(field).toEqual(expect.arrayContaining(["raise-rfi", "daily-report", "add-photo", "new-submittal", "order-material", "add-punch"]));
    for (const id of ["add-backcharge", "log-co"]) expect(field, id).not.toContain(id);
    expect(actionsFor(ESTIMATOR).map((a) => a.id)).not.toContain("daily-report");
  });

  it("withholds Send pay app from someone without MANAGE_BILLING", () => {
    const ids = actionsFor(FIELD).map((a) => a.id);
    expect(ids).not.toContain("send-pay-app");
    expect(ids).toContain("log-hours");
  });
});

describe("buildSections", () => {
  it("empty query: recent jobs, the shortcut actions, and every page", () => {
    const s = buildSections(data(), "", null);
    expect(s.map((x) => x.heading)).toEqual(["Recent jobs", "Actions", "All pages"]);
    expect(s[2].entries).toHaveLength(3);
  });

  it("typed: groups server records into Jobs / People / Documents, in that order", () => {
    const s = buildSections(
      data({ records: [rec("rfi", "r1", "RFI #27 — north wall"), rec("contact", "c1", "Jamal North"), rec("job", "j1", "Northgate")] }),
      "north",
      null,
    );
    expect(s.map((x) => x.heading)).toEqual(["Jobs", "People", "Documents"]);
  });

  it("typed: matches actions and nav pages locally, and never lists a page twice", () => {
    const s = buildSections(
      data({ pages: [{ kind: "page", route: "/rfis", title: "RFIs", href: "/rfis" }] }),
      "rfi",
      null,
    );
    expect(s.find((x) => x.heading === "Actions")?.entries.map((e) => e.title)).toEqual(["Find an RFI", "Raise an RFI"]);
    expect(s.find((x) => x.heading === "Pages")?.entries.map((e) => e.href)).toEqual(["/rfis"]);
  });

  it("offers Ask only for a question or command, prefilled through the URL", () => {
    expect(buildSections(data(), "northgate", null).some((x) => x.heading === "Ask")).toBe(false);
    const ask = buildSections(data(), "bill Northgate for October", null).find((x) => x.heading === "Ask");
    expect(ask?.entries[0].href).toBe("/ask?q=bill%20Northgate%20for%20October");
    // The one row that can cost a model call says so, first.
    expect(ask?.entries[0].subtitle).toMatch(/^Uses AI/);
  });

  it.each([
    ["crews", "Log hours"],
    ["hours", "Log hours"],
    ["timesheet", "Log hours"],
    ["co", "Log a change order"],
    ["invoice", "Send pay app"],
    ["pay app", "Send pay app"],
    ["dfr", "Daily report"],
    ["daily", "Daily report"],
    ["pics", "Add a photo"],
    ["sub", "New submittal"],
    ["backcharge", "Add a backcharge"],
    ["punch", "Add punch item"],
    ["material", "Order material"],
  ])("finds the verb a sub says: %s -> %s", (query, title) => {
    const actions = buildSections(data(), query, null).find((x) => x.heading === "Actions")?.entries.map((e) => e.title) ?? [];
    expect(actions).toContain(title);
  });

  it("'crews' reaches the schedule and the team, whose labels never say crew", () => {
    const navPages = [
      { href: "/schedule", label: "Schedule", group: "Field" },
      { href: "/team", label: "Team", group: "Office" },
      { href: "/vendors", label: "Vendors", group: "Office" },
    ];
    const pages = buildSections(data({ navPages }), "crews", null).find((x) => x.heading === "Pages")?.entries.map((e) => e.href);
    expect(pages).toEqual(["/schedule", "/team"]);
  });

  it("does not offer Ask to someone whose pages do not include /ask", () => {
    const s = buildSections(data({ navPages: [] }), "who is on Harbor today?", null);
    expect(s.some((x) => x.heading === "Ask")).toBe(false);
  });

  it("Log hours opens a job picker whose jobs go to that job's crew tab", () => {
    const logHours = actionsFor(OWNER).find((a) => a.id === "log-hours")!;
    const entry = buildSections(data(), "", null)
      .find((x) => x.heading === "Actions")!
      .entries.find((e) => e.title === "Log hours")!;
    expect(entry.href).toBeUndefined();
    expect(entry.pick).toEqual(logHours);
    const picker = buildSections(data(), "", logHours);
    expect(picker.map((x) => x.heading)).toEqual(["Recent jobs"]);
    expect(picker[0].entries[0].href).toBe("/jobs/j1/crew");
  });
});

describe("highlight", () => {
  it("marks every case-insensitive match and keeps the original case", () => {
    expect(highlight("Northgate — North wing", "north")).toEqual([
      { text: "North", hit: true },
      { text: "gate — ", hit: false },
      { text: "North", hit: true },
      { text: " wing", hit: false },
    ]);
  });

  it("treats regex characters in the query as text", () => {
    expect(highlight("RFI (27)", "(27")).toEqual([
      { text: "RFI ", hit: false },
      { text: "(27", hit: true },
      { text: ")", hit: false },
    ]);
  });
});

describe("looksLikeAsk", () => {
  it.each(["bill Northgate for October", "who is on Harbor today?", "how much is left to bill on Bayview"])("asks: %s", (q) => {
    expect(looksLikeAsk(q)).toBe(true);
  });
  it.each(["northgate", "RFI 27", "Jamal", "bill"])("searches: %s", (q) => {
    expect(looksLikeAsk(q)).toBe(false);
  });
});
