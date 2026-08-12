// BIDDING mode vs Bot. Every contested round both sides secretly commit
// {bid, cell} against the SAME position; the higher bid wins the round and
// places, the loser's cell is discarded, and the winner's bid is transferred
// to the loser (first-price transfer — total budget conserved all match).
//
// # The pass rule, which is where Reversi's bidding variant is special
//
// The auction runs ONLY when both players have a legal move. When exactly
// one player can move there is nothing to compete for, so that player moves
// FREE: no auction, no payment, and the UI says so. When neither can move
// the match ends. (game-kit/docs/DESIGN.md §Reversi; spec
// `web-game-rules#ac:bidding-one-sided-free-move`.) Discs decide the match —
// the budget is only the control economy.
//
// Mirrors bidding-tictactoe/web/src/ui/vs-bot.ts in pacing: the bot's bid is
// computed BEFORE the human is asked, so it is already "in" when the turn
// starts — the human always answers the longer VS_BOT_LATE_BID_MS clock and
// the 30s stall case can never arise here.

import {
  DARK,
  LIGHT,
  Outcome,
  applyMove,
  counts,
  isOver,
  mustPass,
  newGame,
  outcome,
  type Game,
  type Player,
} from "../engine/revplay";
import { isDecisive, pickBid, pickMove } from "../bot/bot";
import { createBoard, type BoardHandle } from "./board";
import { createDiscScoreCard, type DiscScoreCard } from "./score-card";
import { askBidMove, MoveAbortedError } from "./ask-bid-move";
import { askCell, MoveAbortedError as CellAbortedError } from "./ask-cell";
import { createFreeMoveNotice } from "./pass-banner";
import { renderMatchOver, resultFor } from "./match-over";
import { cellLabel, discCount } from "./rev-format";
import { recordVsBotResult } from "./standings";
import {
  createBalances,
  createBidPanel,
  createConfirmButton,
  createGameLog,
  createMatchShell,
  newAuction,
  resolveAuction,
  VS_BOT_LATE_BID_MS,
  type AuctionState,
  type Balances,
  type BidPanel,
  type GameLog,
  type MatchShell,
} from "@sneat/game-kit";

const HUMAN: Player = DARK;
const BOT: Player = LIGHT;
const BUDGET = 100;
/** How long the bot's unopposed free move sits on screen before it plays,
 *  so the "no auction this round" notice is readable rather than a flash. */
const FREE_MOVE_NOTICE_MS = 900;

export async function runVsBotBidding(root: HTMLElement): Promise<void> {
  const balances = createBalances({ initialBudget: BUDGET, p1Label: "You (dark)", p2Label: "Bot (light)" });
  const score = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
  const bidPanel = createBidPanel();
  const log = createGameLog();

  const topLeft = document.createElement("div");
  topLeft.className = "rev-topleft-stack";
  topLeft.append(balances.el, score.el);

  const shell = createMatchShell({ root, topLeft, topRight: bidPanel.el, log: log.el });

  let restart = new AbortController();
  const newGameBtn = createConfirmButton({
    label: "New game",
    confirmLabel: "Restart — click again",
    onConfirm: () => restart.abort(),
  });
  shell.actions.append(newGameBtn.el);

  // Torn down and recreated only when a NEW match is about to start — not
  // the instant the current one ends, or the final dim-and-sweep would
  // vanish before the banner appears (APP-PLAYBOOK gotcha 4).
  let board = createBoard(shell.boardSlot);

  for (;;) {
    restart = new AbortController();
    newGameBtn.disarm();

    const finished = await playMatch(shell, board, bidPanel, balances, score, log, restart.signal);
    if (finished === null) {
      board.destroy();
      shell.reset();
      log.clear();
      balances.update([BUDGET, BUDGET]);
      score.update([2, 2]);
      board = createBoard(shell.boardSlot);
      continue;
    }

    recordVsBotResult(resultFor(finished.outcome, HUMAN));
    shell.actions.hidden = true;
    const again = await renderFinal(shell, finished);
    board.destroy();
    if (!again) return;
    shell.reset();
    log.clear();
    balances.update([BUDGET, BUDGET]);
    score.update([2, 2]);
    board = createBoard(shell.boardSlot);
  }
}

interface FinishedMatch {
  outcome: Outcome;
  counts: readonly [number, number];
  budgets: readonly [number, number];
}

