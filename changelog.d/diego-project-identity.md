### One upload holding two projects asks which one you are bidding, and never picks (behind TAKEOFF_PROJECT_IDENTITY, off) (Diego)
`diego/project-identity`

"2609 Aldrich Avenue South Suite 10.pdf" bundles Excell Academy's tenant work with Kurita's city resubmittal set. The
walls run counted Kurita's A101 and none of the job's walls, and nothing said so. Measured on 100 uploads it is 1 set
(found by eye), so the fix is a question, not a guess.

- **Who a sheet belongs to** is read from the title-block text the inventory already stores (`PlanSheetText.titleBlockText`),
  in `lib/plan-ingest/projectIdentity.ts`.
  - Pages are one project when they share a labelled project number, matching labelled names, or two or more of one
    template's repeated lines.
  - **Two different labelled numbers are never one project,** however much boilerplate they share. The first reader
    joined Excell to Kurita through the Minnesota licence certification every sealed sheet prints.
  - A table header under "PROJECT NO." is not a number.
- **When two projects each own a sheet the run would count,** the whole-set panel asks "Which one are you bidding?". No
  default, nothing counted until someone answers. The answer is stored as that project's pages
  (`TakeoffPlan.projectPages`, migration `20261120230000_add_takeoff_plan_project_pages`, additive, empty for every
  existing plan). From then on only those sheets are candidates, the rest read "another project in this upload", and
  the panel offers the switch.
- **The seam is `wallsSheetsFor`.** The run, its summary, the workspace's start page, Ask's run and the export all read
  through it, so none can count the other project. With the flag off it returns exactly what it did, and a db test pins that.

**Accepted on the 100-set title-block sweep, pre-registered, two entries** (coordination prereg-project-identity.md):
- The first run FAILED: Aldrich not separated, 0 false asks, vacuous.
- The second PASSED: Aldrich asks, Excell (3 sheets) against Kurita (26); 0 false asks on the other 99, held-out sets
  included.

Of the 36 sets that show two or more groups, every second group is the same project's consultant set (structural,
MEP, civil) under its own job number. None is counted, so none asks.

**Known limits:**
- That no-ask relies on the walls run never selecting a consultant's sheet.
- Opening the other project's sheet by hand still works as before.
- Group names can be boilerplate ("DRAWN BY:") where a block labels neither name nor number.
