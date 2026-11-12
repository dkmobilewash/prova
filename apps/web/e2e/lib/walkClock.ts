/**
 * ── WHICH OF A STEP'S SECONDS A PERSON WOULD SPEND, AND WHICH ARE THE WALK'S OWN ──
 *
 * A flow walk times each step by the wall clock, and some of that clock is the walk waiting for
 * itself: looking for a bar that never comes (Totem Lake's Run takeoff: 20 s for a demolition
 * pairing on a set with none), pausing for a screenshot, re-opening the review queue to be sure it
 * is empty (284 s on Falafel Fresh). A person does none of that. They wait for what appears, and
 * they wait for work in progress.
 *
 * So a step reports two numbers: the wall clock, and the walk's own waiting, taken off it:
 *  - `look`: a wait for something that may not be there. Found, the time is real (the screen a
 *    person waits for). Never found, the whole timeout was the walk's.
 *  - `pause`: a fixed wait nobody makes (a screenshot, a settle). All of it is the walk's.
 *  - `gaveUp`: a wait that ran out (a count that never moved): all of it is the walk's.
 * Work a person waits on (a sheet reading, a run) is not here at all: it stays on the clock.
 */
export class WalkClock {
  private walkMs = 0;

  /** Start a step. */
  reset(): void {
    this.walkMs = 0;
  }

  /** The walk's own waiting so far in this step, in ms. */
  get walk(): number {
    return this.walkMs;
  }

  async look(wait: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const found = await wait();
    if (!found) this.walkMs += timeoutMs;
    return found;
  }

  async pause(sleep: (ms: number) => Promise<void>, ms: number): Promise<void> {
    await sleep(ms);
    this.walkMs += ms;
  }

  gaveUp(timeoutMs: number): void {
    this.walkMs += timeoutMs;
  }

  /** A step's seconds as a person spends them: the wall clock less the walk's own waiting, never below 0. */
  personSeconds(wallMs: number): number {
    return Math.round(Math.max(0, wallMs - this.walkMs) / 100) / 10;
  }
}
