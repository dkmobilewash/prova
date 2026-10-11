"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeItemHref, type NavGroup, type NavItem } from "@/components/navItems";
import { money } from "@/lib/money";
import { areaHref, type Area } from "@/lib/areas";
import { AreaIcon } from "@/components/areas/AreaParts";
import type { MoneyRailFigure, MoneyRailStage } from "@/lib/moneyRail";

/**
 * "All pages" — every destination the old left rail offered, in the rail's
 * own groups (navItems.tsx's NAV_GROUPS, filtered by `navGroupsFor`), laid
 * out as one calm full-width panel instead of a column of collapsed headings.
 *
 * Concept G removed the sidebar; this is how nothing became unreachable. The
 * caller hands in the groups already filtered by capability, business scope
 * and the operator flag, so this file decides layout only — the same split
 * Sidebar.tsx had. Every group is open: there is room, and a page hidden
 * behind a chevron is the thing the owner asked to get rid of.
 *
 * The Money Rail's five figures moved here with the groups, on the headings
 * they used to sit on. They arrive fully computed from lib/moneyRail.ts via
 * the layout, and only for a principal with VIEW_COMPANY_FINANCIALS — an
 * empty `stages` draws headings without figures.
 */

/** Which pipeline stage a group's heading carries. Keyed by heading TEXT from
 * navItems.tsx, so allPagesMenu.test.ts asserts every key is a real heading
 * and all five stages are placed — a rename there fails a test instead of
 * silently dropping a figure. "Proving" (RFIs out, submittals with the GC)
 * sits on Paper trail, the group that holds /rfis and /submittals. */
export const STAGE_KEY_FOR_HEADING: Record<string, MoneyRailStage["key"]> = {
  "Pre-construction": "bidding",
  Operations: "building",
  "Paper trail": "proving",
  "Compliance & safety": "staying-legal",
  Financials: "getting-paid",
};

function figureMain(figure: MoneyRailFigure): string {
  return figure.kind === "money" ? money(figure.amount) : String(figure.n);
}

function StageFigure({ stage }: { stage: MoneyRailStage }) {
  return (
    <span className="mt-1 block" title={stage.detail}>
      <span className="block text-lg font-semibold leading-tight tabular-nums text-link">
        {figureMain(stage.figure)}
      </span>
      <span className="block text-xs text-ink-muted">
        {stage.figure.kind === "money" ? stage.label : `${stage.label} · ${stage.figure.noun}`}
      </span>
    </span>
  );
}

function PageLink({ item, active }: { item: NavItem & { disabled?: boolean }; active: boolean }) {
  if (item.disabled) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} — coming soon`}
        className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-lg px-2 text-[15px] text-ink-muted"
      >
        <span className="shrink-0 opacity-50">{item.icon}</span>
        {item.label}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-2 text-[15px] font-medium transition-colors ${
        active ? "bg-rail-hover text-ink shadow-[inset_3px_0_0_rgb(var(--c-brand))]" : "text-ink-body hover:bg-rail-hover hover:text-ink"
      }`}
    >
      <span className="shrink-0 text-ink-muted">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AllPagesMenu({
  open,
  onClose,
  groups,
  footer,
  stages,
  areas = [],
}: {
  open: boolean;
  onClose: () => void;
  /** Already filtered by `navGroupsFor` — see the header. */
  groups: NavGroup[];
  /** Settings and the like, already filtered by `navFooterFor`. */
  footer: NavItem[];
  stages: MoneyRailStage[];
  /** The six areas (lib/areas.ts), already narrowed by `areasFor`. */
  areas?: Area[];
}) {
  const pathname = usePathname();
  const closeButton = useRef<HTMLButtonElement>(null);

  // Closing on navigation is the caller's job (TopBar), which owns `open`.
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const activeHref = activeItemHref(groups, pathname);
  const footerActive = footer.find((f) => pathname === f.href)?.href;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All pages"
      className="print:hidden fixed inset-x-0 bottom-0 top-14 z-50 overflow-y-auto border-t border-line-row bg-canvas md:top-16"
    >
      <div className="mx-auto max-w-[1344px] px-4 pb-24 pt-6 md:px-12 md:pb-12">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-headline text-[28px] leading-tight text-ink">All pages</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-line-card px-4 text-sm font-medium text-ink-body hover:bg-rail-hover hover:text-ink"
          >
            Close
          </button>
        </div>
        <Link
          href="/ask"
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-card px-4 text-[15px] font-medium text-ink hover:bg-rail-hover"
        >
          Ask C Stream a question
        </Link>
        {areas.length > 0 ? (
          <nav aria-label="Areas" className="mt-6 flex flex-wrap gap-2" data-nav-group="Areas">
            {areas.map((area) => (
              <Link
                key={area.slug}
                href={areaHref(area.slug)}
                aria-current={pathname === areaHref(area.slug) ? "page" : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-card bg-surface px-3.5 text-[15px] font-medium text-ink hover:bg-rail-hover"
              >
                <AreaIcon paths={area.icon} className="h-[18px] w-[18px] text-ink-muted" />
                {area.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <nav aria-label="All pages" className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((group) => {
            const stageKey = STAGE_KEY_FOR_HEADING[group.heading];
            const stage = stageKey ? stageByKey.get(stageKey) : undefined;
            return (
              <section
                key={group.heading}
                data-nav-group={group.heading}
                className="rounded-2xl border border-line-card bg-surface px-4 py-4"
              >
                <h3 className="px-2 font-headline text-[22px] leading-tight text-ink">{group.heading}</h3>
                <p className="mt-1 px-2 text-[13px] leading-snug text-ink-muted">{group.description}</p>
                {stage ? (
                  <div className="px-2">
                    <StageFigure stage={stage} />
                  </div>
                ) : null}
                <div className="mt-3 flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <PageLink key={item.href} item={item} active={activeHref === item.href} />
                  ))}
                </div>
              </section>
            );
          })}
          {footer.length > 0 ? (
            <section data-nav-group="Account" className="rounded-2xl border border-line-card bg-surface px-4 py-4">
              <h3 className="px-2 font-headline text-[22px] leading-tight text-ink">Account</h3>
              <p className="mt-1 px-2 text-[13px] leading-snug text-ink-muted">Your company settings and connected apps.</p>
              <div className="mt-3 flex flex-col gap-0.5">
                {footer.map((item) => (
                  <PageLink key={item.href} item={item} active={footerActive === item.href} />
                ))}
              </div>
            </section>
          ) : null}
        </nav>
      </div>
    </div>
  );
}
