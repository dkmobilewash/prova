### The wall-model source is text again, not binary

A literal NUL byte in wallModelFile.ts, written where the escape was meant, made git treat the file as binary — no diff, no blame, no way to resolve a conflict in it.
