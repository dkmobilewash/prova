"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { requestHelp } from "@/lib/actions";
import {
  MAX_HELP_MESSAGE_LENGTH,
  helpMailtoHref,
  helpSubject,
  type HelpChannel,
} from "@/lib/help-request";
import { inputClass } from "@/components/RfiFields";
import { WalkthroughTour, isAnchorShown } from "@/components/WalkthroughTour";
import { walkthroughFor, type Walkthrough } from "@/lib/walkthroughs";
import { browserStorage, markFinished, readFinished, shownSteps } from "@/lib/walkthroughs/engine";
import { WALKTHROUGH_EVENT } from "@/lib/empty-state-events";
import { startFullTour } from "@/lib/walkthroughs/full-tour";

/**
 * The way out of the app to a human, on every screen.
 *
 * WHY IT IS IN THE TOPBAR. Three shapes were possible and two are worse:
 *
 *   - A fixed bubble in a corner is the universal signifier of live chat,
 *     and it promises a reply in seconds from a company of two. It also
 *     sits ON the content — over the last row of a takeoff table on a
 *     laptop, over the Save button of a field report on a phone.
 *   - A footer link would have to live in `MetricBar`, which is gated on
 *     VIEW_COMPANY_FINANCIALS. The help link would then be invisible to
 *     exactly the people most likely to need it — a foreman with no money
 *     permission — which is the worst possible place to put it.
 *   - A rail item would be one of 27 labels inside six collapsed groups
 *     (#240), invisible until somebody expands the right one. And help is
 *     not a place in the app; it is something you do from wherever you are.
 *
 * So it goes next to the alert bell, in chrome that is already on every
 * page, costs no content area, and renders the same on a phone. It is one
 * icon and one word, not a badge and not an animation.
 *
 * DELIBERATELY NOT A CHAT, the same call `AskPanel` made and for the same
 * reason: no thread, no history, no typing indicator, no "we usually reply
 * in a few minutes". One question, sent, with an honest expectation printed
 * next to the button.
 *
 * AND THE TOUR LIVES HERE TOO. "Walk me through this page" sits at the top
 * of this panel, above the question form, because this is the one control
 * guaranteed to be on every page — the same argument as above. It appears
 * only on a page that has a walkthrough AND has at least one of its steps
 * on screen; a page without one gets no button, never a dead one. The tour
 * itself is mounted from here so it survives the panel closing, and ends
 * on navigation for the same reason the panel does.
 *
 * "TAKE THE FULL TOUR" SITS ABOVE IT, on every page: one walk across the
 * app rather than around this page. It is started from here but run by
 * `FullTour` in the layout, because it outlives the page changes it makes.
 */
