### A legend read that lands after the takeoff reaches the review queue without pressing Run takeoff again

- **The gap (Chrome on Baker, 2026-11-06).** The queue's suggestions are stored when takeoff runs: each group's tag type and the windows to confirm. A legend read that finished after the run (the legend pump on a new customer) left untyped groups and the ceiling's 10'-0" until somebody pressed Run takeoff again. A code change to those rules did the same.
- **Each sheet's suggestions now carry a stamp:** the rules version (`SUGGESTION_RULES`) and the moment the run read the legend. Every detection that writes a sheet's walls stamps it.
- **A counted sheet whose stamp is older than the newest legend save, or than the current rules, is worked out again after the response.** That fires when a legend proposal is saved and on every queue load:
  - the walls are detected again with the stored legend;
  - the windows are counted again;
  - the set's sheet-wide height (Baker's 15'-0" "to deck") is stored from the legend.
- **Nothing a person decided moves.** Detection only appends a newer proposal run, which the queue reads for the groups still untyped. Measurements on the job (typed, kept or dropped) are not touched, unlike Run takeoff again. A window count already decided is left alone.
- **No model is called.** Detection, the legend lookup and the door schedule lookup take a `noModel` flag, so only stored reads are used.
- **Measured on Baker A101** (a scratch copy of the dev database, legend saved two days after the run):
  - groups with a suggested type: 1 of 15 → 9 of 20;
  - feet still matched to the job's runs: 653 → 653;
  - windows to confirm: 0 → 1;
  - every measurement on the job byte-identical;
  - the refresh took 7.1 s, and nothing was stale afterwards.
- **Bump `SUGGESTION_RULES`** (`lib/takeoff/suggestionStamp.ts`) when a change alters what a run suggests. Every counted sheet is then worked out again once, on its next queue load.
