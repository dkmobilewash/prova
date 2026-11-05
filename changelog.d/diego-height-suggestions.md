### Wall heights as suggestions with their source: sections by part of the building, "see sheet X", and the ceiling plan's rule (Diego)
`diego/height-suggestions`

Round 14's key (heights-key-r14.json, Chrome's text report) says heights are
rules plus elevations, one rule per type, with a general note for the rest.
What the set reader now finds, each figure with the sheet and words it came from:

- **Sections' level markers, measured from the floor.** "LOWER BOD 112'-0"",
  "ADMIN JBE 112'-4"", "CENTRAL TOW 116'-8"" over "FIRST FLOOR 100'-0"" (Joplin);
  "ARCHITECTURAL FFE = 100'-0"" as the set's datum. T.O. and B.O. need their
  dots ("ANGLE ATTACHMENT TO JOIST" is no top of joist).
- **One level per part of the building.** The words round a level's
  abbreviation name its zone; each zone takes its deck, else its bearing line;
  a roof framing plan's or a structural sheet's spot elevations count only where
  no section prints a level. One height answers; several are OPTIONS, nothing
  picked: Joplin A/B/L get 12'-0" / 12'-4" / 16'-8"; Bunkie 10'-0" / 14'-4".
- **The plan sheet's own building.** A level printed on "- WAREHOUSE"
  elevations belongs to the "FLOOR PLAN - WAREHOUSE": Bunkie A104 takes 14'-4",
  and the addition's plan, naming no level sheet's building, takes the zone that
  names none, 10'-0" (`buildingsOf`, a caption tail a PLAN also uses).
- **"SEE SHEET A300" is followed** to that sheet's labelled wall heights
  (Grand Junction's interior elevations: 8'-0" "T" wall, 9'-6" at tinting,
  11'-6" accent, 12'-0" at sales), as options. A bulkhead's dimension is not a
  wall height.
- **The ceiling plan's rule.** Green Bay A4.0: note 9 "TERMINATE ALL PARTITIONS
  8" ABOVE HIGHEST ADJACENT CEILING" with note 2 "ALL DROPPED CEILINGS ARE 8'-0""
  → 8'-8". A stated "ALL … CEILINGS ARE" wins over a tally of tags, and an
  A.F.F. figure beside a bulkhead, soffit or chase is not a ceiling.

Options reach the screen: the legend add writes "Height option N ft: <sheet
and words>" lines into the type's notes, and Set height (review queue and
viewer) offers each beside the ceiling and the legend's figure.

Scored with the round-14 scorer (score_heights.py, by footage of key walls,
within 6 in), the height the library writes per type:

| | main f93dc6c6 | this branch |
| --- | --- | --- |
| training correct | 7.7% | **30.0%** (32.4% with the plan sheet's building, room zones lenient) |
| training wrong | 0.0% | 0.0% |
| held-out correct (measured once) | 1.3% (3.1% lenient) | 1.3% (3.1% lenient) |
| held-out wrong | 5.9% | 5.9% |

Per type on training (options counted): 19 of 39 exact, 17 partial (Green Bay /
McAllen's produce area at 9'-8"), none wrong. Two key lines were corrected by
the key's owner after checking the PDF text (Green Bay/McAllen 8'-8", Grand
Junction's labelled tinting height).

Not done: Joplin's legend read files its ceiling type as C, not K; Bunkie's
P06/P07 say two heights for two sides and stay a question; Crosslines' and
Hutto's floor-to-floor; per-room placement of Joplin's zones (one height per
item per job, #987).
