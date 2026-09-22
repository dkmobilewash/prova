import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `searchApp` keeps the promise its own file comment makes: it returns a
 * failure, and never throws.
 *
 * It did not. `globalSearch` fans out to every provider the caller can
 * reach, and there was no `try` in the file — so one provider rejecting
 * rejected the action, which reached `SearchLauncher` as an unhandled
 * rejection inside a `setTimeout` callback and left the panel on
 * "Searching…" until it was closed.
 *
 * THE SECOND CASE IS THE ONE WORTH READING. The naive fix — wrap the whole
 * body, `requireCompanyContext()` included — is worse than the bug. That
 * call REDIRECTS a signed-out caller, and in Next a redirect is a thrown
 * control signal, not an error. Catching it would convert "you need to
 * sign in" into "search is unavailable" and strand the user on a page they
 * are not entitled to see anything on. `shared.ts`'s `runAction` states
 * the same rule for form actions; this file follows it, and the test below
 * is what holds it.
 */

const context = {
  company: { id: "co_1", name: "Acme Drywall" },
  id: "user_1",
  name: "Jamie Foreman",
  email: "jamie@acmedrywall.example",
  role: "MEMBER" as string,
  jobFunction: "ACCOUNTING" as string | null,
};

const requireCompanyContext = vi.fn();
const globalSearch = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: (...args: unknown[]) => requireCompanyContext(...args),
}));

vi.mock("@/lib/search/query", () => ({
  globalSearch: (...args: unknown[]) => globalSearch(...args),
}));

const { searchApp } = await import("./search");

beforeEach(() => {
  vi.clearAllMocks();
  requireCompanyContext.mockResolvedValue(context);
  globalSearch.mockResolvedValue({ records: [], pages: [] });
});

describe("searchApp", () => {
  it("returns a readable failure when a provider throws, rather than rejecting", async () => {
    globalSearch.mockRejectedValue(new Error("Timed out fetching a new connection from the connection pool"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchApp("riverside");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/try again/i);
  });

  it("does not leak the thrown message, which production redacts for a reason", async () => {
    // A Prisma error names columns, and a connection error can name a host.
    globalSearch.mockRejectedValue(new Error("column Invoice.secretThing does not exist"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchApp("anything");
    expect(result.ok === false && result.error).not.toMatch(/secretThing|column/i);
  });

  it("lets the sign-in redirect through instead of swallowing it", async () => {
    // requireCompanyContext calls redirect("/sign-in"), which THROWS. If
    // that call sat inside the try, this would come back as a tidy
    // { ok: false } and the caller would never be sent to sign in.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/sign-in;307;" });
    requireCompanyContext.mockRejectedValue(redirect);

    await expect(searchApp("anything")).rejects.toThrow("NEXT_REDIRECT");
    expect(globalSearch).not.toHaveBeenCalled();
  });

  it("passes the caller's own company and role, never anything from the argument", async () => {
    await searchApp("riverside");
    expect(globalSearch).toHaveBeenCalledWith({
      companyId: "co_1",
      principal: { role: "MEMBER", jobFunction: "ACCOUNTING" },
      query: "riverside",
    });
  });

  it("returns the results on the happy path", async () => {
    // The control: an action that failed everything would pass the first
    // two assertions in this file.
    const value = { records: [], pages: [{ kind: "page", route: "/photos", title: "Photos", href: "/photos" }] };
    globalSearch.mockResolvedValue(value);

    await expect(searchApp("photos")).resolves.toEqual({ ok: true, value });
  });

  it("refuses a non-string query without calling anything", async () => {
    const result = await searchApp(42 as unknown as string);
    expect(result.ok).toBe(false);
    expect(requireCompanyContext).not.toHaveBeenCalled();
  });
});
