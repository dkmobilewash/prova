### A restored draft never reissues a trace id, and a reload is not stopped when the draft holds the work

- A restored draft, or a review kept across a re-read, landed on a fresh state whose trace counter was 0. The next trace was `t0` again, beside the restored `t0`, and Chrome's Washington Village backup ended in a second `t0` and `t1`. `withTraces` now carries traces over with the counter past every id they use, and renumbers any id a backup already repeats, so a save cannot merge two traces or drop one. The counter is #840's.
- The leave-page prompt no longer fires while this browser's draft holds the review. Reloading the same sheet, or reopening it, offers Restore. In round 10c the prompt cancelled Chrome's "reload", the tab kept running the JavaScript from before :3010 was rebuilt, and the old "No pairings were captured" refusal kept appearing. The prompt still fires when storage refuses the draft, or when a restore offer is waiting (the draft is not written then).

Check: `pnpm test:e2e -- --takeoff-click -g "K15"`.
