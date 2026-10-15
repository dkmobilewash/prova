import Link from "next/link";
import type { ReactNode } from "react";
import { AREAS, areaHref, toolRoute } from "@/lib/areas";
import { NAV_ITEMS } from "@/components/navItems";

/**
 * THE ONE BREADCRUMB AND THE ONE PAGE TITLE (Concept G, 2026-10-11).
 *
 * Three back-navigation conventions existed across the new pages — the area
 * page's inline `Home / Paperwork`, the job header's "← All jobs", and
 * nothing at all on /ai/activity — and the forty old-look pages had none.
 * This is the one every list page now uses: `Home / <Area> / <Page>`, the
 * trail LINKED and the current page plain, derived from lib/areas.ts so the
 * crumb and the area card that opened the page cannot disagree on a name.
 *
 * `route` is the nav href the page stands for (the AreaTool's `toolRoute`).
 * A route in no area — /settings, /ask — gets `Home / <title>`, which is
 * still the same convention rather than a fourth one.
 */

export type Crumb = { href: string; label: string };

export function trailFor(route: string): { trail: Crumb[]; current: string } | null {
  for (const area of AREAS) {
    const tool = area.tools.find((t) => toolRoute(t) === route);
    if (tool) {
      return {
        trail: [
          { href: "/dashboard", label: "Home" },
          { href: areaHref(area.slug), label: area.name },
        ],
        current: tool.name,
      };
    }
  }
  return null;
}

export function Breadcrumb({ trail, current }: { trail: Crumb[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
      {trail.map((crumb) => (
        <span key={crumb.href}>
          <Link
            href={crumb.href}
            className="inline-flex min-h-11 items-center hover:text-ink hover:underline mouse:min-h-7"
          >
            {crumb.label}
          </Link>
          <span aria-hidden className="mx-2">
            /
          </span>
        </span>
      ))}
      <span aria-current="page" className="font-medium text-ink">
        {current}
      </span>
    </nav>
  );
}

/**
 * Breadcrumb, headline and one-line standfirst, with an optional right-hand
 * slot for the page's single primary action (the button that opens the
 * collapsed add form). `title` defaults to the area tool's name.
 */
export function PageHeader({
  route,
  title,
  subtitle,
  actions,
  parent,
  children,
}: {
  route: string;
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** The page(s) above this one, for a page that hangs off another — a
   * contact's own page under Contacts, Integrations under Settings, a
   * job's printable form under the job. Added to the end of the trail, so
   * the crumb still goes all the way home. */
  parent?: Crumb | Crumb[];
  children?: ReactNode;
}) {
  const found = trailFor(route);
  const trail = [...(found?.trail ?? [{ href: "/dashboard", label: "Home" }]), ...[parent ?? []].flat()];
  // A route in no area but in the nav (/settings/integrations) is named by
  // its nav label. It fell through to `route` and printed the raw path as
  // the H1 and the crumb (density audit, incidental).
  const heading = title ?? found?.current ?? NAV_ITEMS.find((item) => item.href === route)?.label ?? route;
  return (
    <header className="mb-6">
      <Breadcrumb trail={trail} current={heading} />
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-headline text-[32px] font-semibold leading-tight text-ink">{heading}</h1>
          {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
