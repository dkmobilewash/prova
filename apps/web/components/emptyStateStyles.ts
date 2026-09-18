/**
 * The two button looks an empty state uses, shared by the server component
 * (`EmptyState.tsx`, for links) and the client buttons
 * (`EmptyStateButtons.tsx`). A plain module rather than an export of either:
 * a string exported from a "use client" file reaches a server component as a
 * client-reference proxy, not as the string (the Hint.tsx scar in CLAUDE.md).
 *
 * Full width on a phone so three actions stack into three thumb-sized rows
 * instead of wrapping into a ragged line; natural width from `sm` up. The
 * brand fill always carries the dark label — never white on the yellow.
 */
export const primaryActionClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 sm:w-auto";

export const secondaryActionClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover hover:text-ink sm:w-auto";

/** The quietest of the three: "Walk me through this page" is help, not a
 * next step, so it reads as a link beside the buttons rather than a fourth
 * button competing with them. Still 44px tall for a thumb. */
export const tertiaryActionClass =
  "inline-flex min-h-11 items-center justify-center px-2 text-sm font-medium text-link hover:text-link-hover hover:underline";
