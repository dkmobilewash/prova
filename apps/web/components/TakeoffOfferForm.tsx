"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";
import { requestDrawingSetRead } from "@/lib/actions/takeoffOffer";
import { OFFER_TRADES, confirmation, type OfferRequest } from "@/lib/takeoff-offer";

/**
 * The free drawing-set read's intake form, on the public `/wall-takeoff`
 * page. Three required fields and four optional ones, and the whole of it is
 * a stranger's first interaction with us.
 *
 * ── WHY `onSubmit` AND NOT THE `action` PROP ──
 *
 * React 19's `<form action={fn}>` calls `requestFormReset` UNCONDITIONALLY
 * before the action runs, so a returned refusal arrives over emptied fields —
 * `components/formActionCensus.test.ts` fails the build on it and its header
 * explains the mechanism. That is bad anywhere; here it is the end of the
 * conversation. A contractor who typed seven fields on a phone, got "that
 * email address does not look right", and found the form blank does not type
 * them again. So: `onSubmit`, `preventDefault`, `new FormData(currentTarget)`,
 * and NOTHING is cleared on failure — the error renders over what they typed.
 * `components/LogTimeEntryForm.tsx` is this repo's reference for the shape.
 *
 * `useFormStatus` reports nothing for a form submitted this way (it reads the
 * `action`-prop transition), so the pending state is this component's own
 * `useTransition`, and the submit button is disabled for all of it. CLAUDE.md:
 * a page that fails after a commit invites a second click, and #19 disabled 57
 * create buttons for that reason. This one matters more than most, because
 * `requestDrawingSetRead` writes a sales lead and a double submit is somebody
 * getting rung twice.
 *
 * ── THE ADDRESS ON SCREEN IS THE MECHANISM; THE EMAIL IS A CONVENIENCE ──
 *
 * On success this replaces itself with the confirmation AND the address to
 * send the set to, as a live `mailto:`. The email we send is the convenience
 * copy: a contractor must never need it to know what to do next, because a
 * first mail from an unknown sender is the single most filterable thing in
 * this flow (`packages/integrations/src/email.ts`'s header records why).
 *
 * ── NO PROMISE STRING IS WRITTEN HERE ──
 *
 * Every word of the offer comes from `lib/takeoff-offer.ts` —
 * `takeoff-offer.test.ts` walks every source file in this app and fails on a
 * hand-written second copy of any of them. The trade list and the
 * confirmation text are read from the module for the same reason.
 */

/** Read off the submitted FormData rather than the live DOM, so the
 *  confirmation greets the name that was FILED — never something they started
 *  typing while the action was in flight. */
function requestFrom(formData: FormData): OfferRequest {
  const field = (name: keyof OfferRequest) => String(formData.get(name) ?? "");
  return {
    companyName: field("companyName"),
    contactName: field("contactName"),
    email: field("email"),
    phone: field("phone"),
    trade: field("trade"),
    projectName: field("projectName"),
    gcName: field("gcName"),
  };
}

/**
 * What the confirmation renders from. `alreadyHadIt` USED TO BE HERE AND ITS
 * REMOVAL IS THE FIX, not a tidy-up: this component rendered a distinct
 * paragraph when the action said the address was already on file, which made
 * the public endpoint an email-enumeration oracle — POST an address, read the
 * page, learn whether that contractor is a lead of ours. `requestDrawingSetRead`
 * no longer returns the flag at all (see `DrawingSetReadResult`), so there is
 * nothing here to render and no shape of this form that can leak it again.
 *
 * Nothing is lost by the person who filled this in. Their next step is the
 * same sentence either way — send the set to this address — and a repeat
 * submit is no longer discarded: the action writes what they typed onto the
 * lead it already has.
 */
type Accepted = { request: OfferRequest; sendTo: string };

const labelClass = "flex flex-col gap-1.5 text-sm font-semibold text-ink-label";
const fieldClass =
  "min-h-[48px] w-full rounded-md border border-line-card bg-canvas px-3 text-base text-ink " +
  "placeholder:text-ink-muted focus:border-link focus:outline-none";
