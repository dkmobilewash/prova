### Crew time entry with cost codes (Diego)
`diego/crew-time-entry`

A foreman logs hours for themselves, but on a jobsite the hours belong to
the crew. Until now the phone's time entry could only file the caller's own
hours with no cost code, so labour never reached the SOV line it belongs to
and a worker without a login couldn't be named at all.

The migration makes `TimeEntry.employeeUserId` nullable and adds the XOR
CHECK (an entry names a User OR a crew member, never both) — the "held back"
follow-up in `labor.prisma`. Three list endpoints (`/api/v1/crew`,
`/api/v1/jobs/[id]/line-items`, `/api/v1/crafts`) feed the phone's pickers,
and the time POST/GET now carry `crewMemberId`, `lineItemId` and
`craftClassificationId`. Every payroll read path that dereferenced
`employeeUser` without a null check (certified payroll, WH-347, prevailing
wage, union compliance, the job page) now goes through
`timeEntryWorkerName`/`timeEntryWorkerId` in `worker-name.ts`, so a crew
member's name reaches a filing instead of an email address or "undefined".
Checked by typecheck/lint and a demo-DB round-trip (create an entry with a
cost code and craft; the response carries both).
