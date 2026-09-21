"use client";

// 16px, not the 14px the label inherits: iOS Safari zooms the whole page
// when a focused input is under 16px, and leaves it zoomed. `min-h-11` is a
// 44px tap target — this form gets filled in on a phone in a trailer.
const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";
const lockedClass =
  "min-h-11 rounded-md border border-line-row bg-canvas/60 px-3 py-2 text-base text-ink-body";

export type CrewCraftOption = { id: string; label: string };

export type CrewMemberFieldValues = {
  legalFirstName: string;
  legalMiddleName: string | null;
  legalLastName: string;
  employeeNumber: string | null;
  craftClassificationId: string | null;
};

/** The name, shown as text on the edit form. See the note below on why
 * there is no input for it. */
export type CrewMemberLockedIdentity = { nameLabel: string };

/**
 * The fields of one crew member — a person who works the hours and has no
 * login. Shared by the add form and the inline row edit, which is this
 * codebase's list-page convention and here it earns it twice over: the two
 * post the same field names to functions that read them with the same
 * parser (`lib/actions/crewMembers.ts`), and the DIFFERENCE between the two
 * forms is a safety property rather than a style choice.
 *
 * `locked` is what makes it the edit form. When it is set the legal name
 * renders as TEXT and there is no input for it, so it is not in the
 * submitted FormData at all.
 *
 * WHY THE NAME CANNOT BE EDITED. `prova_crew_member_identity_lock`, a
 * BEFORE UPDATE trigger on `CrewMember`, refuses any change to it at the
 * database — a WH-347 that has been signed and filed names this person, and
 * the row it was built from has to keep saying the same thing. An input
 * here would be a control that works perfectly in `next dev` and is a dead
 * button in production, where the thrown message is redacted to a digest.
 * The screen says what to do instead: archive and re-add.
 *
 * WHAT IS DELIBERATELY NOT HERE. `CrewMember` also carries an address, a
 * phone, a hire date and the last four of the SSN. All four matter — the
 * address is Davis-Bacon's basic-records rule — and none of them is worth
 * making a contractor type before he has got his crew into the product at
 * all. The payroll register import fills the identifying number, and the
 * rest can follow. A first run is a name and a craft.
 */
export function CrewMemberFields({
  defaults,
  craftOptions,
  canSetCraft,
  locked,
}: {
  defaults?: Partial<CrewMemberFieldValues>;
  /** The company's craft classifications. Empty until somebody has set up a
   *  union local, which a brand-new company has not. */
  craftOptions: CrewCraftOption[];
  /** Whether this viewer may write a craft. Setting who works under a craft
   *  is MANAGE_COMPLIANCE on /union-compliance — fringe rates and the
   *  apprentice ratio are computed from it — so the field is not offered to
   *  somebody the action would refuse. */
  canSetCraft: boolean;
  locked?: CrewMemberLockedIdentity;
}) {
  return (
    <>
      {locked ? (
        <div className={labelClass}>
          Name
          <p className={lockedClass}>{locked.nameLabel}</p>
          <span className="text-xs text-ink-muted">
            A name can&apos;t be changed once it&apos;s saved — it&apos;s what past payrolls already
            say. To fix a spelling, archive this person and add them again.
          </span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            First name
            <input
              type="text"
              name="legalFirstName"
              required
              autoComplete="off"
              defaultValue={defaults?.legalFirstName ?? ""}
              placeholder="Luis"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Middle name
            <input
              type="text"
              name="legalMiddleName"
              autoComplete="off"
              defaultValue={defaults?.legalMiddleName ?? ""}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Last name
            <input
              type="text"
              name="legalLastName"
              required
              autoComplete="off"
              defaultValue={defaults?.legalLastName ?? ""}
              placeholder="Ortega"
              className={inputClass}
            />
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {canSetCraft && craftOptions.length > 0 && (
          <label className={labelClass}>
            Craft
            <select
              name="craftClassificationId"
              defaultValue={defaults?.craftClassificationId ?? ""}
              className={inputClass}
            >
              <option value="">Not set yet</option>
              {craftOptions.map((craft) => (
                <option key={craft.id} value={craft.id}>
                  {craft.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={labelClass}>
          Employee number
          {/* Autocorrect off for the same reason as an asset tag: a phone
              keyboard rewrites "A-1149b" into a word, and the whole point of
              the field is that it matches what payroll has. */}
          <input
            type="text"
            name="employeeNumber"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            defaultValue={defaults?.employeeNumber ?? ""}
            placeholder="Badge or payroll number, if you use one"
            className={inputClass}
          />
        </label>
      </div>

      {canSetCraft && craftOptions.length === 0 && (
        <p className="text-xs text-ink-muted">
          You can add a craft — Carpenter, Taper, Apprentice — once you&apos;ve set up a union local
          on Union compliance. A crew member saves fine without one.
        </p>
      )}
    </>
  );
}
