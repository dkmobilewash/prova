### Renovation junk comes down on sheets with no demolition plan (Diego)
`diego/reno-unpaired-exam2`

Behind `TAKEOFF_RENO_UNPAIRED=1` (server env; unset = today exactly). The
2026-11-19 census: 10 of the 12 sets carrying 80% of renovation junk have no
demolition plan, so R never ran there. Shipped R stays exactly as-is on
paired sheets; R-ALL (`models/wall-reno-all-model.json`, same columns,
settings and 0.10 remove-only cut, trained on every training renovation
sheet's runs) runs only where there is no prior. The split was chosen after
R-ALL's training numbers, so its ONLY gate was Release Exam 2's held-out
one-shot, fired once, unmodified, 2026-11-20: pooled held-out junk+missed
19,416 → 18,425 ft (−991), 11 of 33 sets improved (CENTRAL Arts −298,
MDR −316, df9e0224 −143, SLN −85), no set worse by >2 pts and >50 ft (worst
uptick Gen-BBQ +13 ft). Full verdict table in the coordination log,
2026-11-20. The model was reproduced deterministically from the build-night
table (seeded trainer; the LOSO diagnostic reprinted the build night's
numbers exactly); its control file rides along and `loadRunKind` refuses a
drifted format.
