### Run takeoff takes off the set's floor plans, the open sheet first; Baker opens on A101 (Diego)
`diego/takeoff-whole-set`

The workspace's Run takeoff put only the sheet on screen on the job. A set's other floor
plans waited for a different button on the Takeoff tab, so the review queue saw one sheet's
groups; the accept-job walks never met Topeka's three floors together. Now the sheet on
screen goes first and shows at once. Then every scaled floor plan the whole-set rule counts
(one plan per floor, never a sheet that says it is not a floor plan) is put on the job one
by one, with "Run takeoff: 3 of 8 floor plans on the job · now A-102…". Nothing more happens
when the owner has whole-set takeoff off.

With nothing named (plan reading and comparison off), the page inventory's own read now
keeps the caption that made a sheet a floor plan, so the one-plan-per-floor rule can tell
Baker's A100 OVERALL FLOOR PLAN from A101 FLOOR PLAN. The workspace opens on A101, and A100
is the same floor, not a second takeoff. An untitled sheet the inventory read as not a floor
plan (Baker's A111 ceiling plan, which Confirm scales had scaled) is skipped. Checked on
Baker and Topeka (`takeoff-whole-set-run.local.spec.ts`): Baker opens on A101 and posts A101
alone; Topeka posts page 74 a second after the press, then all 8 of its floor plans within
18 s. Mutations: without the caption titles Baker opens on A100; without the rest of the
set, Topeka shows no progress.
