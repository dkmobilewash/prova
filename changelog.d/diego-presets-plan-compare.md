### Picking a trade no longer turns plan comparison off (Diego)
`diego/presets-plan-compare`

#1087 turned plan comparison ON for every new company (2026-11-08). The trade presets, written
from Diego's 2026-11-05 table, still wrote `planCompareOn: false` when a company picked its
trade on `/welcome`. Every new company does that seconds after sign-up, so #1087's default never
survived the first screen, and a renovation set priced its existing walls as new. The E Street
walk had to switch comparison back on by hand.

The later decision wins: every preset now leaves plan comparison ON. Scanned sheets stay off.
`trade-presets.test.ts` and `tradePresets.dbtest.ts` pinned the old `false`; both now pin `true`
and say why.

Not backfilled: a company that signed up after #1087 and picked a trade still has comparison
off, the value the preset wrote. Changing it would flip a setting under a live company without
asking, so that is left for an owner (Settings → Estimating) or a separate decision.
