### The renovation census on the larger training set, and the two parked existing-wall rules re-measured (switched off)

NOT FOR MERGE AS A BEHAVIOUR CHANGE: both rules stay off. This carries the measurement and
the ported code so the decision can be made on numbers.

How the 14 labelled renovation training sheets say what is existing:
- **Legend swatch:** Bunkie A100, Murray A101 and Supreme Court A111. Today's shipped rule
  already reads these.
- **A paired demolition plan:** Baker A100, Clerk of Courts A-101.3 (from AD101.3), Bunkie
  A100, Crosslines A100 and E Street A2.1.
- **Two pens:** Baker A100 and E Street A2.1.
- **Fill vs outline:** not a convention. Junk is on both sides.
- **No machine-readable convention:** BSL A1.0 draws its demolition plan as a second drawing
  on the same sheet, which the page pairer cannot pair. W8th A201 says it in a plan note, the
  area route that was not shipped. Baker A101, Bunkie A104, Green Bay and McAllen have none.

Grey pen (route 3 in `existingWalls.ts`, behind `sheetPens`):
- Training: 892 ft of junk for 84 ft of real, on Baker and E Street only.
- Held-out: 910 ft of junk for 370 ft of real, 2.5 : 1. It fails, as when it was first parked.

Plan comparison (`planCompare.ts`, with `planPairs.ts` driving the shared pairer):
- Training: 2,548 ft of junk for 704 ft of real, 3.6 : 1. Renovation posted-vs-key would go
  from +121.9% to +69.4%.
- Two buildings lose more than 100 ft of real wall: Crosslines 347 ft and E Street 262 ft. In
  both, the lost "real" walls are ones the paired demolition plan draws as existing to remain,
  which is the shipping rule's stated-reason case.
- Held-out: renovation 5,912 ft of junk for 187 ft of real (31.7 : 1), posted +182.3% →
  +89.5%. New build 1,805 ft of junk for 99 ft of real, posted +21.3% → +9.7%.
- It is not wired into the app. The app pairs no demolition plan with its new plan today.
