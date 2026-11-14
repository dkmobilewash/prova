### The run and reno models ship in the deploy's traced files

`outputFileTracingIncludes` named only `wall-model.json`, so the day both new model variables were turned on in production the deploy shipped neither `wall-run-model.json` nor `wall-reno-model.json` — the variables were set, `loadRunModel` found no file, and both models ran silently off, exactly the failure the old variable's own comment warns about. Both files are traced now. Caught before "ON in production" was logged, by reading the env listing's comments instead of trusting the env save.
