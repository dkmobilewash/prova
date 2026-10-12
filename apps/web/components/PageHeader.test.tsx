import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader, trailFor } from "./PageHeader";

describe("PageHeader", () => {
  it("derives Home / <Area> / <Page> from lib/areas.ts", () => {
    expect(trailFor("/rfis")).toEqual({
      trail: [
        { href: "/dashboard", label: "Home" },
        { href: "/areas/paperwork", label: "Paperwork" },
      ],
      current: "RFIs",
    });
    expect(trailFor("/dashboard")?.trail.map((c) => c.label)).toEqual(["Home", "Jobs & bids"]);
    expect(trailFor("/settings")).toBeNull();
  });

  it("renders the one breadcrumb convention and the headline scale", () => {
    const html = renderToStaticMarkup(<PageHeader route="/rfis" subtitle="Questions" />);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toMatch(/href="\/dashboard"[^>]*>Home</);
    expect(html).toMatch(/href="\/areas\/paperwork"[^>]*>Paperwork</);
    expect(html).toMatch(/aria-current="page"[^>]*>RFIs</);
    expect(html).toMatch(/<h1 class="font-headline text-\[32px\][^"]*">RFIs<\/h1>/);
    // A route in no area still gets Home / <title>, not a fourth convention.
    const settings = renderToStaticMarkup(<PageHeader route="/settings" title="Settings" />);
    expect(settings).toMatch(/aria-current="page"[^>]*>Settings</);
    expect(settings).not.toContain("/areas/");
  });
});
