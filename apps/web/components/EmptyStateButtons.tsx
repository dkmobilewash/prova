"use client";

import { usePathname, useRouter } from "next/navigation";
import { walkthroughFor } from "@/lib/walkthroughs";
import {
  primaryActionClass as primaryClass,
  secondaryActionClass as secondaryClass,
  tertiaryActionClass,
} from "@/components/emptyStateStyles";
import { ASK_PREFILL_EVENT, WALKTHROUGH_EVENT, setPendingAsk } from "@/lib/empty-state-events";

/**
 * The three buttons an empty state can carry that are not plain links.
 * Each one hands off to something that already exists on the page or in
 * the chrome, rather than growing a second copy of it:
 *
 *   - OpenFormButton presses the page's OWN add button (found by its
 *     `data-tour` anchor), so the form that opens is the real one, with its
 *     real validation, in the place the page already puts it.
 *   - AskItButton opens the Topbar assistant with a sentence typed in.
 *   - WalkthroughButton starts the tour the Help panel offers.
 */

/**
 * Presses the first button inside `[data-tour=<target>]` — the page's own
 * collapsed "Add a …" button — and brings it into view. If the form is
 * already open there is no collapsed button to press, and the first field
 * gets the focus instead, which is the same outcome from the other side.
 */
export function OpenFormButton({
  target,
  label,
  primary,
}: {
  target: string;
  label: string;
  primary: boolean;
}) {
  return (
    <button
      type="button"
      data-opens={target}
      className={primary ? primaryClass : secondaryClass}
      onClick={() => {
        const find = () => document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
        const firstField = (el: HTMLElement | null) =>
          el?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ?? null;
        const holder = find();
        if (!holder) return;
        holder.scrollIntoView({ behavior: "smooth", block: "center" });
        const open = firstField(holder);
        if (open) {
          open.focus();
          return;
        }
        // The anchor is either the collapsed button itself or a wrapper
        // around it, depending on the page.
        const press = holder.matches("button") ? (holder as HTMLButtonElement) : holder.querySelector("button");
        press?.click();
        // Re-found after the click: the button is REPLACED by the form, and
        // on some pages the anchor moves to the form with it.
        requestAnimationFrame(() => firstField(find())?.focus());
      }}
    >
      {label}
    </button>
  );
}

export function AskItButton({ example }: { example: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={secondaryClass}
      onClick={() => {
        setPendingAsk(example);
        // A panel already open takes it now; otherwise the launcher's panel
        // takes it as it mounts.
        window.dispatchEvent(new CustomEvent(ASK_PREFILL_EVENT, { detail: example }));
        const launcher = document.querySelector<HTMLButtonElement>("[data-ask-launcher]");
        if (launcher) {
          if (launcher.getAttribute("aria-expanded") !== "true") launcher.click();
          launcher.scrollIntoView({ block: "nearest" });
        } else {
          router.push("/ask");
        }
      }}
    >
      Ask C Stream to do it
    </button>
  );
}

/** Rendered only on a page that has a walkthrough — never a dead button. */
export function WalkthroughButton() {
  const pathname = usePathname();
  if (!walkthroughFor(pathname)) return null;
  return (
    <button
      type="button"
      className={tertiaryActionClass}
      onClick={() => window.dispatchEvent(new Event(WALKTHROUGH_EVENT))}
    >
      Walk me through this page
    </button>
  );
}
