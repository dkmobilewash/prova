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
 *     vacated. Cancel is rendered first, so a hurried second click on the
 *     same pixel costs a click rather than the record.
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
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50";
const defaultCancelClass =
  "rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50";
const defaultConfirmClass =
  "rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50";

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
  onConfirm?: () => void;
  /** An already-bound server action, for lists a server component renders. */
  action?: () => Promise<void> | void;
  /** Wraps the armed BUTTONS in their own element with these classes, for
   *  rows whose cluster is a column — without it the confirm pair stacks.
   *  `hint` deliberately stays outside it, i.e. under them. */
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

  /* Cancel FIRST. The delete button was the last control in the row and the
     row is now empty of everything else, so whatever the cursor is sitting
     over must not be the one that destroys the record. */
  const controls = (
    <>
      {prompt && <span className="text-xs text-slate-400">{prompt}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={arm.disarm}
        className={cancelClassName}
      >
        {cancelLabel}
      </button>
      {action ? (
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
      )}
    </>
  );

  /* The hint stays OUTSIDE the wrapper: rows that pass `armedClassName` do
     it because their cluster is a column, and in those the explanation
     belongs under the buttons rather than beside them. */
  return (
    <>
      {armedClassName ? <span className={armedClassName}>{controls}</span> : controls}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </>
  );
}
