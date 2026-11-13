### Chrome rounds become PRE-LABEL & CORRECT: C-Stream's run written as the starting key

zzPrefill writes the finder's own answer (un-held runs as wall, held runs as not-wall, detected doors and
windows) into takeoff-labels-v1 files marked C-Stream-prefill / reviewComplete:false, so a labelling round
starts from the product's output and only corrects it. It refuses to overwrite any existing label, refuses
held-out sets without an explicit override, computes feet-per-unit from the sheet's own width times the
drawing-read scale (never a guessed constant), and fails rather than passes when its config resolves to
nothing. Validated on TRDI A1.0 before the first round posted.
