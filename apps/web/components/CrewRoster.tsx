import Link from "next/link";
import { CrewMemberForm } from "@/components/CrewMemberForm";
import { CrewMemberRow, type CrewRosterMember } from "@/components/CrewMemberRow";
import { SpreadsheetImport } from "@/components/SpreadsheetImport";
import type { CrewCraftOption } from "@/components/CrewMemberFields";
import type { ExistingCrew } from "@/lib/spreadsheet-import";

/**
 * The crew: everybody who works the hours and does not sign in.
 *
 * THIS SECTION RENDERS WHEN IT IS EMPTY, AND THAT IS THE WHOLE POINT.
 *
 * It used to be wrapped in `crew.length > 0 || archivedCrewCount > 0` on
 * `/team`, so a brand-new contractor saw a Team page offering him exactly
 * two things — invite a teammate by email, or share a sign-up link — and no
 * sign anywhere that a person without an email address could be recorded at
 * all. The only working path was an owner-only CSV import inside Settings
 * that nothing on /team mentioned.
 *
 * That is the classic empty-state failure: the one affordance that creates
 * the first record is hidden until a first record exists. It costs nothing
 * when the people building the app all have data, and it costs a pilot
 * contractor the product — a union drywall sub has fifteen to forty field
 * workers, none of them has a company login, and certified payroll,
 * apprentice ratios and the WH-347 are the reason he is here at all.
 *
 * `crewRoster.test.ts` renders this with an empty crew and asserts the add
 * form is in the tree, and separately reads `/team`'s source to check
 * nothing has wrapped this element in a condition again.
 *
 * NO HOOKS IN THIS COMPONENT, deliberately: the test calls it as a plain
 * function and walks the element tree it returns. Everything stateful is a
 * child (`CrewMemberForm`, `CrewMemberRow`, `SpreadsheetImport`), which the
 * walk sees as an element without invoking it.
 */
export function CrewRoster({
  crew,
  archivedCount,
  craftOptions,
  existingCrew,
  canManage,
  canSetCraft,
  canArchive,
}: {
  crew: CrewRosterMember[];
  archivedCount: number;
  craftOptions: CrewCraftOption[];
  /** Everyone already on file, ARCHIVED INCLUDED, so the spreadsheet import
   *  can say "already here" rather than creating a second row for somebody
   *  who left and came back. */
  existingCrew: ExistingCrew[];
  /** MANAGE_FIELD — may add and edit. */
  canManage: boolean;
  /** MANAGE_COMPLIANCE — may set which craft somebody works under. */
  canSetCraft: boolean;
  /** Owner and MANAGE_FIELD — may archive. Archiving is the one-way door
   *  here; there is no un-archive anywhere in the app. */
  canArchive: boolean;
}) {
  return (
    <section className="mb-10" data-tour="team-crew">
      <h2 className="mb-1 text-sm font-semibold text-ink-label">Crew</h2>
      <p className="mb-3 text-sm text-ink-body">
        The people who work the hours. They don&apos;t sign in and they don&apos;t need an email
        address — a name is enough to log their hours and put them on a certified payroll.
      </p>

      {crew.length > 0 ? (
        <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {crew.map((member) => (
            <li key={member.id} className="p-4">
              <CrewMemberRow
                member={member}
                craftOptions={craftOptions}
                canSetCraft={canSetCraft}
                canEdit={canManage}
                canArchive={canArchive}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-4 rounded-lg border border-line-card bg-surface p-5">
          <p className="text-sm font-medium text-ink">Nobody on the crew yet</p>
          <p className="mt-1 max-w-2xl text-sm text-ink-body">
            {archivedCount > 0
              ? "Everyone who was on the crew has been archived. Add someone below and their hours can be logged again."
              : "Add your carpenters, tapers and apprentices here. Once they're on the list you can log their hours on a job and their names print on the certified payroll you send the GC."}
          </p>
          {!canManage && (
            <p className="mt-2 text-sm text-ink-muted">
              Adding crew isn&apos;t part of your job function. Ask the account owner.
            </p>
          )}
        </div>
      )}

      {canManage && (
        <div className="flex flex-col gap-3">
          {/* Open already when the list is empty. A button whose only job is
              to reveal the form is a step for no reason on a screen that has
              nothing else on it — and this section exists because the add
              affordance used to be invisible. */}
          <CrewMemberForm
            craftOptions={craftOptions}
            canSetCraft={canSetCraft}
            autoFocusOpen={crew.length === 0}
          />

          {/* The spreadsheet import, ON THIS PAGE rather than only inside
              Settings. Forty hands typed one at a time is not a serious
              offer, and the import was the only path that worked — but it
              lived somewhere nothing on this page named. */}
          <SpreadsheetImport kind="crew" existingCrew={existingCrew} />
        </div>
      )}

      {archivedCount > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {archivedCount} archived {archivedCount === 1 ? "crew member is" : "crew members are"} kept
          for payroll history.
        </p>
      )}

      <p className="mt-2 text-xs text-ink-muted">
        Somebody who needs to sign in — a foreman, the office — goes under Team members above
        instead.{" "}
        <Link href="/union-compliance" className="text-link hover:text-link-hover">
          Union compliance
        </Link>{" "}
        is where crafts and union locals are set up.
      </p>
    </section>
  );
}
