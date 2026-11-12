import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ClerkClient } from "@clerk/backend";
import { PERSONAS } from "./personas";
import { deleteThrowaway, isThrowaway, staleThrowaways, sweepThrowaways, throwawayEmail } from "./throwawayUsers.mjs";

// The dev Clerk instance caps at 100 users and every walk left one behind; the cap broke e2e and
// walks more than once. Each run must delete its own user and a daily job the leftovers, and
// neither may ever touch a CI persona.
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const user = (id: string, emails: string[], ageMs: number) => ({ id, createdAt: NOW - ageMs, emailAddresses: emails.map((emailAddress) => ({ emailAddress })) });

function fakeClerk(users: ReturnType<typeof user>[]) {
  const deleted: string[] = [];
  const clerk = {
    users: {
      getUserList: vi.fn(async (p: { emailAddress?: string[]; limit?: number; offset?: number }) => {
        const all = p.emailAddress ? users.filter((u) => u.emailAddresses.some((e) => p.emailAddress!.includes(e.emailAddress))) : users;
        const data = all.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 10));
        return { data, totalCount: all.length };
      }),
      deleteUser: vi.fn(async (id: string) => void deleted.push(id)),
    },
  } as unknown as ClerkClient;
  return { clerk, deleted };
}

describe("which users are throwaways", () => {
  it("never a CI persona", () => {
    const emails = Object.values(PERSONAS).map((p) => p.email);
    expect(emails.length).toBeGreaterThanOrEqual(10);
    for (const email of emails) expect(isThrowaway(email), email).toBe(false);
  });
  it("a run's own address, and nothing shaped like a persona or a person", () => {
    expect(isThrowaway(throwawayEmail("walk"))).toBe(true);
    expect(isThrowaway("pricelist-1731400000000+clerk_test@example.com")).toBe(true);
    expect(isThrowaway("e2e-1731400000000+clerk_test@example.com")).toBe(false);
    expect(isThrowaway("walk-1731400000000@example.com")).toBe(false);
    expect(isThrowaway("diego+clerk_test@example.com")).toBe(false);
    expect(() => throwawayEmail("e2e")).toThrow();
  });
  it("the sweep takes only all-throwaway users older than a day", () => {
    const users = [
      user("old", ["walk-1731400000000+clerk_test@example.com"], 2 * DAY),
      user("young", ["walk-1731400000001+clerk_test@example.com"], DAY / 2),
      user("persona", ["e2e-main+clerk_test@example.com"], 30 * DAY),
      user("mixed", ["walk-1731400000002+clerk_test@example.com", "someone@example.com"], 30 * DAY),
      user("noemail", [], 30 * DAY),
    ];
    expect(staleThrowaways(users, NOW).map((u) => u.id)).toEqual(["old"]);
  });
});

describe("deleting", () => {
  it("a run deletes its own user, and refuses a persona without throwing", async () => {
    const { clerk, deleted } = fakeClerk([user("mine", ["walk-1731400000000+clerk_test@example.com"], 0), user("p", ["e2e-main+clerk_test@example.com"], 0)]);
    expect(await deleteThrowaway("walk-1731400000000+clerk_test@example.com", clerk)).toBe(1);
    expect(await deleteThrowaway("e2e-main+clerk_test@example.com", clerk)).toBe(0);
    expect(deleted).toEqual(["mine"]);
  });
  it("a cleanup error never fails the run", async () => {
    const clerk = { users: { getUserList: async () => { throw new Error("429"); } } } as unknown as ClerkClient;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deleteThrowaway("walk-1731400000000+clerk_test@example.com", clerk)).resolves.toBe(0);
    warn.mockRestore();
  });
  it("the sweep pages past 100 users", async () => {
    const users = Array.from({ length: 150 }, (_, i) => user(`u${i}`, [`walk-${1731400000000 + i}+clerk_test@example.com`], 2 * DAY));
    const { clerk, deleted } = fakeClerk(users);
    expect(await sweepThrowaways(clerk, NOW)).toEqual({ total: 150, deleted: 150 });
    expect(deleted).toHaveLength(150);
  });
});

describe("census: every run cleans up, and the daily sweep exists", () => {
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const specs = readdirSync(path.join(web, "e2e"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => ({ f, src: readFileSync(path.join(web, "e2e", f), "utf8") }));

  it("no spec mints a +clerk_test address of its own; it takes one from throwawayEmail", () => {
    expect(specs.length).toBeGreaterThan(50);
    const minting = specs.filter(({ src }) => /\$\{Date\.now\(\)\}\+clerk_test@/.test(src)).map(({ f }) => f);
    expect(minting).toEqual([]);
  });
  it("every spec that takes a throwaway deletes it in an afterAll", () => {
    const users = specs.filter(({ src }) => /throwawayEmail\(/.test(src));
    expect(users.length).toBeGreaterThanOrEqual(7);
    const leaking = users.filter(({ src }) => !/afterAll\(async \(\) => \{ await deleteThrowaway\(EMAIL\); \}\)/.test(src)).map(({ f }) => f);
    expect(leaking).toEqual([]);
  });
  it("a daily workflow runs the sweep, on a development key only", () => {
    const yml = readFileSync(path.join(web, "../../.github/workflows/clerk-sweep.yml"), "utf8");
    expect(yml).toMatch(/schedule:\n\s+- cron: "\d+ \d+ \* \* \*"/);
    expect(yml).toContain("node apps/web/e2e/sweep-clerk-users.mjs");
    expect(yml).toContain("sk_test_*)");
  });
});
