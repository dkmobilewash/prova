"use client";

import { useState, useTransition } from "react";
import { updateCompanyProfile } from "@/lib/actions";

/**
 * The company's own identity — the one record in this app that had a row
 * from day one and no way to edit it.
 *
 * `Company.name` is generated at first sign-in as `"${your name}'s
 * Company"` (lib/auth.ts) and, before this, `prisma.company.update`
 * appeared nowhere in apps/web. So a real subcontractor was permanently
 * "Dave's Company" — in the rail, in the client portal, and inside the
 * snapshot written onto an e-signed subcontract. `dbaName`, `ein`, the HQ
 * address, `phone` and `website` were in the schema with nothing that
 * could ever write them.
 *
 * There is only an EDIT form here, and no create: the row is made by
 * sign-in and cannot not exist. So the "one shared *Fields component"
 * convention has one caller rather than two — the fields are still factored
 * out, because the day a second caller appears (an onboarding step, most
 * likely) is not the day to discover the two forms accept different things.
 */

export type CompanyProfileData = {
  name: string;
  dbaName: string | null;
  ein: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
  phone: string | null;
  website: string | null;
};

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-xs text-slate-400";

/** Everything except the name. Used to decide whether to show the "nothing
 * on file yet" state, which is a different thing from an empty list. */
function hasDetails(profile: CompanyProfileData) {
  return Boolean(
    profile.dbaName ||
      profile.ein ||
      profile.hqAddressLine1 ||
      profile.hqCity ||
      profile.hqState ||
      profile.hqZip ||
      profile.phone ||
      profile.website,
  );
}

/** A typed-in "acme.com" is not a URL a browser will follow from an href —
 * it resolves against this app and lands on a 404 inside Prova. Stored
 * exactly as typed; only the link target is normalised. */
function websiteHref(website: string) {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function CompanyProfileFields({ profile }: { profile: CompanyProfileData }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          Company name
          <input
            name="name"
            required
            defaultValue={profile.name}
            placeholder="Sierra Wall Systems, Inc."
            className={`w-72 ${inputClass}`}
          />
          {/* Said here, not only in the error: the person typing needs to
              know what this field IS before they clear it. */}
          <span className="text-[11px] text-slate-500">
            What a GC sees — on your contracts and in the client portal.
          </span>
        </label>
        <label className={labelClass}>
          DBA (optional)
          <input
            name="dbaName"
            defaultValue={profile.dbaName ?? ""}
            placeholder="Sierra Drywall"
            className={`w-56 ${inputClass}`}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          EIN (optional)
          <input
            name="ein"
            defaultValue={profile.ein ?? ""}
            placeholder="86-1234567"
            className={`w-40 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Phone (optional)
          <input
            name="phone"
            defaultValue={profile.phone ?? ""}
            placeholder="(720) 555-0134"
            className={`w-44 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Website (optional)
          <input
            name="website"
            defaultValue={profile.website ?? ""}
            placeholder="sierrawall.com"
            className={`w-56 ${inputClass}`}
          />
        </label>
      </div>

      <label className={labelClass}>
        HQ address line 1 (optional)
        <input
          name="hqAddressLine1"
          defaultValue={profile.hqAddressLine1 ?? ""}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        HQ address line 2 (optional)
        <input
          name="hqAddressLine2"
          defaultValue={profile.hqAddressLine2 ?? ""}
          className={inputClass}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          City (optional)
          <input
            name="hqCity"
            defaultValue={profile.hqCity ?? ""}
            className={`w-48 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          State (optional)
          <input
            name="hqState"
            maxLength={2}
            defaultValue={profile.hqState ?? ""}
            placeholder="CO"
            className={`w-20 ${inputClass}`}
          />
        </label>
        <label className={labelClass}>
          Zip (optional)
          <input
            name="hqZip"
            defaultValue={profile.hqZip ?? ""}
            className={`w-28 ${inputClass}`}
          />
        </label>
      </div>
    </div>
  );
}

export function CompanyProfile({
  profile,
  canManage,
}: {
  profile: CompanyProfileData;
  canManage: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCompanyProfile(formData);
      if (result.ok) setIsEditing(false);
      else setError(result.error);
    });
  }

  if (isEditing) {
    return (
      <form
        action={handleSave}
        className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
      >
        <CompanyProfileFields profile={profile} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setIsEditing(false);
              setError(null);
            }}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </form>
    );
  }

  const address = [
    profile.hqAddressLine1,
    profile.hqAddressLine2,
    [profile.hqCity, profile.hqState].filter(Boolean).join(", "),
    profile.hqZip,
  ]
    .filter((part) => part && part.length > 0)
    .join(" · ");

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-base font-semibold text-slate-100">{profile.name}</p>
      {profile.dbaName && <p className="text-sm text-slate-400">dba {profile.dbaName}</p>}

      {hasDetails(profile) ? (
        <div className="mt-2 flex flex-col gap-0.5 text-xs text-slate-500">
          {profile.ein && <p>EIN {profile.ein}</p>}
          {address && <p>{address}</p>}
          {profile.phone && <p>{profile.phone}</p>}
          {profile.website && (
            <p>
              <a
                href={websiteHref(profile.website)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-400 hover:text-blue-300"
              >
                {profile.website}
              </a>
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          Only the name is on file. Add your legal address, EIN and phone — a GC asks for all
          three the first time they prequalify you, and this is where they live.
        </p>
      )}

      {canManage && (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-4 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          {hasDetails(profile) ? "Edit company details" : "Add company details"}
        </button>
      )}
    </div>
  );
}
