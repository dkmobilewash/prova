### A hiring hall can now dispatch the field crew it actually sends (Cyrus)
`cyrus/dispatch-crew-members` — adds a migration (additive)

On a job's Crew & time tab, the "Union hiring-hall dispatch" form could only
pick people with a login. `DispatchSlip.employeeUserId` was a REQUIRED key to
`User`, and field crew are `CrewMember` rows with no login, which is exactly
who a hiring hall sends. So the form couldn't record the one group it exists
for. #412 fixed the same dead end for time entry, and this copies that fix.

**Schema, additive only, announced in #prova-build before the push.**
`20260921120000_allow_crew_dispatch_slips` adds `DispatchSlip.crewMemberId`
(RESTRICT to `CrewMember`, indexed), loosens `employeeUserId` to nullable, and
adds the hand-written CHECK `DispatchSlip_employee_or_crew`, which requires
exactly one of the two to be set. It is the same SQL shape as
`TimeEntry_employee_or_crew`. Nothing is dropped or renamed. The build that is
still live during the deploy window reads `employeeUserId`, and that column,
its index and its foreign key are all unchanged (#378).

**One trap that is easy to miss and was checked.** In Prisma an OPTIONAL
relation defaults to `ON DELETE SET NULL`. If `onDelete: Restrict` had been
left off the loosened `employeeUser` relation, the generated migration would
have dropped and re-added `DispatchSlip_employeeUserId_fkey`. That breaks
"no migration drops a foreign key" in `scratch-cleanup-order.test.ts`, and a
user delete would then trip the XOR check instead of the RESTRICT that
`removeTeamMember` explains. The schema-to-schema diff shows no FK change.

**The form and the action.** The dispatch form now receives the same worker
list as the time-entry form. Both are built by the new `workerOptions()` in
`lib/worker-select.ts`, with teammates marked "(signs in)" and crew marked
"(crew)". It posts `worker` as `user:<id>` or `crew:<id>`.
`uploadDispatchSlip` parses that the way `logTimeEntry` does. It refuses
another company's crew member or an archived one with a readable sentence
rather than a redacted throw, and it still accepts the old `employeeUserId`
field, so a tab left open on the previous build still files.

**The other things that read a dispatch slip.** The dispatch list on the Crew
& time tab shows a crew member's legal name with "(crew)". The Ask
`dispatch_slips` tool selects the crew member, names them, and adds a
`workerKind` field. Before this, a crew slip would have crashed on
`slip.employeeUser.name`. The `/union-compliance` classification counts, the
craft-delete guard and the export only count or list the model, and none of
them read the person. The cleanup scripts delete `DispatchSlip` by job and
never delete `CrewMember`, so the new RESTRICT key blocks nothing that they
delete.

**How it was checked.** `dispatchSlips.dbtest.ts` ran against a throwaway
embedded Postgres with every migration applied. It covers a crew dispatch
being recorded, teammate dispatches through both the new and the old field,
a slip naming neither or both being refused by the CHECK, and RESTRICT on the
crew member. Mutation tests: dropping the CHECK turned exactly the
"neither" and "both" tests red. Restoring the old form turned the
crew-listing test red. Handing the dispatch form logins only on the page
turned the page-wiring test red.
