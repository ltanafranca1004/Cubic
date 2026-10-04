import { canSkip, cardDelay, endingClock } from './timeline';

// THE ENDING'S RUN: when the sequence started on this client, and whether it was skipped.
// The one piece of state behind the ending; the scene (./EndingScene.ts) and the title card
// (ui/cubicUI.ts) both read it, so they cannot disagree. No DOM, no Phaser.
//
// IN SYNC: the run starts on the server's `win` event (app.ts calls `won`), which both
// clients get in the same broadcast, and the timeline is a pure function of the time since
// then. The local state can say "won" a moment earlier (the mover predicts its own move):
// that only arms the run, it does not start it. A game that is found already won (a reload,
// a seat taken back after the win) has no event to start from: it goes straight to the card.

/** How long a won game waits for the server's win event before the sequence starts anyway. */
export const WIN_EVENT_WAIT_MS = 1000;

export interface EndingRun {
  /** Counts runs: a new game's ending is a new run. */
  id: number;
  /** When it started, on the caller's clock (performance.now()). */
  t0: number;
  /** The time since `t0` at which the player skipped to the card, or null. */
  skippedAt: number | null;
}

type Timer = ReturnType<typeof setTimeout>;

export class Ending {
  private run: EndingRun | null = null;
  private runs = 0;
  /** We watched this game being played: its win is worth the whole sequence. */
  private live = false;
  private waiting: Timer | null = null;
  private cardTimer: Timer | null = null;
  private shown = false;
  private listeners: (() => void)[] = [];

  constructor(private now: () => number = () => performance.now()) {}

  /** The run under way, or null. */
  get current(): EndingRun | null {
    return this.run;
  }

  /** The title card is up. */
  get card(): boolean {
    return this.shown;
  }

  /** Milliseconds since the run started, or null. */
  elapsed(): number | null {
    return this.run ? this.now() - this.run.t0 : null;
  }

  /** The time on the timeline (./timeline.ts endingFrame), or null when no ending is playing. */
  time(): number | null {
    return this.run ? endingClock(this.now() - this.run.t0, this.run.skippedAt) : null;
  }

  /** Called on every change of the card or the run. Returns the way to stop. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * What the game says now: `true` won, `false` being played, `null` not in a game.
   * `reduceMotion` is the setting: with it the card is there at once.
   */
  sync(won: boolean | null, reduceMotion = false): void {
    if (!won) {
      this.live = won === false;
      if (this.run || this.waiting) this.stop();
      return;
    }
    if (this.run) {
      if (reduceMotion && !this.shown) this.show();
      return;
    }
    if (!this.live) this.start(reduceMotion, true);
    else this.waiting ??= setTimeout(() => this.start(reduceMotion, false), WIN_EVENT_WAIT_MS);
  }

  /** The server's win event arrived: the sequence starts now, for both players. */
  won(reduceMotion = false): void {
    if (this.run) return;
    this.start(reduceMotion, false);
  }

  /** A key or a tap. True if it skipped to the card. */
  skip(): boolean {
    const run = this.run;
    if (!run || this.shown || run.skippedAt !== null) return false;
    const elapsed = this.now() - run.t0;
    if (!canSkip(elapsed)) return false;
    run.skippedAt = elapsed;
    this.show();
    return true;
  }

  /** Dev tools: play the sequence again from its start. */
  replay(reduceMotion = false): void {
    if (this.run) this.start(reduceMotion, false);
  }

  private start(reduceMotion: boolean, late: boolean): void {
    this.clear();
    // a game found already won starts at the card: as if skipped at the very start
    this.run = { id: ++this.runs, t0: this.now(), skippedAt: late ? 0 : null };
    const wait = cardDelay(0, this.run.skippedAt, reduceMotion);
    this.shown = wait <= 0;
    if (!this.shown) this.cardTimer = setTimeout(() => this.show(), wait);
    this.tell();
  }

  private show(): void {
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.cardTimer = null;
    if (this.shown) return;
    this.shown = true;
    this.tell();
  }

  private clear(): void {
    if (this.waiting) clearTimeout(this.waiting);
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.waiting = this.cardTimer = null;
  }

  private stop(): void {
    this.clear();
    this.run = null;
    this.shown = false;
    this.tell();
  }

  private tell(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

/** The app's one ending. */
export const ending = new Ending();
