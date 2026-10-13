"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { recordBidOutcome } from "@/lib/actions/bidOutcomes";
import { Spinner } from "@/components/Spinner";
import { localToday } from "@/components/localToday";
import { OUTCOME_REASONS, readOutcomeForm, type OutcomeErrors as Errors } from "@/components/ai-bid/outcome";

const FIELD =
  "w-full rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink focus:border-link focus:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:text-sm";

/**
 * Why a bid was won or lost — the one fact the recommendations learn from.
 *
 * Two mounts: open on the bid workspace's Decision tab, and collapsed behind
 * "Record why" on a won or lost row of /bids (list-page convention). Nothing
 * is sent anywhere; it writes one BidOutcome row through `recordBidOutcome`,
 * which answers with a sentence either way. No `router.refresh()`: the
 * action revalidates, and an action that revalidates re-renders the page by
 * itself (CLAUDE.md, #61) — and leaving `useRouter` out keeps this mountable
 * in /bids' static-render test, which has no app router.
 *
 * The decided-on date is filled from the reader's calendar AFTER mount
 * (`localToday` is client-only — see its header), so the server markup and
 * the first client render agree.
 */
export function BidOutcomeForm({
  bidInvitationId,
  defaultResult,
  collapsed = false,
}: {
  bidInvitationId: string;
  defaultResult?: "WON" | "LOST";
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [result, setResult] = useState<"WON" | "LOST" | null>(defaultResult ?? null);
  const [decidedOn, setDecidedOn] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) setDecidedOn((d) => d || localToday());
  }, [open]);

  if (saved) {
    return (
      <p role="status" className="text-sm text-ink-body">
        Recorded. The recommendations will use it from the next run.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-md border border-line-card px-3 text-sm font-medium text-ink-label hover:bg-rail-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        Record why
      </button>
    );
  }

  const id = (name: string) => `outcome-${bidInvitationId}-${name}`;

  function focusFirst(found: Errors) {
    const first = (["result", "reason", "winningPrice"] as const).find((k) => found[k]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  }

  return (
    <form
      ref={formRef}
      noValidate
      data-bid-outcome-form
      onSubmit={(event) => {
        event.preventDefault();
        const read = readOutcomeForm(new FormData(event.currentTarget));
        if (!read.ok) {
          setErrors(read.errors);
          focusFirst(read.errors);
          return;
        }
        setErrors({});
        startTransition(async () => {
          try {
            const res = await recordBidOutcome(read.input);
            if (!res.ok) return setErrors({ form: res.error });
            setSaved(true);
          } catch {
            setErrors({ form: "Couldn't save just now. Nothing was recorded — try again." });
          }
        });
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="bidInvitationId" value={bidInvitationId} />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-label">How did it go?</legend>
        <div
          className="inline-flex rounded-[10px] border border-line-card p-0.5"
          role="radiogroup"
          aria-invalid={errors.result ? true : undefined}
          aria-describedby={errors.result ? id("result-error") : undefined}
        >
          {(["WON", "LOST"] as const).map((value, i) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center rounded-lg px-5 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${
                result === value ? (value === "WON" ? "bg-tag-green text-tag-green-ink" : "bg-tag-rose text-tag-rose-ink") : "text-ink-body hover:bg-rail-hover"
              }`}
            >
              <input
                type="radio"
                name="result"
                value={value}
                checked={result === value}
                onChange={() => setResult(value)}
                className="sr-only"
                data-field={i === 0 ? "result" : undefined}
              />
              {value === "WON" ? "Won" : "Lost"}
            </label>
          ))}
        </div>
        {errors.result && (
          <p id={id("result-error")} className="mt-1 text-sm text-danger">
            {errors.result}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-ink-label" htmlFor={id("reason")}>
          Main reason
          <select
            id={id("reason")}
            name="reason"
            defaultValue=""
            data-field="reason"
            aria-invalid={errors.reason ? true : undefined}
            aria-describedby={errors.reason ? id("reason-error") : undefined}
            className={FIELD}
          >
            <option value="" disabled>
              Pick one…
            </option>
            {OUTCOME_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {errors.reason && (
            <span id={id("reason-error")} className="text-sm text-danger">
              {errors.reason}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink-label" htmlFor={id("decidedOn")}>
          Decided on
          <input
            id={id("decidedOn")}
            type="date"
            name="decidedOn"
            value={decidedOn}
            onChange={(e) => setDecidedOn(e.target.value)}
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink-label" htmlFor={id("winningPrice")}>
          <span>
            Winning price <span className="text-ink-muted">(if you know it)</span>
          </span>
          <input
            id={id("winningPrice")}
            name="winningPrice"
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 712,500…"
            data-field="winningPrice"
            aria-invalid={errors.winningPrice ? true : undefined}
            aria-describedby={errors.winningPrice ? id("price-error") : undefined}
            className={`${FIELD} tabular-nums`}
          />
          {errors.winningPrice && (
            <span id={id("price-error")} className="text-sm text-danger">
              {errors.winningPrice}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink-label" htmlFor={id("winnerName")}>
          <span>
            Who got it <span className="text-ink-muted">(optional)</span>
          </span>
          <input id={id("winnerName")} name="winnerName" autoComplete="off" className={FIELD} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink-label" htmlFor={id("note")}>
        <span>
          Note <span className="text-ink-muted">(optional)</span>
        </span>
        <textarea id={id("note")} name="note" rows={2} className={FIELD} />
      </label>

      <div aria-live="polite">
        {errors.form && (
          <p role="alert" className="rounded-md border border-line-card bg-tag-rose px-3 py-2 text-sm text-danger">
            {errors.form}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            "Record outcome"
          )}
        </button>
        {collapsed && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-body hover:bg-rail-hover"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
