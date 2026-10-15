### Saved crews, "Not right" on agent findings, and near misses without an OSHA number (Cyrus)
`cyrus/schema-trio`

Three small features, each needing one additive migration, so each is
announced and applied separately.

**Saved crews** (`20261011130000_add_saved_crews`). The schedule's "Put
someone on" form now has a Crew picker that ticks exactly that crew's
people, and a "Save these people as a crew" box; rename and archive live
under "Manage saved crews". A crew only ticks checkboxes — the bulk schedule
action still receives the ticked people as before, so renaming, re-saving
or archiving a crew changes no planned day. Same capability as writing the
schedule (MANAGE_FIELD); archive is owner-only and returns its refusal.
Memberships CASCADE from user and crew member on purpose: a picking aid must
never block `seed-demo --undo`. Check: `crews.test.ts`,
`crewScheduleBoard.test.ts` ("picking a crew ticks exactly its people").

**"Not right" on findings** (`20261011130100_add_finding_dismissed_reason`).
`AgentFinding.dismissedReason` records WHY: Dismiss now writes HANDLED, the
new "Not right" (on /ai and on the bid workspace's Research and Estimate
check tabs) writes WRONG, Restore clears it, and /ai/activity tags those rows
"Marked not right". The research pass's one web prompt now lists the
findings on the same bid that were marked WRONG, so it stops handing back a
claim a person already rejected. Rows dismissed before this read NULL.
Check: `bidResearch.test.ts` ("tells the web pass…"), `agentSettings.test.ts`.

**Near misses** (`20261011130200_add_near_miss_incidents`). Logging a near
miss used to take an OSHA case number from SafetyCaseCounter, leaving the
300 log numbered with a gap nothing on it explains. `IncidentOutcome` gains
NEAR_MISS and `SafetyIncident.caseNumber` becomes nullable, with a CHECK
that it is null exactly for a near miss. A near miss is listed but carries
no case number, is not counted as a case or as recordable, and Ask reports
it with `case: null`. A near miss edited into a real injury gets its number
then; a numbered case can never become a near miss (its number is on the
log). The phone app shows such rows without a number but cannot file one
yet. Check: `safety.test.ts` "near misses take no case number" — the counter
stays at 0.
