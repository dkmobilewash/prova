"use client";

import { useEffect, useState } from "react";
import { activeGroupHeading, type NavGroup } from "@/components/navItems";

/**
 * Which nav group is open, for the desktop rail and the mobile drawer.
 *
 * One group at a time — the one holding the current page — and a header
 * tap swaps to that group or closes it. Navigating re-opens the group of
 * the page you arrived on, so the rail always shows where you are even if
 * you had been browsing another group's headers.
 *
 * Shared for the same reason NAV_GROUPS is: a rule applied in one surface
 * and forgotten in the other is a rail and a drawer that disagree about
 * where a page lives. The pure part, `activeGroupHeading`, is pinned in
 * navItems.test.ts; this file only owns the state.
 */
export function useNavAccordion(groups: NavGroup[], pathname: string) {
  const active = activeGroupHeading(groups, pathname);
  const [open, setOpen] = useState<string | null>(active);

  useEffect(() => {
    setOpen(active);
  }, [active]);

  const toggle = (heading: string) => setOpen((current) => (current === heading ? null : heading));

  return { open, active, toggle };
}
