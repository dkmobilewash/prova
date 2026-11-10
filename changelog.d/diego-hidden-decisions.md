### Answer-key mode: hidden decisions are drawn, listed, and editable

A saved decision whose run the finder no longer offers was carried back into the file on
every save and scored, but nobody could see or change it. Green Bay's wrong walls were
exactly these.
- **On the sheet:** they are drawn as faint dashed lines in their verdict's colour.
- **In the panel:** a "Hidden decisions (N)" list shows each one's length, verdict and type.
  Each can be flipped (wall ↔ not a wall) or deleted, and Save writes the result.

Two save bugs found on the way:
- **The wall type was dropped.** Save copied a hidden decision without its `wallType`, so
  every save stripped the type from a hidden wall. It is kept now.
- **A hidden-only sheet could not save.** A sheet whose only decisions were hidden ones was
  refused as "nothing decided", so flipping a hidden decision could never be saved. Hidden
  decisions now count.

`components/answerKeyHidden.test.tsx` covers a sheet with two carried decisions. It checks
the list, Flip, Delete, and that the saved body carries exactly what is left, the wall type
included; dropping `wallType` again turns it red. Answer-key mode cannot be reached from the
e2e suite, which runs as a customer (`answer-key-gate.spec.ts`), so the spec is a component test.
