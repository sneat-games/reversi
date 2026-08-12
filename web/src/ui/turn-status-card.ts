// Turn-status card — CLASSIC mode's top-right slot (see game-kit's
// match-shell.ts 2x2 grid). Bidding mode's top-right slot is the kit's own
// bid panel; classic mode has no bid to show, only whose turn it is, what
// the player is expected to do, and — for vs-Friend — the self-enforced
// placement clock (game-kit/docs/DESIGN.md's PvP protocol v1). vs-Bot never
// needs the clock at all (nobody else is waiting), so `runClock` is simply
// never called there.

import { createCountdownBar, type CountdownBar } from "./countdown-bar";

export interface TurnClockOptions {
  ms: number;
  label: string;
  onExpire(): void;
}

export interface TurnStatusCard {
  el: HTMLElement;
  /** Replace the status line (no clock running). */
  setIdle(message: string): void;
  /** Whose move it is. `null` clears the line (match over, or nobody's). */
  setTurn(player: 0 | 1 | null, label?: string): void;
  /** Start (or replace) the countdown, replacing the status line with it. */
  runClock(opts: TurnClockOptions): void;
  stopClock(): void;
}

export function createTurnStatusCard(opts: { p1Label: string; p2Label: string }): TurnStatusCard {
  const el = document.createElement("section");
  el.className = "card turn-status";
  el.setAttribute("aria-label", "Turn status");
  el.setAttribute("data-turn-status", "");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "Turn";

  const status = document.createElement("p");
  status.className = "bid-panel__hint";
  status.setAttribute("data-turn-status-text", "");

  const countdown: CountdownBar = createCountdownBar();

  const turn = document.createElement("p");
  turn.className = "turn-status__turn";
  turn.setAttribute("data-turn-player", "");
  turn.hidden = true;

  el.append(title, status, countdown.el, turn);

  function stopClock() {
    countdown.stop();
  }

  function setIdle(message: string) {
    stopClock();
    status.hidden = false;
    status.textContent = message;
  }

  function setTurn(player: 0 | 1 | null, label?: string) {
    if (player === null) {
      turn.hidden = true;
      turn.textContent = "";
      return;
    }
    turn.hidden = false;
    turn.innerHTML = "";
    const who = document.createElement("span");
    who.className = `mark mark--p${player + 1}`;
    who.textContent = label ?? (player === 0 ? opts.p1Label : opts.p2Label);
    turn.append(document.createTextNode("To move: "), who);
  }

  function runClock(clockOpts: TurnClockOptions) {
    status.hidden = true;
    countdown.run(clockOpts);
  }

  setIdle("Loading…");

  return { el, setIdle, setTurn, runClock, stopClock };
}