async function playMatch(
  shell: MatchShell,
  board: BoardHandle,
  bidPanel: BidPanel,
  balances: Balances,
  score: DiscScoreCard,
  log: GameLog,
  signal: AbortSignal,
): Promise<FinishedMatch | null> {
  let game: Game = newGame();
  let auction: AuctionState = newAuction(BUDGET);
  let lastMove: number | null = null;
  let flipped: readonly number[] = [];

  for (let turn = 0; ; turn++) {
    score.update(counts(game));

    if (isOver(game)) {
      board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false, over: true });
      bidPanel.setWaiting("Match over.");
      return { outcome: outcome(game), counts: counts(game), budgets: auction.budgets };
    }

    const humanCan = !mustPass(game, HUMAN);
    const botCan = !mustPass(game, BOT);

    // --- one-sided round: the only player with a move plays for free ------
    if (!humanCan || !botCan) {
      const mover: Player = humanCan ? HUMAN : BOT;
      const notice =
        mover === HUMAN
          ? "Free move — the bot has no legal move, so no auction runs and nothing is paid."
          : "Free move — you have no legal move, so the bot plays unopposed. No auction, nothing paid.";
      shell.setNote([createFreeMoveNotice(notice).el]);

      let cell: number;
      if (mover === HUMAN) {
        bidPanel.setWaiting("No auction this round — the bot cannot move. Play any highlighted cell.");
        try {
          cell = await askCell({ board, game, mover: HUMAN, lastMove, flipped, abort: signal });
        } catch (e) {
          if (e instanceof CellAbortedError) return null;
          throw e;
        }
      } else {
        bidPanel.setWaiting("No auction this round — you have no legal move. The bot plays unopposed.");
        board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });
        await delay(FREE_MOVE_NOTICE_MS);
        cell = pickMove(game, BOT);
      }

      const applied = applyMove(game, mover, cell);
      game = applied.game;
      lastMove = cell;
      flipped = applied.flipped;
      log.append({
        turn,
        head: `${mover === HUMAN ? "You" : "Bot"} played ${cellLabel(cell)} free — flipped ${discCount(applied.flipped.length)}`,
      });
      continue;
    }

    // --- contested round: run the auction ---------------------------------
    const botBid = pickBid({
      budgetRemaining: auction.budgets[BOT],
      opponentBudget: auction.budgets[HUMAN],
      decisive: isDecisive(game, BOT),
    });
    const botCell = pickMove(game, BOT);

    let humanMove;
    try {
      humanMove = await askBidMove({
        board,
        bidPanel,
        game,
        mover: HUMAN,
        lastMove,
        flipped,
        ownBalance: auction.budgets[HUMAN],
        opponentBalance: auction.budgets[BOT],
        opponentBidIn: true,
        lateBidMs: VS_BOT_LATE_BID_MS,
        abort: signal,
      });
    } catch (e) {
      if (e instanceof MoveAbortedError) return null;
      throw e;
    }

    const bids: [number, number] = [humanMove.bid, botBid];
    const budgetsBefore = auction.budgets;
    const { winner: auctionWinner, tieBreak, next } = resolveAuction(auction, bids);
    auction = next;
    balances.update(auction.budgets);

    // Both sides committed against the identical position, so the winner's
    // committed cell is still legal at resolution time — the property the
    // whole variant rests on (docs/DESIGN.md §Reversi).
    const winningCell = auctionWinner === HUMAN ? humanMove.cell : botCell;
    const applied = applyMove(game, auctionWinner, winningCell);
    game = applied.game;
    lastMove = winningCell;
    flipped = applied.flipped;

    log.append({
      turn,
      head: `${auctionWinner === HUMAN ? "You" : "Bot"} played ${cellLabel(winningCell)} — flipped ${discCount(applied.flipped.length)}`,
      tie: tieBreak,
      rows: [
        bidRow("You", humanMove.bid, budgetsBefore[HUMAN], 0, auctionWinner === 0),
        bidRow("Bot", botBid, budgetsBefore[BOT], 1, auctionWinner === 1),
      ],
    });
  }
}

function bidRow(label: string, bid: number, budgetBefore: number, player: 0 | 1, won: boolean) {
  return {
    label,
    value: String(bid),
    fraction: budgetBefore > 0 ? bid / budgetBefore : 0,
    player,
    won,
  };
}

function renderFinal(shell: MatchShell, finished: FinishedMatch): Promise<boolean> {
  const banner = renderMatchOver({
    outcome: finished.outcome,
    you: HUMAN,
    youLabel: "You",
    themLabel: "Bot",
    counts: finished.counts,
    budgets: finished.budgets,
    initialBudget: BUDGET,
  });

  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn--primary";
  again.textContent = "Rematch";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Back to menu";

  shell.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
