### The car was not a wall, and the wall nobody found was in no list (Diego)

`diego/classify-objects`

Two findings off a real West Herr Jaguar plan, clicked on the live site.

#### 1. A dealership plan draws cars, and the classifier had never heard of one

The not-a-wall list named counters, cabinets, fixtures, stairs, furniture and
reference lines. **It did not name vehicles.** On a showroom floor the runs
followed a car's roofline and body curves exactly.

There is a geometry reason it got that far: curves are flattened into short
segments on purpose (#743, so a curved wall is found at all), and two flattened
Bézier pieces that run parallel for a stretch pass every test the finder has —
parallel, overlapping, inside the thickness window, long enough.

So vehicles are named now, with equipment, machinery, racking, millwork and
planters. **And above the list, the rule that outlives it:**

> a wall is drawn as TWO STRAIGHT PARALLEL LINES a constant distance apart,
> running between other walls. An outline that curves, tapers, or closes on
> itself is an OBJECT, however neatly two of its edges happen to run parallel
> for a stretch.

A list only ever covers what somebody has already been bitten by. That sentence
is what covers the next thing, and `wallClassifyPrompt.test.ts` pins it —
deleting the rule turns the suite red, which mutation proved.

#### 2. It only ever said what was WRONG, never what was ABSENT

Walls were being missed and nothing could say so. That is not an oversight in
one check, it is structural: **a wall the finder never paired is in no cluster,
no group and no total**, so no census, no bench diagnosis and no sum downstream
can notice it is gone. Every instrument in this repo reasons about runs that
exist.

The model is looking at the same drawing a person is. It can say *"the south
side of EX'G FORD SPACE 139 has no run on it"* — and that is a better recall
instrument than tuning a constant, because it travels to any office's drawings.

**It reports words, never a quantity.** A `MissingWall` carries where it is and
why it is a wall, and no length, thickness or geometry at all: the estimator
traces it with the measuring tools and the number comes off the drawing like
every other one. The panel lists them under "trace these by hand".

Bounded, because nothing it says can be acted on automatically: 25 at most, each
field trimmed to 200 characters, and a row with no location is dropped — "a wall
is missing" with nowhere to look is an alarm nobody can answer, sitting beside
the ones they can.

#### The prompt moved, so its version did

`wall-classify.1` → **`.2`**, and the action now records the exported constant
instead of a second spelling of it. A literal there is how a ledger goes on
reporting what the old prompt asked after the words have changed — the silent
failure `promptVersionCensus.test.ts` exists for.

#### Checks

Preflight green, 10,808 tests, no migration. **Eight mutations, eight red** —
a row with no location kept, the list unbounded, the fields unbounded, a
non-object row read, vehicles removed from the list, **the shape rule deleted**,
the missing-walls panel removed, and the ledger returned to a hardcoded version.

Three of those were blind until this PR added the guards: the prompt's own
rules were untested prose, and the panel was unasserted markup.

#### Still open

Runs continue through doorways rather than stopping at them. That is deliberate
— openings are deducted by the assembly, and stopping as well would deduct them
twice — but it reads as wrong on screen, and Diego has asked for runs that stop
at openings. That changes quantities (2,165 ft centreline against 1,966 ft net
on A-101, about 9%), so it ships separately, measured on the bench.
