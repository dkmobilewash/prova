### The queue's height box holds still once somebody is in it

**What happened:** fast-confirm's step 6 failed first try three times in a day (#1017's old run, #1023 run 42166063952, #1025 run 42167451175). CI's failure screenshot showed the box reading `10'-0"9'-6"`.
- When step 5's save landed after T, the type it had just given a height (ZF2, 10 ft) pre-filled 10'-0" into the box the person was already typing in.
- The typed 9'-6" was appended to it, and the height was refused.

**Fix:** the box keeps what it showed when it got focus (T or a tap), so a late pre-fill cannot change it under the caret. Picking a type or a zone clears that, so the height still follows the type picked. No assertion changed. `queueHeightHoldsStill.test.tsx` reproduces the order and goes red without the fix.
