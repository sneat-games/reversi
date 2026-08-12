// Asking the local player to place a disc: the shared plumbing behind
// CLASSIC mode's board-click flow (and behind BIDDING mode's free moves,
// where exactly one player has a legal move and no auction runs). Bidding's
// contested rounds use ask-bid-move.ts instead — a bid to dial in as well as
// a cell to click.
//
// The optional clock is the vs-Friend self-enforced placement deadline (see
// game-kit/docs/DESIGN.md's PvP protocol v1): each client only ever
// auto-plays its OWN move, so a timeout can never leave the two boards
// disagreeing. vs-Bot passes an abort signal instead — the "New game" button.

import { type Game, type Player } from "../engine/revplay";
import { type BoardHandle } from "./board";

/** Thrown when a turn is interrupted — currently only by "New game". */
export class MoveAbortedError extends Error {
  constructor() {
    super("askCell: the turn was aborted");
    this.name = "MoveAbortedError";
  }
}

/**
 * The clock as this module needs it: something that can be started with an
 * expiry callback and stopped. Deliberately NOT typed to a particular card —
 * classic mode drives the turn-status card's countdown, while bidding mode's
 * free-move rounds drive the one inside the free-move notice, and neither
 * should have to know about the other.
 */
export interface AskCellClock {
  start(expire: () => void): void;
  stop(): void;
  /** The cell played on the player's behalf if the clock expires. */
  autoCell(): number;
}

export interface AskCellOptions {
  board: BoardHandle;
  game: Game;
  mover: Player;
  lastMove?: number | null;
  flipped?: readonly number[];
  /** Abandon the wait — rejects with MoveAbortedError. vs-Bot only. */
  abort?: AbortSignal;
  /** Self-enforced countdown — vs-Friend only. */
  clock?: AskCellClock;
}

/** Resolve with the cell the local player picked — by click/Enter, or by an
 *  expiring clock playing on their behalf. */
export function askCell(opts: AskCellOptions): Promise<number> {
  const { board, game, mover, lastMove = null, flipped = [], abort, clock } = opts;

  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      abort?.removeEventListener("abort", onAbort);
      clock?.stop();
    };
    const finish = (cell: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(cell);
    };
    function onAbort() {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new MoveAbortedError());
    }

    board.render({ game, mover, hintFor: mover, lastMove, flipped, interactive: true, onSelect: finish });

    if (abort?.aborted) {
      onAbort();
      return;
    }
    abort?.addEventListener("abort", onAbort, { once: true });

    clock?.start(() => finish(clock.autoCell()));
  });
}
