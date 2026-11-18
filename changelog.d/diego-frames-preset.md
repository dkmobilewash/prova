### A framing company starts its doors and windows at frames; every other trade stays by others (Diego)
`diego/frames-preset`

Diego's ruling, 2026-11-17: a framing trade frames the rough opening of every door and window, so a
new company that taps Framing and drywall now starts with `doorScope` FRAMES and its posted doors and
windows are priced. Acoustical ceilings, plaster/EIFS, fireproofing and Something else stay BY_OTHERS
(there is no drywall-only preset today; `framesOpenings` already limits frame pricing to steel framing).
Existing companies are not touched: the preset only runs at the trade tap, and the schema default is
still BY_OTHERS, so there is no migration and no backfill.

What was wrong before, besides the default: the trade step's radio started at "By others" and ALWAYS
sent its answer, so the preset's own `doorScope` never reached a company through the screen at all.
The radio now starts unanswered with one line saying the trade decides, and sends nothing until the
person picks. An explicit pick still wins, by others included.

Checks: `doorLines.test.ts` pins framing presets at FRAMES and every other at BY_OTHERS (and that some
preset is FRAMES, so a scope rename cannot quietly empty the ruling); `doorLines.dbtest.ts` runs the
action with no answer (framing gives FRAMES, acoustical and plaster give BY_OTHERS) and with explicit
answers (DOORS_AND_FRAMES and BY_OTHERS on framing are kept). Mutation (preset back to BY_OTHERS) reds
both. The zero-touch scope-gated figure ($232,500 pooled: $116,850 door frames + $115,650 windows)
moves to priced when zero-touch re-runs with the preset applied.
