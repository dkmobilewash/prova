### The door model and its auto-post line, committed for the held-out exam (Diego)
`diego/door-line-model`

`models/door-model.json` is refit on Round 23b's training labels after Macon-Bibb's 3 existing doors left
the key (`labels-snap-20261114T0319`, main c6ed5576). It uses v1 columns, the existing-door set-aside
(#1180, #1184), and plan comparison wherever the product pairs a sheet (Macon-Bibb A1-1, Crosslines A100,
E Street A2.1). Its line is `autoLine` 0.9989, the lowest leave-one-set-out score with pooled precision
of at least 97%. At that line: 13 posts, 13 real, 0 false; 12 of them are unmarked doors today's
marked-only rule cannot post; every finished set is at least 97%. That passes Diego's ruled criterion
(at least 97% pooled and per set, zero false on training, more correct doors than marked-only).

Wired to nothing: `MODEL_EVIDENCE.doors` stays unmeasured until the original's one held-out run
(at least 95%) on these artifacts. A refit from the same table is byte-identical. The table and the
LOSO output are in `coordination/eval-out-door-line-20261114`.
