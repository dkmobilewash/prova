"use client";

import { useState, useTransition } from "react";
import { updateCompanyProfile } from "@/lib/actions";
import type { CompanyProfile, CompanyProfileGap } from "@/lib/company-profile";

/**
 * The company's own record, on /settings.
 *
 * This is the form that did not exist. `Company.name` was written once, at
 * sign-up, as `${your name}'s Company` — and that string prints as the
 * contractor on the WH-347 certified payroll form, as the employer on a
 * union trust-fund remittance report, in the sidebar, and above the
 * signature block a GC signs. The remittance sheet even printed "Not
 * recorded on the company record. Settings → Company." in red, pointing at
 * a section that was not there.
 *
 * TWO THINGS IT DOES BEYOND HOLDING INPUTS, both because of what reads this
 * record:
 *
 * 1. An empty field says WHAT IS MISSING, not nothing. Every input carries
 *    "Not recorded" as its placeholder, and the fields a document prints a
 *    hole for carry the document's own sentence underneath. A form of blank
 *    boxes reads as "nothing to do here", which is exactly how the EIN
 *    stayed unrecorded while a remittance sheet refused to print.
 * 2. The refusal comes back as data and is RENDERED. Production redacts a
 *    thrown Server Action message to a digest, so `updateCompanyProfile`
 *    returns `{ ok: false, error }` and this component shows `error` —
 *    which is the only version of a validation message a real user ever
 *    sees.
 *
 * No draft persistence (`useFormDraft`), unlike the field-vertical forms.
 * This form's defaults ARE the saved record and it is never collapsed, so a
 * restored draft would silently re-present values the record no longer has
 * to someone who came to read it rather than to edit it.
 */

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-ink-body";

/** The sentence a document prints when this field is blank, shown under the
 * input that fixes it. */
function GapNote({ gaps, field }: { gaps: CompanyProfileGap[]; field: CompanyProfileGap["field"] }) {
  const gap = gaps.find((g) => g.field === field);
  if (!gap) return null;
  return <span className="max-w-prose text-[11px] font-normal text-amber-300">{gap.consequence}</span>;
}

export function CompanyProfileForm({
  company,
  gaps,
}: {
  company: CompanyProfile;
  gaps: CompanyProfileGap[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCompanyProfile(formData);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4 rounded-lg border border-line-card bg-surface p-4">
      {gaps.length > 0 && (
        <div className="rounded-md border border-amber-900 bg-amber-950/40 p-3">
          <p className="text-xs font-semibold text-amber-300">
            {gaps.length === 1
              ? "One thing on this record is printed on a document somebody else reads:"
              : `${gaps.length} things on this record are printed on documents somebody else reads:`}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-amber-200/90">
            {gaps.map((gap) => (
              <li key={gap.field}>
                <span className="font-medium">{gap.label}</span> — {gap.consequence}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className={labelClass}>
        Legal company name
        <span className="font-normal text-ink-muted">
          As it appears on your contracts. Prints as the contractor on the WH-347 and above the
          signature block a GC signs.
        </span>
        <input
          name="name"
          required
          defaultValue={company.name}
          placeholder="Not recorded"
          className={`w-full max-w-md ${inputClass}`}
        />
        <GapNote gaps={gaps} field="name" />
      </label>

      <label className={labelClass}>
        DBA name
        <span className="font-normal text-ink-muted">
          Optional. When set, THIS is what the WH-347 prints as the contractor name instead of the
          legal name above.
        </span>
        <input
          name="dbaName"
          defaultValue={company.dbaName ?? ""}
          placeholder="Not recorded"
          className={`w-full max-w-md ${inputClass}`}
        />
      </label>

      <label className={labelClass}>
        EIN
        <span className="font-normal text-ink-muted">
          Nine digits. Type it either way — 12-3456789 or 123456789 — and it is stored hyphenated,
          so every print of it matches.
        </span>
        <input
          name="ein"
          defaultValue={company.ein ?? ""}
          placeholder="Not recorded"
          className={`w-40 ${inputClass}`}
        />
        <GapNote gaps={gaps} field="ein" />
      </label>

      <fieldset className="flex flex-col gap-3 border-t border-line-card pt-4">
        <legend className="text-xs font-semibold text-ink-label">HQ address</legend>
        <p className="text-[11px] text-ink-muted">
          Street, city, state and ZIP are needed together — a partial address counts as none on both
          documents. Suite/unit is genuinely optional.
        </p>
        <GapNote gaps={gaps} field="address" />
        <label className={labelClass}>
          Street
          <input
            name="hqAddressLine1"
            defaultValue={company.hqAddressLine1 ?? ""}
            placeholder="Not recorded"
            className={`w-full max-w-md ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Suite / unit
          <input
            name="hqAddressLine2"
            defaultValue={company.hqAddressLine2 ?? ""}
            placeholder="Not recorded — optional"
            className={`w-full max-w-md ${inputClass}`}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className={labelClass}>
            City
            <input
              name="hqCity"
              defaultValue={company.hqCity ?? ""}
              placeholder="Not recorded"
              className={`w-48 ${inputClass}`}
            />
          </label>
          <label className={labelClass}>
            State
            <input
              name="hqState"
              maxLength={2}
              defaultValue={company.hqState ?? ""}
              placeholder="CO"
              className={`w-20 ${inputClass}`}
            />
          </label>
          <label className={labelClass}>
            ZIP
            <input
              name="hqZip"
              defaultValue={company.hqZip ?? ""}
              placeholder="Not recorded"
              className={`w-28 ${inputClass}`}
            />
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3 border-t border-line-card pt-4">
        <label className={labelClass}>
          Phone
          <input
            name="phone"
            defaultValue={company.phone ?? ""}
            placeholder="Not recorded"
            className={`w-48 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Website
          <input
            name="website"
            defaultValue={company.website ?? ""}
            placeholder="Not recorded"
            className={`w-64 ${inputClass}`}
          />
        </label>
      </div>
      <p className="text-[11px] text-ink-muted">
        Phone and website are on the record for your own reference — no document prints them today.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save company record"}
        </button>
        {/* The refusal, rendered. A thrown message would reach a real user
            as an opaque digest — see lib/actions/shared.ts. */}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {saved && !error && <p className="text-sm text-green-400">Saved.</p>}
      </div>
    </form>
  );
}