export function HelpButton({
  companyName,
  /** Resolved on the server by `helpChannelFromEnv()`. The panel offers
   * exactly what the action will accept, because both read the same thing
   * from the same place. */
  channel,
}: {
  companyName: string;
  channel: HelpChannel;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const pathname = usePathname();
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  /** The walkthrough on offer, decided when the panel opens — from the page
   * as it is then, so a tour whose steps are all hidden is not offered. */
  const [offer, setOffer] = useState<{ walkthrough: Walkthrough; again: boolean } | null>(null);
  const [touring, setTouring] = useState<Walkthrough | null>(null);

  /**
   * The page they were on WHEN THEY ASKED FOR HELP, frozen at open.
   *
   * Not `pathname` read at submit time. This component lives in the layout,
   * so it survives navigation and its state does too — a question typed on
   * a job page, abandoned, and picked up two screens later would otherwise
   * be mailed with the wrong page attached, which is worse than no page at
   * all because it looks like information. The typing deliberately DOES
   * survive; only the page attached to it is re-read.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);

  // A navigation closes it, the same call MobileNav makes: a panel left
  // hanging over the page you just asked for reads as the click not having
  // worked. It also means the browser's own Back button can never leave
  // this open describing a page you are no longer on.
  useEffect(() => {
    setIsOpen(false);
    setTouring(null);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  function open() {
    const walkthrough = walkthroughFor(pathname);
    const offered = walkthrough && shownSteps(walkthrough.steps, isAnchorShown).length > 0 ? walkthrough : null;
    setOffer(offered ? { walkthrough: offered, again: readFinished(browserStorage()).includes(offered.route) } : null);
    setOpenedOn(pathname);
    setError(null);
    setSentTo(null);
    setIsOpen(true);
    // Focus after paint, so the cursor is in the box the moment it appears.
    // Not any more: "Take the full tour" is the first thing on the panel on
    // every page, and a cursor already in the question box would be telling
    // them to type.
  }

  function takeFullTour() {
    setIsOpen(false);
    setTouring(null);
    startFullTour();
  }

  function startTour(walkthrough: Walkthrough) {
    setIsOpen(false);
    setTouring(walkthrough);
  }

  // "Walk me through this page" on an empty state (EmptyState.tsx) asks for
  // the same tour this panel offers. Read from the address bar at the moment
  // of the click, not from `pathname`, so the listener never needs rebinding.
  useEffect(() => {
    const onWalk = () => {
      const walkthrough = walkthroughFor(window.location.pathname);
      if (walkthrough) {
        setIsOpen(false);
        setTouring(walkthrough);
      }
    };
    window.addEventListener(WALKTHROUGH_EVENT, onWalk);
    return () => window.removeEventListener(WALKTHROUGH_EVENT, onWalk);
  }, []);

  // What the panel promises to include, and what `helpBody` actually
  // includes — kept next to each other on purpose. Nothing is sent that is
  // not on this list.
  const discloses = [
    "your name and email address, so we can reply",
    `your company (${companyName})`,
    openedOn ? `the page you were on (${openedOn})` : "the page you were on",
    "the job that page belongs to, if it is a job page",
  ];

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Ask us for help"
        // 44px on a phone (p-3 around a 20px icon), 36px from sm up where it
        // matches the bell beside it. Same call MobileNav made about its
        // hamburger: half a subcontractor's people are in the field, and the
        // control for "I am stuck" is a poor place to save eight pixels.
        className="flex items-center gap-1.5 rounded-md p-3 text-slate-400 hover:bg-slate-800 hover:text-slate-200 sm:p-2"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 7.75a2 2 0 1 1 2.9 1.79c-.55.3-.9.87-.9 1.5v.21"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="10" cy="14" r="0.85" fill="currentColor" />
        </svg>
        {/* The word matters on a control nobody has seen before: a lone "?"
            in a toolbar is read as a tooltip, not as a way to reach a
            person. Hidden below sm, where the icon plus its title is all
            there is room for beside the bell and the avatar. */}
        <span className="hidden text-sm sm:inline">Help</span>
      </button>

      {isOpen && (
        <>
          {/* Catches a click outside. Faint rather than a dimming scrim —
              this is a panel over a page you are still reading, not a modal
              that owns the screen. */}
          <button
            type="button"
            aria-label="Close help"
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/40"
          />
          <div
            role="dialog"
            aria-label="Help"
            className="fixed right-2 top-14 z-50 max-h-[calc(100dvh-4.5rem)] w-[min(26rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl sm:right-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">Help</h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="-mr-1 -mt-1 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label="Close"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="m5.5 5.5 9 9m0-9-9 9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="mb-4 border-b border-line-row pb-4">
              <h3 className="text-sm font-semibold text-ink">New to C Stream?</h3>
              <p className="mt-1 text-sm text-ink-body">
                A three-minute walk across the app, page by page, in the order you would use it.
                Nothing is clicked or changed for you.
              </p>
              <button
                type="button"
                onClick={takeFullTour}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-rail-hover sm:w-auto"
              >
                Take the full tour
              </button>
            </div>

            {offer && (
              <div className="mb-4 border-b border-line-row pb-4">
                <h3 className="text-sm font-semibold text-ink">Not sure how this page works?</h3>
                <p className="mt-1 text-sm text-ink-body">
                  We will point at each part of it and say what it does, one step at a time. Nothing
                  is clicked or changed for you.
                </p>
                <button
                  type="button"
                  onClick={() => startTour(offer.walkthrough)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 sm:w-auto"
                >
                  {offer.again ? "Walk me through this page again" : "Walk me through this page"}
                </button>
              </div>
            )}

            <h3 className="mb-1 text-sm font-semibold text-ink">Or ask a person</h3>

            {/* The expectation, stated before anything is typed and not
                after. Two people build this and one is not an engineer;
                "instant support" would be a lie and a support widget that
                implies it is worse than a quiet email address. */}
            <p className="mb-3 text-sm text-slate-400">
              A real person reads this — there are two of us. We answer within one business day,
              usually sooner. Nobody is watching a queue at 2 AM, so if it is stopping you filing
              something today, say so in the first line.
            </p>

            {sentTo ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-200">
                  Sent to <span className="font-mono text-xs">{sentTo}</span>. It is in{" "}
                  <Link href="/messages" className="text-blue-400 underline">
                    Messages
                  </Link>{" "}
                  with its delivery status, so you can check it left — you do not have to take our
                  word for it.
                </p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="self-start rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
                >
                  Close
                </button>
              </div>
            ) : channel.kind === "unavailable" ? (
              <p className="text-sm text-amber-200">{channel.reason}</p>
            ) : channel.kind === "mailto" ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-amber-200">{channel.reason}</p>
                <a
                  href={helpMailtoHref(
                    channel.to,
                    helpSubject({ companyName, pagePath: openedOn }),
                  )}
                  className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Open this in your email app
                </a>
                <p className="text-xs text-slate-500">
                  It opens a new message to{" "}
                  <span className="font-mono">{channel.to}</span> with the subject already naming
                  your company and this page. Nothing is filled in for you beyond that, and nothing
                  is sent until you send it. Paste these in if they help:
                </p>
                {/* Shown rather than prefilled into the URL. A mailto body
                    would put whatever they typed into a URL, which is the
                    one place this app will not put user content. */}
                <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">
                  {[`Company: ${companyName}`, `Page: ${openedOn ?? "not recorded"}`].join("\n")}
                </pre>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setError(null);
                  const formData = new FormData(event.currentTarget);
                  startTransition(async () => {
                    const result = await requestHelp(formData);
                    if (result.ok) {
                      // Cleared only on success. A failed send that also
                      // ate the question is the thing this feature exists
                      // to prevent.
                      setMessage("");
                      setSentTo(channel.to);
                    } else {
                      setError(result.error);
                    }
                  });
                }}
                className="flex flex-col gap-3"
              >
                {/* Frozen at open; see openedOn. Server-side it is treated
                    as untrusted regardless of what this sends. */}
                <input type="hidden" name="pagePath" value={openedOn ?? ""} />

                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  What do you need?
                  <textarea
                    ref={textarea}
                    name="message"
                    required
                    rows={5}
                    maxLength={MAX_HELP_MESSAGE_LENGTH}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Certified payroll is due Friday and week 3 shows no fringe — what do I file?"
                    className={inputClass}
                  />
                </label>

                <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                  <p className="text-xs font-medium text-slate-400">We will send with it:</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">
                    {discloses.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">
                    Nothing else. No screenshot, no record of what you clicked, and none of your
                    data beyond what you type above.
                  </p>
                </div>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <div className="flex gap-2">
                  {/* Disabled in flight. Two clicks would be two emails
                      about one question — there is no idempotency key on a
                      send, and the second copy is what makes us slower to
                      answer, not faster. */}
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {isPending ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setIsOpen(false)}
                    className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  It goes to <span className="font-mono">{channel.to}</span> as an email from your
                  own address, and lands in Messages with its delivery status, the same as anything
                  else this app sends.
                </p>
              </form>
            )}
          </div>
        </>
      )}

      {touring && (
        <WalkthroughTour
          walkthrough={touring}
          returnFocusTo={trigger}
          onClose={(finished) => {
            if (finished) markFinished(browserStorage(), touring.route);
            setTouring(null);
          }}
        />
      )}
    </>
  );
}
