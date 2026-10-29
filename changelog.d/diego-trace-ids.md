### Trace ids never repeat, so a deleted trace cannot leave a ghost

The id comes from a counter that only increments and is assigned where no caller can bypass it, instead of from the surviving traces' length.
