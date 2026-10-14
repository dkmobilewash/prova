/**
 * /alerts after declutter round 3 (density audit #17: a 330-char paragraph,
 * a red banner and an email card sat between the header and the list, and
 * every row carried three buttons). The page half is read from SOURCE — it is
 * an async server component over the alert engine; what is pinned is its shape.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({ dismissAlert: vi.fn(), restoreAlert: vi.fn(), snoozeAlert: vi.fn() }));
vi.mock("@/lib/actions/notifications", () => ({ sendMyAlertDigest: vi.fn() }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: vi.fn(async () => "2026-10-14") }));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: vi.fn(async () => ({
    company: { id: "c1" }, id: "u1", role: "OWNER", jobFunction: null, email: null,
  })),
}));
const ALERTS = Array.from({ length: 20 }, (_, i) => ({
  key: `k${i + 1}`, kind: "LICENSE_EXPIRING", severity: i < 18 ? "OVERDUE" : "DUE_SOON",
  title: `Alert number ${i + 1}.`, detail: "d", href: "/settings", amount: null,
}));
vi.mock("@/lib/alerts-query", () => ({ loadAlerts: vi.fn(async () => ({ visible: ALERTS, silenced: [] })) }));

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const { AlertRow } = await import("@/components/AlertRow");

describe("/alerts", () => {
  it("keeps the explainer, inside a closed disclosure", () => {
    const d = page.indexOf("<Disclosure");
    expect(d).toBeGreaterThan(-1);
    expect(page.indexOf("Nothing here is stored.")).toBeGreaterThan(d);
    expect(page.indexOf("Nothing here is stored.")).toBeLessThan(page.indexOf("</Disclosure>"));
  });

  it("puts Email these to me in the header, behind one button", () => {
    const header = page.slice(page.indexOf("<PageHeader"), page.indexOf("<Disclosure"));
    expect(header).toContain('<CollapsedForm label="Email these to me"');
    expect(header).toContain("<SendDigestButton");
  });

  it("drops the banner but keeps its breakdown as plain words by the heading", () => {
    expect(page).not.toContain("<StatusLine");
    expect(page).toContain('data-alerts="breakdown"');
  });
});

describe("AlertRow", () => {
  const alert = {
    key: "k", kind: "LICENSE_EXPIRING", severity: "OVERDUE", title: "Licence", detail: "d", href: "/settings", amount: null,
  } as unknown as Parameters<typeof AlertRow>[0]["alert"];

  it("hides Snooze / Seen it only under a mouse on a wide screen, and shows them on focus", () => {
    const html = renderToStaticMarkup(<AlertRow alert={alert} silenced={false} />);
    const span = html.match(/<span data-alert-actions="secondary" class="([^"]+)">/);
    expect(span?.[1]).toContain("md:mouse:opacity-0");
    expect(span?.[1]).toContain("md:mouse:group-focus-within:opacity-100");
    expect(html).toContain("Snooze");
    expect(html).toContain("Seen it");
    expect(html).toMatch(/<li class="group /);
  });
});

describe("/alerts renders the first 15, and counts all of them", () => {
  const render = async (sp: Record<string, string> = {}) => {
    const { default: AlertsPage } = await import("./page");
    return renderToStaticMarkup(await AlertsPage({ searchParams: Promise.resolve(sp) }));
  };

  it("shows 15 rows with See all 20, while the heading and breakdown count all 20", async () => {
    const html = await render();
    expect(html).toContain("Alert number 15.");
    expect(html).not.toContain("Alert number 16.");
    expect(html).toMatch(/href="\?all=1"[^>]*>See all 20</);
    expect(html).toContain("Showing the first 15 of 20 alerts.");
    expect(html).toContain("20 needing attention");
    expect(html).toContain("18 alerts past due. 2 alerts coming up.");
  });

  it("?all=1 shows every alert and offers the way back", async () => {
    const html = await render({ all: "1" });
    expect(html).toContain("Alert number 20.");
    expect(html).toMatch(/href="\?"[^>]*>Show the first 15</);
  });
});
