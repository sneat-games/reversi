// The countdown bar used by every self-enforced deadline outside the kit's
// own bid panel: classic mode's placement clock, the forced-pass clock, and
// bidding mode's free-move clock.
//
// The sub-DOM and CSS reuse the kit theme.css's `.bid-panel__clock*` classes
// verbatim — the countdown is exactly the visual language bid-panel.ts
// already uses, and a second copy of those rules under a new prefix would be
// pure drift risk for zero visual difference.

import { startCountdown, type Countdown } from "@sneat/game-kit";

export interface CountdownBarOptions {
  ms: number;
  label: string;
  onExpire(): void;
}

export interface CountdownBar {
  el: HTMLElement;
  run(opts: CountdownBarOptions): void;
  stop(): void;
}

export function createCountdownBar(): CountdownBar {
  const el = document.createElement("div");
  el.className = "bid-panel__clock";
  el.setAttribute("data-countdown", "");
  el.hidden = true;

  const head = document.createElement("div");
  head.className = "bid-panel__clock-head";
  const label = document.createElement("span");
  const secs = document.createElement("span");
  secs.className = "bid-panel__clock-secs";
  secs.setAttribute("data-countdown-secs", "");
  head.append(label, secs);

  const track = document.createElement("div");
  track.className = "bar-track bar-track--clock";
  const fill = document.createElement("div");
  fill.className = "bar-fill bar-fill--clock";
  track.append(fill);

  el.append(head, track);

  let clock: Countdown | null = null;

  function stop() {
    clock?.stop();
    clock = null;
    el.hidden = true;
    fill.style.width = "100%";
    el.classList.remove("bid-panel__clock--urgent");
  }

  function run(opts: CountdownBarOptions) {
    clock?.stop();
    el.hidden = false;
    label.textContent = opts.label;
    clock = startCountdown({
      ms: opts.ms,
      onTick(left) {
        secs.textContent = `${Math.ceil(left / 1000)}s`;
        fill.style.width = `${((left / opts.ms) * 100).toFixed(1)}%`;
        el.classList.toggle("bid-panel__clock--urgent", left <= 3_000);
      },
      onExpire() {
        clock = null;
        opts.onExpire();
      },
    });
  }

  return { el, run, stop };
}