const optionalClass = "font-normal text-ink-muted";

export function TakeoffOfferForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Accepted | null>(null);

  if (accepted) {
    const { heading, body } = confirmation(accepted.request, accepted.sendTo);
    return (
      <div className="rounded-lg border border-line-card bg-surface p-5">
        <h3 className="text-xl font-semibold text-ink">{heading}</h3>
        <p className="mt-3 text-base leading-relaxed text-ink-body">{body}</p>
        <div className="mt-5 rounded-md border border-line-card bg-canvas p-4">
          <p className="text-sm font-semibold text-ink-label">Send the set to</p>
          <a
            href={`mailto:${accepted.sendTo}`}
            // 44px even though it is a link rather than a button: on this
            // page it IS the action, and it is tapped with a thumb.
            className="mt-1 inline-flex min-h-[44px] items-center break-all text-lg font-semibold text-link hover:text-link-hover"
          >
            {accepted.sendTo}
          </a>
          <p className="mt-2 text-sm leading-relaxed text-ink-body">
            That address is here so you do not have to wait for our email to get started. Attach the
            PDF and send it whenever suits.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        // The reset React would do for us is the whole bug — see the header.
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const request = requestFrom(formData);
        setError(null);
        startTransition(async () => {
          try {
            const result = await requestDrawingSetRead(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setAccepted({ request, sendTo: result.value.sendTo });
          } catch {
            // A thrown message is redacted in production, so there is nothing
            // worth showing from it. Name the fallback they can act on.
            setError("Something went wrong sending that. Try again in a moment.");
          }
        });
      }}
      className="flex flex-col gap-4 rounded-lg border border-line-card bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:gap-4">
        <label className={labelClass} htmlFor="takeoff-company">
          <span>Company name</span>
          <input
            id="takeoff-company"
            name="companyName"
            type="text"
            required
            autoComplete="organization"
            className={fieldClass}
          />
        </label>
        <label className={labelClass} htmlFor="takeoff-contact">
          <span>Your name</span>
          <input
            id="takeoff-contact"
            name="contactName"
            type="text"
            required
            autoComplete="name"
            className={fieldClass}
          />
        </label>
        <label className={labelClass} htmlFor="takeoff-email">
          <span>Email</span>
          <input
            id="takeoff-email"
            name="email"
            type="email"
            inputMode="email"
            required
            autoComplete="email"
            className={fieldClass}
          />
        </label>
        <label className={labelClass} htmlFor="takeoff-phone">
          <span>
            Phone <span className={optionalClass}>(optional)</span>
          </span>
          <input
            id="takeoff-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className={fieldClass}
          />
        </label>
        <label className={labelClass} htmlFor="takeoff-trade">
          <span>
            Your trade <span className={optionalClass}>(optional)</span>
          </span>
          {/* A picker rather than a text box, and the list is the module's —
              a seventh trade added there appears here with no edit. */}
          <select id="takeoff-trade" name="trade" defaultValue="" className={fieldClass}>
            <option value="">Choose one</option>
            {OFFER_TRADES.map((trade) => (
              <option key={trade.value} value={trade.value}>
                {trade.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass} htmlFor="takeoff-project">
          <span>
            Project name <span className={optionalClass}>(optional)</span>
          </span>
          <input id="takeoff-project" name="projectName" type="text" className={fieldClass} />
        </label>
        <label className={`${labelClass} sm:col-span-2`} htmlFor="takeoff-gc">
          <span>
            General contractor <span className={optionalClass}>(optional)</span>
          </span>
          <input id="takeoff-gc" name="gcName" type="text" className={fieldClass} />
        </label>
      </div>

      {error && (
        // Over the fields they typed, with nothing cleared.
        <p role="alert" className="text-base leading-relaxed text-tag-rose-ink">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="min-h-[56px] w-full rounded-md bg-brand px-6 text-base font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Sending&hellip;
          </span>
        ) : (
          "Send me the free read"
        )}
      </button>
      <p className="text-sm leading-relaxed text-ink-muted">
        No account, no card, and we do not pass your details to anyone.
      </p>
    </form>
  );
}
