import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { AskItButton, OpenFormButton, WalkthroughButton } from "@/components/EmptyStateButtons";
import { primaryActionClass, secondaryActionClass } from "@/components/emptyStateStyles";

/**
 * What a page shows before it has anything in it.
 *
 * A brand-new company sees every page empty, so for its first ten minutes
 * the empty state IS the product. Cyrus walked the app as a new account and
 * called pages like Contacts and Messages "super blank": one grey sentence
 * under a heading, with no picture of what the page becomes and no way to
 * get there from where you are standing. This is the one shape every nav
 * page uses instead — `emptyStateCensus.test.ts` holds them to it — so the
 * next page does not get a sixteenth hand-rolled version.
 *
 * Top to bottom:
 *   1. what the page is for, in the words of someone who runs jobs;
 *   2. up to three things to do about it — the page's own add button first;
 *   3. where records come from, for a page that fills itself from elsewhere;
 *   4. an EXAMPLE of the page in use.
 *
 * THE EXAMPLE IS NEVER DATA. Static markup written in the page file, never
 * read from or written to the database, and built so it cannot be mistaken
 * for a record: a visible "Example" label, a dashed outline, muted ink,
 * `inert` (no focus, no clicks, no find-in-page links to follow) and
 * `aria-hidden` rows under a caption a screen reader does hear. Names in it
 * are obviously illustrative. A contractor who sees "Maple St. kitchen" on
 * his Contacts page and thinks we invented a client for him is the one
 * failure this must not have.
 *
 * `data-tour` and any other attributes are passed straight to the root, so a
 * page keeps writing its walkthrough anchor as a literal attribute on
 * `<EmptyState …>` in the page file, which is what `walkthroughCensus.test.ts`
 * reads. (No example of one here: that census greps comments too.)
 */

export type EmptyStateAction =
  /** A plain link to another page. */
  | { label: string; href: string }
  /** Presses the page's own add button, found by its `data-tour` anchor. */
  | { label: string; opens: string };

export type EmptyStateExampleRow = {
  /** The line's name, e.g. a client or a job. */
  title: string;
  /** One line under it. */
  detail?: string;
  /** Right-hand figure: a date, an amount, a count. */
  meta?: string;
  /** A small chip beside the title, like the real rows carry. */
  tag?: string;
};

export type EmptyStateProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** Short and true: "No contacts yet". */
  title: string;
  /** What the page is for, in one or two sentences. */
  purpose: ReactNode;
  /** In order; the first is drawn as the primary. At most three. */
  actions?: EmptyStateAction[];
  /** A sentence the assistant could act on, e.g. "Add Jane Smith, homeowner,
   * 555-0100". Adds "Ask C Stream to do it", which types it into the Ask
   * box for the person to read and send — never sends it. */
  ask?: string;
  /** Adds "Walk me through this page" when the page has a walkthrough. */
  walkthrough?: boolean;
  /** Where records on this page come from, when it is not only "add one". */
  sources?: ReactNode;
  /** A muted preview of the page in use. Static; see the header. */
  example?: {
    rows: EmptyStateExampleRow[];
    /** Overrides the default caption. */
    caption?: string;
  };
  /** Anything page-specific that belongs inside the box, under the actions. */
  children?: ReactNode;
};

export const MAX_EMPTY_STATE_ACTIONS = 3;

export function EmptyState({
  title,
  purpose,
  actions = [],
  ask,
  walkthrough = true,
  sources,
  example,
  children,
  className,
  ...rest
}: EmptyStateProps) {
  if (actions.length > MAX_EMPTY_STATE_ACTIONS) {
    // A bug in the calling page, caught in development; four equal buttons
    // is a menu, not a next step.
    throw new Error(`EmptyState "${title}": at most ${MAX_EMPTY_STATE_ACTIONS} actions, got ${actions.length}`);
  }

  return (
    <section
      {...rest}
      data-empty-state=""
      className={`rounded-lg border border-line-card bg-surface p-5 sm:p-6 ${className ?? ""}`}
    >
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-1 max-w-2xl text-sm text-ink-body">{purpose}</div>

      {(actions.length > 0 || ask || walkthrough) && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actions.map((action, i) =>
            "href" in action ? (
              <Link
                key={action.label}
                href={action.href}
                className={i === 0 ? primaryActionClass : secondaryActionClass}
              >
                {action.label}
              </Link>
            ) : (
              <OpenFormButton key={action.label} target={action.opens} label={action.label} primary={i === 0} />
            ),
          )}
          {ask && <AskItButton example={ask} />}
          {walkthrough && <WalkthroughButton />}
        </div>
      )}

      {ask && (
        <p className="mt-2 text-xs text-ink-body">
          For example, tell the assistant{" "}
          <span className="text-ink-label">&ldquo;{ask}&rdquo;</span>. It shows you what it will
          add before anything is saved.
        </p>
      )}

      {children && <div className="mt-4 text-sm text-ink-body">{children}</div>}

      {sources && (
        <div className="mt-4 rounded-md border border-line-row bg-canvas p-3 text-sm text-ink-body">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-label">
            Where these come from
          </p>
          {sources}
        </div>
      )}

      {example && example.rows.length > 0 && (
        <figure className="mt-5" data-empty-example="">
          <figcaption className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-body">
            <span className="rounded border border-line-card px-1.5 py-0.5 font-semibold uppercase tracking-wide text-ink-label">
              Example
            </span>
            <span>{example.caption ?? "What this page looks like once it is in use. Not your data — nothing here is saved."}</span>
          </figcaption>
          <ul
            aria-hidden="true"
            // `inert` keeps the preview out of the tab order and unclickable.
            inert
            className="select-none divide-y divide-line-row rounded-lg border border-dashed border-line-card opacity-60"
          >
            {example.rows.map((row) => (
              <li key={row.title} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink-label">
                    <span className="break-words">{row.title}</span>
                    {row.tag && (
                      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-ink-body">{row.tag}</span>
                    )}
                  </p>
                  {row.detail && <p className="mt-0.5 break-words text-xs text-ink-body">{row.detail}</p>}
                </div>
                {row.meta && <p className="shrink-0 text-right text-xs text-ink-body">{row.meta}</p>}
              </li>
            ))}
          </ul>
        </figure>
      )}
    </section>
  );
}
