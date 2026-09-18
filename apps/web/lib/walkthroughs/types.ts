/**
 * The shape of a "Walk me through this page" tour.
 *
 * A walkthrough is an ordered list of steps. Each step points at one real
 * element on the page — the element carries a `data-tour` attribute whose
 * value is the step's `anchor` — and says in one to three short sentences
 * what that thing is and what to do with it.
 *
 * Written for someone who has never seen the app: plain words, no jargon,
 * and never a description of a control that is not on the page.
 * `walkthroughCensus.test.ts` holds every anchor to a literal attribute in
 * the files that route renders, so a step cannot point at nothing.
 *
 * A step whose anchor is not on screen when the tour reaches it — hidden by
 * the viewer's role, replaced by an empty state, inside a section that is
 * still closed — is skipped, never shown pointing at nothing. So a page can
 * carry steps for BOTH its empty state and its full state; only the ones
 * the person can actually see are shown.
 */

export type WalkthroughStep = {
  /** The value of the `data-tour` attribute this step highlights. Unique
   * within its walkthrough. Lowercase words joined by hyphens. */
  anchor: string;
  /** A few words. Shown as the popover's heading. */
  title: string;
  /** One to three short sentences: what it is, then what to do. */
  body: string;
};

export type Walkthrough = {
  /** The app route this walkthrough belongs to, written the way the
   * `app/` folder writes it — `/schedule`, `/jobs/[id]`. */
  route: string;
  /** What the page is, in two or three words — "Your jobs", "The schedule".
   * Shown above each step so the person knows which tour they are in. */
  title: string;
  steps: WalkthroughStep[];
};
