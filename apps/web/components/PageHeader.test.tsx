import { readFileSync } from "node:fs";
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

  // Polish round 2026-10-11: /hours was the one Crew & field page still on a
  // bare <h1> with no way back up.
  it("/hours wears it: Home / Crew & field / Hours", () => {
    expect(trailFor("/hours")).toEqual({
      trail: [
        { href: "/dashboard", label: "Home" },
        { href: "/areas/crew-field", label: "Crew & field" },
      ],
      current: "Hours",
    });
    const source = readFileSync(new URL("../app/(app)/hours/page.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/<PageHeader\s+route="\/hours"/);
    expect(source).not.toMatch(/<h1/);
  });

  it("adds the parent page to the trail for a page that hangs off another", () => {
    const html = renderToStaticMarkup(
      <PageHeader route="/settings/integrations" parent={{ href: "/settings", label: "Settings" }} title="Integrations" />,
    );
    expect(html).toMatch(/href="\/dashboard"[^>]*>Home<.*href="\/settings"[^>]*>Settings<.*aria-current="page"[^>]*>Integrations</s);
    const contact = renderToStaticMarkup(
      <PageHeader route="/contacts" parent={{ href: "/contacts", label: "Contacts" }} title="Northside Builders" />,
    );
    expect(contact).toMatch(/>Jobs &amp; bids<.*href="\/contacts"[^>]*>Contacts<.*aria-current="page"[^>]*>Northside Builders</s);
    const form = renderToStaticMarkup(
      <PageHeader
        route="/dashboard"
        parent={[
          { href: "/jobs/j1", label: "Oak Ave" },
          { href: "/jobs/j1/certified-payroll", label: "Certified payroll" },
        ]}
        title="Form WH-347"
      />,
    );
    expect(form).toMatch(/href="\/jobs\/j1"[^>]*>Oak Ave<.*href="\/jobs\/j1\/certified-payroll"[^>]*>Certified payroll<.*>Form WH-347</s);
  });
});
