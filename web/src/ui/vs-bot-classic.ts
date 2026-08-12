// CLASSIC mode vs Bot. The human is always Dark (player 0) and therefore
// always moves first, as in standard Othello; the bot is Light (player 1).
//
// The only structural difference from every other kit game's classic loop is
// the PASS: Reversi does not alternate unconditionally. Before each move the
// loop asks the engine whether the side to move has any legal move at all
// and, if not, passes — loudly (see pass-banner.ts), because a silently
// skipped turn reads as a bug. Two passes in a row, or a full board, end the
// match (`isOver`), and the disc count decides it, draws included.
//
// A short "thinking" pause keeps the bot's move legible instead of feeling
// instantaneous; it is not a fairness mechanism (unlike the self-enforced
// clocks used in PvP), so no test asserts its exact length.

import {
  DARK,
  LIGHT,
  Outcome,
  applyMove,
  counts,
  isOver,
  mustPass,
  newGame,
  otherPlayer,
  outcome,
  type Game,
  type Player,
} from "../engine/revplay";
import { pickMove } from "../bot/bot";
import { createBoard, type BoardHandle } from "./board";
import { createDiscScoreCard, type DiscScoreCard } from "./score-card";
import { createTurnStatusCard, type TurnStatusCard } from "./turn-status-card";
import { askCell, MoveAbortedError } from "./ask-cell";
import { askPass, renderPassNotice } from "./pass-banner";
import { renderMatchOver, resultFor } from "./match-over";
import { cellLabel, discCount } from "./rev-format";
import { recordVsBotResult } from "./standings";
import { createConfirmButton, createGameLog, createMatchShell, type GameLog, type MatchShell } from "@sneat/game-kit";

const HUMAN: Player = DARK;
const BOT: Player = LIGHT;
const THINK_MS = 420;
/** How long the bot's forced pass stays on screen before play resumes. */
const PASS_NOTICE_MS = 1_100;

export async function runVsBotClassic(root: HTMLElement): Promise<void> {
  const score = createDiscScoreCard({ p1Label: "You (dark)", p2Label: "Bot (light)" });
  const status = createTurnStatusCard({ p1Label: "You", p2Label: "Bot" });
  const log = createGameLog();
  const shell = createMatchShell({ root, topLeft: score.el, topRight: status.el, log: log.el });

  let restart = new AbortController();
  const newGameBtn = createConfirmButton({
    label: "New game",
    confirmLabel: "Restart — click again",
    onConfirm: () => restart.abort(),
  });
  shell.actions.append(newGameBtn.el);

  // The board is torn down and recreated only when a NEW match is about to
  // start — never the instant the current one ends, or the final position's
  // dim-and-sweep would vanish before the result banner even appears
  // (game-kit/docs/APP-PLAYBOOK.md gotcha 4).
  let board = createBoard(shell.boardSlot);

  for (;;) {
    restart = new AbortController();
    newGameBtn.disarm();

    const finished = await playMatch(shell, board, score, status, log, restart.signal);
    if (finished === null) {
      board.destroy();
      shell.reset();
      log.clear();
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
    score.update([2, 2]);
    board = createBoard(shell.boardSlot);
  }
}

interface FinishedMatch {
  outcome: Outcome;
  counts: readonly [number, number];
}

async function playMatch(
  shell: MatchShell,
  board: BoardHandle,
  score: DiscScoreCard,
  status: TurnStatusCard,
  log: GameLog,
  signal: AbortSignal,
): Promise<FinishedMatch | null> {
  let game: Game = newGame();
  let mover: Player = DARK;
  let lastMove: number | null = null;
  let flipped: readonly number[] = [];
  let turn = 0;

  for (;;) {
    score.update(counts(game));

    if (isOver(game)) {
      board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false, over: true });
      status.setTurn(null);
      status.setIdle("Match over.");
      return { outcome: outcome(game), counts: counts(game) };
    }

    status.setTurn(mover, mover === HUMAN ? "You" : "Bot");

    if (mustPass(game, mover)) {
      board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });
      if (mover === HUMAN) {
        status.setIdle("You have no legal move.");
        log.append({ turn, head: "You had no legal move — passed" });
        await askPass({
          container: shell.controls,
          headline: "You must pass",
          detail: "No legal move is available to you, so the turn goes back to the bot.",
          lockScope: shell.el,
        });
      } else {
        status.setIdle("Bot has no legal move.");
        log.append({ turn, head: "Bot had no legal move — passed" });
        shell.setNote([
          renderPassNotice({
            headline: "No legal moves — Bot passes",
            detail: "The bot cannot flip anything from this position, so you move again.",
          }),
        ]);
        await delay(PASS_NOTICE_MS);
      }
      mover = otherPlayer(mover);
      turn++;
      continue;
    }

    let cell: number;
    if (mover === HUMAN) {
      status.setIdle("Your turn — click a highlighted cell.");
      try {
        cell = await askCell({ board, game, mover: HUMAN, lastMove, flipped, abort: signal });
      } catch (e) {
        if (e instanceof MoveAbortedError) return null;
        throw e;
      }
    } else {
      status.setIdle("Bot is thinking…");
      board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });
      await delay(THINK_MS);
      cell = pickMove(game, BOT);
    }

    const applied = applyMove(game, mover, cell);
    game = applied.game;
    lastMove = cell;
    flipped = applied.flipped;
    log.append({
      turn,
      head: `${mover === HUMAN ? "You" : "Bot"} played ${cellLabel(cell)} — flipped ${discCount(applied.flipped.length)}`,
    });

    mover = otherPlayer(mover);
    turn++;
  }
}

function renderFinal(shell: MatchShell, finished: FinishedMatch): Promise<boolean> {
  const banner = renderMatchOver({
    outcome: finished.outcome,
    you: HUMAN,
    youLabel: "You",
    themLabel: "Bot",
    counts: finished.counts,
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
