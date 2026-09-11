"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * A row's action cluster, where arming a delete empties the row of
 * everything else.
 *
 * WHY THIS IS A COMPONENT AND NOT A CONVENTION
 *
 * The convention was tried and it failed twice in a week. Diego found an
 * armed "Confirm remove" sitting next to a live "Record a period" on
 * `ApprenticeshipRowActions` and fixed it with `{!confirming && …}` around
 * that one button. The very next branch added "Edit enrolment" into the
 * position the fix had just emptied, git merged the two with no conflict,
 * and typecheck, lint, test and build were green the whole way through.
 * Issue #152 then found the same shape on twenty more rows.
 *
 * The shape is always identical: an ordinary action emitted as a SIBLING of
 * the `confirming ? … : …` ternary rather than inside a guard. So this
 * component removes the sibling position altogether. Ordinary actions are
 * `children`; the delete is the `destructive` PROP; while armed, children
 * are not rendered at all. There is nowhere to put a new button that the
 * armed state does not cover — which is the only version of this fix that
 * survives the next merge.
 *
 * Two rules, both enforced here rather than remembered:
 *
 *  1. An armed destructive confirm hides EVERY ordinary action in its row,
 *     not just the one somebody remembered.
 *  2. The confirm button never takes the position the delete button just
 *     vacated. CANCEL INHERITS THE DELETE PIXEL — which control that is
 *     depends on how the cluster is laid out, and it is laid out two
 *     different ways:
 *
 *     At >=640px the cluster is a ROW, and which END is stable depends on
 *     its alignment, so `ConfirmDelete` takes a `pinned` prop: `"start"`
 *     (default) renders [Cancel][Confirm] for a left-aligned cluster,
 *     `"end"` renders [Confirm][Cancel] for a right-pinned one. "Cancel is
 *     always first" was that rule overfitted to one row.
 *
 *     Below 640px the field rows STACK (#89) and the cluster has no stable
 *     end at all — hiding the ordinary actions reflows the pair to the left
 *     edge, away from the delete's pixel entirely. So below `sm` the armed
 *     pair becomes a full-width COLUMN with Cancel on top, which puts Cancel
 *     on the vacated pixel whatever `pinned` says. Same rule, y axis. See
 *     `armedPairColumnStart` below for the measurements and the two fixes
 *     that were tried first.
 *
 * `components/rowActions.test.ts` renders this and clicks it, so an
 * inverted guard or a swapped pair goes red rather than green.
 */

type ArmState = {
  armed: boolean;
  arm: () => void;
  disarm: () => void;
};

const ArmContext = createContext<ArmState | null>(null);

export function RowActions({
  className,
  children,
  destructive,
  as: Tag = "div",
}: {
  className?: string;
  /** Every ordinary action in this row. Hidden entirely while a delete is
   *  armed — including the one that gets added here six months from now. */
  children?: ReactNode;
  /** The `<ConfirmDelete>` for this row, or nothing when the viewer may not
   *  delete. Rendered inside the provider, so it can arm and disarm. */
  destructive?: ReactNode;
  /** `span` for rows whose action cluster sits inline in a paragraph. */
  as?: "div" | "span";
}) {
  const [armed, setArmed] = useState(false);

  return (
    <ArmContext.Provider
      value={{ armed, arm: () => setArmed(true), disarm: () => setArmed(false) }}
    >
      <Tag className={className}>
        {armed ? null : children}
        {destructive}
      </Tag>
    </ArmContext.Provider>
  );
}

const defaultDeleteClass =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const defaultCancelClass =
  "rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-50";
const defaultConfirmClass =
  "rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-tag-rose disabled:opacity-50";

/**
 * THE PHONE HALF OF RULE 2 (issue #184). `pinned` is the desktop half.
 *
 * `pinned` decides which END of a horizontal cluster Cancel takes. That works
 * as long as there IS a horizontal cluster with two ends. #89 made the field
 * rows `flex flex-col … sm:flex-row`, so below 640px the cluster is a
 * full-width left-aligned strip — and because RowActions removes the ordinary
 * actions while armed, the pair reflows to the strip's LEFT edge while the
 * Delete it replaced sat to the RIGHT of an "Edit" that is now gone. Nothing
 * can inherit the delete's pixel because nothing is AT the delete's pixel any
 * more. Measured at 375px on main: 86% overlap with `end`, 75% with the
 * default. Both are "the confirm is under your finger".
 *
 * Two fixes were measured before this one and both failed, which is why this
 * looks more elaborate than the problem sounds:
 *
 *  - RESERVE the hidden actions' width (`invisible`), so the cluster does not
 *    reflow. It does not fail, it INVERTS: restoring the delete's slot makes
 *    that slot the LAST control at 1100px and the FIRST at 375px, so Cancel
 *    would have to render last and first at once. One prop, two contradictory
 *    correct answers — and with the values shipped today it takes the phone
 *    from 86% to 100%, a perfect hit on the vacated pixel.
 *  - RIGHT-ALIGN the stacked cluster (`justify-end sm:justify-normal`). This
 *    one works — 0% on five of the six — but it pays for the two seconds a
 *    delete is armed by permanently re-laying-out the unarmed row: every
 *    phone row's Edit/Remove jump ~153px to the right edge, all the time. It
 *    also leaves RfiRow at 20%, worse than the 0% that row has today.
 *
 * So: below `sm`, the armed pair becomes its own FULL-WIDTH COLUMN with
 * CANCEL ON TOP. Cancel lands in the y-band the delete vacated and spans the
 * whole strip, so it covers 100% of the vacated box on every row measured;
 * the confirm sits a whole button-height (12px of clear air) below it. The
 * column direction is what puts Cancel on top for each `pinned` order —
 * `flex-col` for the [Cancel][Confirm] DOM order, `flex-col-reverse` for
 * [Confirm][Cancel] — which is the same "Cancel inherits the delete pixel"
 * rule expressed on the y axis instead of the x axis.
 *
 * `contents` at >=640px is what keeps the desktop honest: the wrapper stops
 * existing as a box, the two buttons are flex items of the caller's cluster
 * exactly as they were, and the 1100px rects are byte-identical to main's.
 * Only `max-sm:` (a below-640px media query, emitted after the plain
 * utilities so it wins there) turns it into a box at all.
 *
 * WHAT IT COSTS, because it is not free: the armed row grows 56px at <=639px
 * and pushes everything below it down, and the two buttons go full width
 * while armed. Nothing changes in the unarmed state at any width.
 */
const armedPairColumnStart =
  "contents max-sm:flex max-sm:w-full max-sm:flex-col max-sm:items-stretch max-sm:gap-3";
const armedPairColumnEnd =
  "contents max-sm:flex max-sm:w-full max-sm:flex-col-reverse max-sm:items-stretch max-sm:gap-3";

/**
 * The two-step delete itself. Goes in `<RowActions destructive={…}>` and
 * nowhere else — outside that slot it throws, because a delete that cannot
 * empty its row is the bug this file exists to stop.
 *
 * Takes either an `onConfirm` callback (client rows that own a transition)
 * or a bound server `action` (server-rendered lists). Never both.
 *
 * The class-name props exist so a migration keeps each row looking exactly
 * as it did — this app's rows legitimately differ between text-xs pills and
 * text-sm buttons and bare text links.
 */
export function ConfirmDelete({
  label = "Delete",
  confirmLabel = "Confirm delete",
  cancelLabel = "Cancel",
  prompt,
  pendingLabel,
  hint,
  pending = false,
  disabled = false,
  pinned = "start",
  onConfirm,
  action,
  armedClassName,
  deleteClassName = defaultDeleteClass,
  cancelClassName = defaultCancelClass,
  confirmClassName = defaultConfirmClass,
}: {
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Asks the question, ahead of the buttons — "Delete Acme Drywall?".
   *  Text only: it must never be something the hurried second click can hit. */
  prompt?: ReactNode;
  /** Shown on the confirm button while `pending`. Defaults to `confirmLabel`. */
  pendingLabel?: string;
  /** One line saying what is about to go, when the row's own text doesn't. */
  hint?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  /** Which end of the cluster keeps its position when the row empties.
   *
   *  `"start"` (default) — a LEFT-ALIGNED cluster. The first slot is the
   *  stable one, so Cancel renders first: [Cancel][Confirm].
   *
   *  `"end"` — a RIGHT-PINNED cluster (`shrink-0` inside a `justify-between`
   *  parent, or anything else that hangs the group off the right edge). The
   *  LAST control is the one that keeps its position, so Cancel renders
   *  last: [Confirm][Cancel].
   *
   *  Measured in real Chromium at 1100px, not reasoned about (Diego, #176).
   *  Right-pinned with [Cancel][Confirm], the confirm covered 60.7px of the
   *  vacated Delete box — 100% of it. The same cluster with [Confirm][Cancel]
   *  overlapped by 0px. A DOM-only test environment does no layout, so this
   *  is not something `rowActions.test.ts` can see; what it CAN see, and does
   *  assert, is the rendered order of the two buttons for each value.
   *
   *  THIS PROP IS ABOUT THE DESKTOP ONLY, and that is now true by
   *  construction rather than by apology. #89 made five of these rows stack
   *  below 640px, and a stacked cluster has no "end" for Cancel to inherit:
   *  the ordinary actions are hidden, the armed pair reflows to the left
   *  edge, and NOTHING is at the delete's pixel any more (EquipmentRow at
   *  375px measured 75% confirm overlap one way and 86% the other — both are
   *  "under your finger"). #184 fixed that below `sm` with the armed column
   *  described on `armedPairColumnStart` above, which puts Cancel on top for
   *  EITHER value of this prop. So pick the value that is right at 1100px and
   *  the phone is right whatever you pick.
   *
   *  Re-measured in real Chromium at 1100/639/375 with the armed column in
   *  place. `end` on every right-pinned cluster: 0% overlap at all three, and
   *  Cancel covering 100% of the vacated box below 640. The three rows that
   *  used to sit in PINNED_EXCEPTIONS because no value worked at both widths
   *  — SafetyIncidentRow, ToolboxTalkRow, RuleSetRow — are `end` now and
   *  measure 100% -> 0% at 1100px. That map is empty; its rule-2 block in
   *  `rowActionsCensus.test.ts` carries the full table.
   *
   *  One residue the column cannot reach: at 1100px the confirm clears the
   *  vacated box only when Cancel plus the gap (82px) is at least as wide as
   *  the delete button, so RfiRow's 103px "Delete draft" leaves 20%. Keep
   *  delete labels short. */
  pinned?: "start" | "end";
  onConfirm?: () => void;
  /** An already-bound server action, for lists a server component renders. */
  action?: () => Promise<void> | void;
  /** Wraps the armed BUTTONS in their own element with these classes, for
   *  rows whose cluster is a column — without it the confirm pair stacks.
   *  `hint` deliberately stays outside it, i.e. under them.
   *
   *  This is the CALLER's wrapper and sits outside the armed column, which
   *  the component always adds; below `sm` the column wins either way. */
  armedClassName?: string;
  deleteClassName?: string;
  cancelClassName?: string;
  confirmClassName?: string;
}) {
  const arm = useContext(ArmContext);
  /* Fires once per arming whatever the caller does about `pending`. No
     delete action in this app is idempotent, and #19 records what a second
     click costs when a page looks like it did nothing.

     Deliberately once per ARMING, not once per attempt: if the delete
     fails, the row stays armed with its error shown and the confirm greyed
     out, and retrying means Cancel then Delete again. Re-arming a
     destructive action after it has failed is the behaviour worth having,
     and it is the only version of this that a test can hold still. */
  const [fired, setFired] = useState(false);

  if (!arm) {
    throw new Error(
      "<ConfirmDelete> must be the `destructive` prop of a <RowActions>. Outside it, it cannot hide the row's other actions, which is the whole point of it.",
    );
  }

  if (!arm.armed) {
    return (
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setFired(false);
          arm.arm();
        }}
        className={deleteClassName}
      >
        {label}
      </button>
    );
  }

  /* CANCEL INHERITS THE DELETE PIXEL. The row is now empty of everything
     else, so whatever the cursor is sitting over must not be the one that
     destroys the record — but WHICH control ends up under the cursor is
     decided by the cluster's alignment, not by this file. Left-aligned, the
     first slot is the stable one; right-pinned, the last one is. `pinned`
     says which, and everything below is that one decision. */
  const cancelButton = (
    <button
      type="button"
      disabled={pending}
      onClick={arm.disarm}
      className={cancelClassName}
    >
      {cancelLabel}
    </button>
  );

  const confirmButton = action ? (
    <form action={action}>
      <SubmitButton type="submit" className={confirmClassName}>
        {confirmLabel}
      </SubmitButton>
    </form>
  ) : (
    <button
      type="button"
      disabled={pending || fired}
      onClick={() => {
        setFired(true);
        onConfirm?.();
      }}
      className={confirmClassName}
    >
      {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
    </button>
  );

  const controls = (
    <>
      {prompt && <span className="text-xs text-ink-body">{prompt}</span>}
      <span className={pinned === "end" ? armedPairColumnEnd : armedPairColumnStart}>
        {pinned === "end" ? (
          <>
            {confirmButton}
            {cancelButton}
          </>
        ) : (
          <>
            {cancelButton}
            {confirmButton}
          </>
        )}
      </span>
    </>
  );

  /* The hint stays OUTSIDE the wrapper: rows that pass `armedClassName` do
     it because their cluster is a column, and in those the explanation
     belongs under the buttons rather than beside them. */
  return (
    <>
      {armedClassName ? <span className={armedClassName}>{controls}</span> : controls}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </>
  );
}
