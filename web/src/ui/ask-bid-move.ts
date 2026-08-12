// Asking the local player for a BIDDING-mode move: a bid (dialled into the
// bid panel) plus a cell (committed by clicking the board) — one gesture,
// exactly like bidding-tictactoe/web/src/ui/ask-move.ts, which this mirrors.
// The clock rules are identical to BTTT's:
//
//   - Opponent's bid already in  -> LATE_BID_MS, auto-bid LATE_BID_DEFAULT.
//   - Nobody has bid yet         -> STALL_MS, auto-bid stallBid(...).
//     A late-arriving opponent bid replaces the stall clock with the
//     shorter answer clock.
//
// vs-Bot passes `opponentBidIn: true` (the bot's hidden bid is computed
// before the human is asked — see vs-bot-bidding.ts) with the longer
// VS_BOT_LATE_BID_MS, so the human is never rushed by the shorter PvP clock.
//
// This is only ever called on a CONTESTED round — one where both players
// have a legal move. When only one side can move it moves for free (no
// auction, no payment, game-kit/docs/DESIGN.md §Reversi) and the session
// calls askCell instead.

import { type Game, type Player } from "../engine/revplay";
import { pickMove } from "../bot/bot";
import { type BoardHandle } from "./board";
import { LATE_BID_DEFAULT, LATE_BID_MS, STALL_MS, stallBid, type BidPanel } from "@sneat/game-kit";

/** Thrown when a turn is interrupted — currently only by "New game". */
export class MoveAbortedError extends Error {
  constructor() {
    super("askBidMove: the turn was aborted");
    this.name = "MoveAbortedError";
  }
}

export interface ReversiBidMove {
  bid: number;
  cell: number;
}

export interface AskBidMoveOptions {
  board: BoardHandle;
  bidPanel: BidPanel;
  game: Game;
  mover: Player;
  lastMove?: number | null;
  flipped?: readonly number[];
  ownBalance: number;
  opponentBalance: number;
  /** True when the opponent's bid is already in as this turn starts. */
  opponentBidIn: boolean;
  /** Subscribe to the opponent's bid landing mid-turn (vs-Friend only). */
  onOpponentBid?(fn: () => void): () => void;
  /** Abandon the turn — rejects with MoveAbortedError. vs-Bot only. */
  abort?: AbortSignal;
  /** Answer window once the opponent's bid is in. Defaults to the PvP
   *  LATE_BID_MS; vs-Bot passes the longer VS_BOT_LATE_BID_MS. */
  lateBidMs?: number;
}

export function askBidMove(opts: AskBidMoveOptions): Promise<ReversiBidMove> {
  const { board, bidPanel, game, mover, lastMove = null, flipped = [], ownBalance, opponentBalance } = opts;

  bidPanel.beginTurn({ max: ownBalance, initial: Math.floor(ownBalance / 2) });

  // Where an auto-submitted move plays if the clock expires — computed once
  // from the board as it stands at the start of the turn. Safe by
  // construction: this function is only called on a contested round, so
  // `mover` provably has at least one legal move for pickMove to return.
  const autoCell = pickMove(game, mover);

  return new Promise<ReversiBidMove>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const settle = (run: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      opts.abort?.removeEventListener("abort", onAbort);
      bidPanel.stopClock();
      run();
    };
    const finish = (move: ReversiBidMove) => settle(() => resolve(move));
    function onAbort() {
      settle(() => reject(new MoveAbortedError()));
    }

    if (opts.abort?.aborted) {
      onAbort();
      return;
    }
    opts.abort?.addEventListener("abort", onAbort, { once: true });

    const runLateBidClock = () => {
      if (settled) return;
      bidPanel.runClock({
        ms: opts.lateBidMs ?? LATE_BID_MS,
        label: "Opponent has bid — answer within",
        autoBid: LATE_BID_DEFAULT,
        onExpire: () => finish({ bid: LATE_BID_DEFAULT, cell: autoCell }),
      });
    };

    if (opts.opponentBidIn) {
      runLateBidClock();
    } else {
      const auto = stallBid(ownBalance, opponentBalance);
      bidPanel.runClock({
        ms: STALL_MS,
        label: "Bid within",
        autoBid: auto,
        onExpire: () => finish({ bid: auto, cell: autoCell }),
      });
      unsubscribe = opts.onOpponentBid?.(runLateBidClock);
    }

    board.render({
      game,
      mover,
      hintFor: mover,
      lastMove,
      flipped,
      interactive: true,
      onSelect: (cell) => finish({ bid: bidPanel.value(), cell }),
    });
  });
}
