import { describe, expect, it } from "vitest";
import type { Principal } from "@/lib/permissions";
import { actionsFor, buildSections, highlight, looksLikeAsk, type PaletteResponse } from "./palette";

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

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
  it("gives an owner all four shortcuts", () => {
    expect(actionsFor(OWNER).map((a) => a.id)).toEqual(["new-job", "log-hours", "send-pay-app", "find-rfi"]);
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
    expect(s.find((x) => x.heading === "Actions")?.entries.map((e) => e.title)).toEqual(["Find an RFI"]);
    expect(s.find((x) => x.heading === "Pages")?.entries.map((e) => e.href)).toEqual(["/rfis"]);
  });

  it("offers Ask only for a question or command, prefilled through the URL", () => {
    expect(buildSections(data(), "northgate", null).some((x) => x.heading === "Ask")).toBe(false);
    const ask = buildSections(data(), "bill Northgate for October", null).find((x) => x.heading === "Ask");
    expect(ask?.entries[0].href).toBe("/ask?q=bill%20Northgate%20for%20October");
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
