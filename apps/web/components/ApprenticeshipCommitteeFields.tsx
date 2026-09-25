/**
 * The committee fields, shared by the add form and the inline row edit.
 *
 * ONE component for create and edit, which is the house convention for a
 * list page and not a preference: two copies of a field set drift, and the
 * way they drift is that one of them quietly stops writing a column, so a
 * save through that form clears it. `ApprenticeshipRowActions` has the
 * comment about what a whole-row update does to a field the form forgot.
 *
 * NOTHING HERE IS PRE-FILLED FROM ANYWHERE. This is the screen where a
 * contractor copies a committee off DIR's own lookup, and every blank is a
 * blank C Stream refuses to guess at. The note under the address says so out
 * loud, because a form with empty boxes and no explanation reads like a form
 * somebody has not finished building.
 */

const field =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

export type CommitteeFieldValues = {
  name: string;
  craftName: string;
  craftClassificationId: string | null;
  geographicArea: string;
  programSponsorNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  fax: string | null;
  phone: string | null;
  approvedToTrainUs: boolean | null;
  sourceUrl: string | null;
  note: string | null;
};

export const EMPTY_COMMITTEE: CommitteeFieldValues = {
  name: "",
  craftName: "",
  craftClassificationId: null,
  geographicArea: "",
  programSponsorNumber: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  email: null,
  fax: null,
  phone: null,
  approvedToTrainUs: null,
  sourceUrl: null,
  note: null,
};

export function ApprenticeshipCommitteeFields({
  values,
  crafts,
  /** On an edit, the craft is not offered: every notice snapshots the craft
   * name at creation, so renaming it here would make the directory and the
   * sent notices disagree with nothing on screen to say why. A committee
   * covering a second craft is a second row. */
  craftEditable = true,
}: {
  values: CommitteeFieldValues;
  crafts: readonly { id: string; label: string }[];
  craftEditable?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Committee name
          <input
            name="name"
            defaultValue={values.name}
            placeholder="e.g. Southern California Drywall/Lathing JATC"
            className={`w-72 ${field}`}
          />
        </label>

        {craftEditable ? (
          <label className="flex flex-col gap-1 text-xs text-ink-body">
            Craft or trade
            <input
              name="craftName"
              defaultValue={values.craftName}
              placeholder="as the committee names it"
              className={`w-52 ${field}`}
            />
          </label>
        ) : (
          <div className="flex flex-col gap-1 text-xs text-ink-body">
            Craft or trade
            <span className="px-2 py-1 text-sm text-ink-muted">{values.craftName}</span>
            <span className="text-ink-muted">
              Fixed — notices already carry this wording.
            </span>
          </div>
        )}

        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Geographic area
          <input
            name="geographicArea"
            defaultValue={values.geographicArea}
            placeholder="e.g. Los Angeles, Orange and Ventura counties"
            className={`w-72 ${field}`}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Your classification (optional)
          <select
            name="craftClassificationId"
            defaultValue={values.craftClassificationId ?? ""}
            className={`w-56 ${field}`}
            disabled={crafts.length === 0}
          >
            <option value="">Not linked</option>
            {crafts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-ink-muted">
            {crafts.length === 0
              ? "None yet — add a classification under a local first."
              : "Only used to suggest this committee on a job that runs that craft."}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Program sponsor number
          <input
            name="programSponsorNumber"
            defaultValue={values.programSponsorNumber ?? ""}
            placeholder="blank if you don't have it"
            className={`w-40 ${field}`}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Approved us to train?
          {/* THREE values, and the third is load-bearing. 8 CCR 230(a) sends
              an approved contractor to one committee and an unapproved one to
              all of them, so "not recorded" has to stay reachable — otherwise
              the job screen would count notices off a default nobody chose. */}
          <select
            name="approvedToTrainUs"
            defaultValue={
              values.approvedToTrainUs === null ? "" : values.approvedToTrainUs ? "yes" : "no"
            }
            className={`w-44 ${field}`}
          >
            <option value="">Not recorded</option>
            <option value="yes">Yes — we are approved</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Address
          <input
            name="addressLine1"
            defaultValue={values.addressLine1 ?? ""}
            placeholder="street"
            className={`w-64 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          &nbsp;
          <input
            name="addressLine2"
            defaultValue={values.addressLine2 ?? ""}
            placeholder="suite (optional)"
            className={`w-40 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          City
          <input name="city" defaultValue={values.city ?? ""} className={`w-40 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          State
          <input name="state" defaultValue={values.state ?? ""} className={`w-20 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          ZIP
          <input
            name="postalCode"
            defaultValue={values.postalCode ?? ""}
            className={`w-24 ${field}`}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Email
          <input
            type="email"
            name="email"
            defaultValue={values.email ?? ""}
            className={`w-56 ${field}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Fax
          <input name="fax" defaultValue={values.fax ?? ""} className={`w-40 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Phone
          <input name="phone" defaultValue={values.phone ?? ""} className={`w-40 ${field}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-body">
          Where you read this
          <input
            type="url"
            name="sourceUrl"
            defaultValue={values.sourceUrl ?? ""}
            placeholder="the DIR page you copied it from"
            className={`w-72 ${field}`}
          />
        </label>
      </div>

      <input
        name="note"
        defaultValue={values.note ?? ""}
        placeholder="Note (optional)"
        className={field}
      />

      <p className="text-xs text-ink-muted">
        C Stream does not hold a committee directory and will never fill these in for you. Look the
        committee up on DIR&rsquo;s own list for the craft and the area, and paste what it says — a
        notice delivered to the wrong committee has its own penalty, so a plausible address is worse
        than an empty one. A form printed with a blank here says which blank it is and who fills it.
      </p>
    </>
  );
}
