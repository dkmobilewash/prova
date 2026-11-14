### A learned scorer for renovation sheets paired with their demolition plan, remove-only, wired to nothing (R)

Existing walls counted as new are the biggest over-count on renovation sets. The
paired-renovation model failed before because none of Round 22's renovation
sets were paired; #1177 paired Macon-Bibb, and 22b/22c/23b corrected the keys.

On the post-23b snapshot (training only) the product pairs **10 renovation sets
(787 runs, 10,772 ft)**; 10 more stay unpaired (UCCS by design). The gate was
written before the table existed: remove-only (a run today's rules post comes
off when its leave-one-set-out score is below 0.1; nothing is added), total
error down, no set worse by more than 2 points AND 50 ft.

**PASS:** total error on the paired sheets 2,815 ft (today's rules) -> 2,271 ft,
**19.3% less**. It removes 984 ft of posted runs, 764 of them junk and 220 real.
Seven sets better (Macon-Bibb -10.8 pts, E Street -14.0, Wendell -6.9); three
worse by points but none by 50 ft (Clerk +16 ft, Falafel +4, Supreme Court +8).

Ships `models/wall-reno-model.json` (same columns as the wall run scorer, parity
rows in its `.control.json`) and `scripts/wall-model/reno.py` (count, LOSO,
export, `--exam` for the held-out final). **No product path reads it**: the
held-out final comes first, once, by the original.
