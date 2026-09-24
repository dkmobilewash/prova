import { MARKER_OPTIONS } from "@/lib/determination-facts";
import type { DeterminationMarker } from "@/lib/determination-standing";

export type DeterminationFactsDefaults = {
  determinationRef: string | null;
  /** YYYY-MM-DD or null — the value a `<input type="date">` takes. */
  issuedOn: string | null;
  expiresOn: string | null;
  expirationMarker: DeterminationMarker | null;
};

const EMPTY: DeterminationFactsDefaults = { determinationRef: null, issuedOn: null, expiresOn: null, expirationMarker: null };

/**
 * The four facts a determination document states about itself, as one
 * shared field set for the attach form and the row's edit form — the
 * list-page convention (one `*Fields` component for create and edit), so
 * the two cannot drift.
 *
 * NO DATE HERE DEFAULTS TO TODAY. An issue date and an expiration date are
 * printed on the document; a blank one is "not entered" and the standing
 * line says so. `localToday()` would be wrong on both counts and is not
 * imported.
 */
export function DeterminationFactsFields({
  defaults = EMPTY,
  fieldClassName,
  labelClassName,
}: {
  defaults?: DeterminationFactsDefaults;
  fieldClassName: string;
  labelClassName: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={labelClassName}>
        Determination number
        <input
          name="determinationRef"
          defaultValue={defaults.determinationRef ?? ""}
          placeholder="e.g. SC-023-31-2, issue 2026-1"
          className={`w-52 ${fieldClassName}`}
        />
      </label>
      <label className={labelClassName}>
        Issue date
        <input type="date" name="issuedOn" defaultValue={defaults.issuedOn ?? ""} className={fieldClassName} />
      </label>
      <label className={labelClassName}>
        Expiration date
        <input type="date" name="expiresOn" defaultValue={defaults.expiresOn ?? ""} className={fieldClassName} />
      </label>
      <label className={labelClassName}>
        Asterisk after the expiration
        <select name="expirationMarker" defaultValue={defaults.expirationMarker ?? ""} className={fieldClassName}>
          {MARKER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
