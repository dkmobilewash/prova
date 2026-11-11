### Run takeoff waits until the sheet has said what it is: the Baker "hang" (Diego)
`diego/run-takeoff-hang`

With plan reading off, the Baker walk stalled after Run takeoff: sheet 14 of 65, no request
to the server, nothing stored. It was not a hang. A CPU profile of the stalled tab was idle.
The workspace opened on A111, the reflected ceiling plan, which "Confirm scales" had
scaled. For a second or so before the sheet's drawing captions were read, Run takeoff was
on. A press in that window started finding walls on the ceiling plan. The verdict then
turned the button off and moved the workspace to the floor plan (#1103), and the find was
dropped with nothing posted, so the walk waited 25 minutes. Run takeoff now stays off with
"Reading this sheet…" until the sheet's verdict is known. A failed read answers "offered",
so the button can never stay off for good. Checked on Baker (`takeoff-run-baker.local.spec.ts`):
on A111 the button is never on while the sheet is being read (sampled every 50 ms), and on
A101 a press stores walls in 1 s. With the gate removed, the sampler catches the button on.
