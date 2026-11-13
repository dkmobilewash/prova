### Zero-touch learns LOSO: fold models per set, skipped sets named

METHOD v2's everyday gate: ZT_LOSO_DIR names a directory of per-set wall models (<labelSet>.json, each
trained WITHOUT that set); the eval scores each set with its own fold model and reports per-set and pooled
TOTAL ERROR over the covered sets only. A set with no fold model is skipped and named — never silently
scored with the global model, which would leak its own training signal. Without ZT_LOSO_DIR nothing
changes; the fixed held-out sets remain the final exam, run once per release.
