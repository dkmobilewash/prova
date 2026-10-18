import type { CSSProperties } from "react";

/** The pure half of components/NavigationProgress.tsx, in a plain module so
 * tests and server code import the values rather than a client reference. */

export type Phase = "idle" | "start" | "loading" | "done";

type Click = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;
type Anchor = { href: string; target: string; download: boolean };

/** True when this click on this anchor is a same-origin navigation the
 * app router will handle in place — the only clicks the bar should start on. */
export function startsNavigation(click: Click, anchor: Anchor, here: string): boolean {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if ((anchor.target && anchor.target !== "_self") || anchor.download) return false;
  let to: URL;
  try {
    to = new URL(anchor.href, here);
  } catch {
    return false;
  }
  const from = new URL(here);
  if (to.origin !== from.origin) return false;
  // Same page, or a hash jump on it: nothing will render, so nothing would finish the bar.
  return to.pathname !== from.pathname || to.search !== from.search;
}

const SCALE: Record<Exclude<Phase, "idle">, number> = { start: 0.08, loading: 0.85, done: 1 };

export function barStyle(phase: Exclude<Phase, "idle">, reducedMotion: boolean): CSSProperties {
  const ms = phase === "loading" ? 8000 : phase === "done" ? 200 : 0;
  return {
    transform: `scaleX(${SCALE[phase]})`,
    transitionDuration: reducedMotion ? "0ms" : `${ms}ms`,
    transitionTimingFunction: "var(--ease-landing)",
  };
}
