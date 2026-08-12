// The pass announcement.
//
// A pass is the one Reversi rule a new player never sees coming: you did
// nothing wrong, the board simply offers you no legal move, and the turn
// goes back to your opponent. Handled quietly it reads as a broken game
// ("why did the bot move twice?"), so it is deliberately the loudest thing
// on the screen when it happens:
//
//   - The OPPONENT passing is announced (`renderPassNotice`) and the match
//     carries on by itself.
//   - The LOCAL player passing (`askPass`) requires an explicit click on a
//     Pass button which, while it is up, is the only enabled control in the
//     match area — there is genuinely nothing else to do, and a dead-looking
//     board with no explanation is exactly the confusion this avoids. (The
//     site header's theme/standings buttons stay live: they are page chrome,
//     not moves.)
//
// In vs-Friend the pass runs under the same self-enforced clock as any other
// move, so an idle player cannot stall the match: the clock passes for them,
// on their own client, exactly as if they had clicked.

import { createCountdownBar, type CountdownBar } from "./countdown-bar";

export interface PassNoticeOptions {
  headline: string;
  detail?: string;
  /** Adds the attention pulse used when nobody has to click anything. */
  pulse?: boolean;
}

/** The announcement on its own — used when the OPPONENT has to pass. */
export function renderPassNotice(opts: PassNoticeOptions): HTMLElement {
  const el = document.createElement("div");
  el.className = `rev-pass${opts.pulse === false ? "" : " rev-pass--auto"}`;
  el.setAttribute("data-pass-notice", "");
  el.setAttribute("role", "status");

  const headline = document.createElement("p");
  headline.className = "rev-pass__headline";
  headline.textContent = opts.headline;
  el.append(headline);

  if (opts.detail) {
    const detail = document.createElement("p");
    detail.className = "rev-pass__detail";
    detail.textContent = opts.detail;
    el.append(detail);
  }
  return el;
}

export interface FreeMoveNotice {
  el: HTMLElement;
  /** Only used in vs-Friend, where the free mover is on a self-enforced
   *  clock like any other turn. vs-Bot leaves it untouched. */
  clock: CountdownBar;
}

/**
 * BIDDING mode's sibling of the pass notice: exactly one player has a legal
 * move, so there is nothing to auction and that player simply plays, free
 * (game-kit/docs/DESIGN.md §Reversi). Stating it is not decoration — a round
 * where no bid is taken and no coin changes hands would otherwise look like
 * the auction silently broke.
 */
export function createFreeMoveNotice(text: string): FreeMoveNotice {
  const el = document.createElement("div");
  el.className = "rev-free-move";
  el.setAttribute("data-free-move", "");
  el.setAttribute("role", "status");

  const line = document.createElement("p");
  line.className = "rev-free-move__text";
  line.textContent = text;

  const clock = createCountdownBar();
  el.append(line, clock.el);
  return { el, clock };
}

export interface AskPassOptions {
  /** Where the banner mounts — the match shell's controls slot. */
  container: HTMLElement;
  headline: string;
  detail?: string;
  /** Everything inside this element is disabled while the banner is up. */
  lockScope?: HTMLElement;
  /** Self-enforced countdown that passes for the player (vs-Friend only).
   *  Same transport-neutral shape as ask-cell.ts's clock: start it with an
   *  expiry callback, stop it when the turn resolves any other way. */
  clock?: { start(expire: () => void): void; stop(): void };
}

/**
 * Show the local player's forced pass and resolve once they acknowledge it
 * (or the self-enforced clock does it for them). Always cleans up after
 * itself: the banner is removed and every control it disabled is restored,
 * whichever way it resolves.
 */
export function askPass(opts: AskPassOptions): Promise<void> {
  const el = renderPassNotice({ headline: opts.headline, detail: opts.detail, pulse: false });
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-live", "assertive");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--primary rev-pass__button";
  button.textContent = "Pass";
  button.setAttribute("data-pass-button", "");
  el.append(button);

  opts.container.append(el);

  const restore = lockOthers(opts.lockScope, button);
  button.focus();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      opts.clock?.stop();
      restore();
      el.remove();
      resolve();
    };
    button.addEventListener("click", finish);
    opts.clock?.start(finish);
  });
}

/**
 * Disable every control inside `scope` except `keep`, returning the undo.
 * Controls already disabled before the lock stay disabled afterwards — the
 * restore puts back what was there, it does not blanket-enable.
 */
function lockOthers(scope: HTMLElement | undefined, keep: HTMLElement): () => void {
  if (!scope) return () => {};
  const controls = Array.from(
    scope.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input, select, textarea"),
  ).filter((c) => c !== keep);
  const previous = controls.map((c) => c.disabled);
  for (const c of controls) c.disabled = true;
  return () => {
    controls.forEach((c, i) => {
      c.disabled = previous[i];
    });
  };
}
