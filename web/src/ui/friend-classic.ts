// CLASSIC mode vs Friend — the per-match turn loop. The connection itself
// (room reserve/join, WebRTC handshake, the `hello`/`hello-ack` config
// negotiation) lives in vs-friend.ts, which calls in here once a `PeerHandle`
// is open and both sides agree on `{mode: "classic", size: 8}`.
//
// Moves are NOT hidden in classic mode — `{ kind: "move", turn, move }`
// where `move` is a cell index, or `{ pass: true }` for a forced pass — so
// there is no commit-reveal here, only game-kit's turn-inbox for
// "listen before you wait" delivery ordering.
//
// A PASS is sent explicitly even though both clients could derive it from
// the shared position: it keeps the two message streams turn-for-turn
// aligned, and it gives the waiting player a real moment where the board
// says "your friend has no legal move" instead of the turn appearing to
// bounce back for no reason.
//
// Every self-enforced clock terminates on ITS OWN side regardless of the
// peer's state, so a vanished opponent is only ever detected while THIS
// client is waiting on THEM.

import {
  DARK,
  LIGHT,
  Outcome,
  applyMove,
  computeFlips,
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
import { askCell } from "./ask-cell";
import { askPass, renderPassNotice } from "./pass-banner";
import { renderMatchOver } from "./match-over";
import { cellLabel, discCount } from "./rev-format";
import {
  PeerGoneError,
  isPassMove,
  negotiateRematch,
  orPeerGone,
  renderAbandoned,
  renderFinalFriend,
  trySend,
} from "./friend-common";
import {
  createGameLog,
  createMatchShell,
  openTurnInbox,
  STALL_MS,
  type GameLog,
  type MatchShell,
  type PeerHandle,
} from "@sneat/game-kit";

export async function runFriendClassicMatch(root: HTMLElement, peer: PeerHandle): Promise<void> {
  // Host is player 0 (Dark, moves first); guest is player 1 (Light).
  const me: Player = peer.role === "host" ? DARK : LIGHT;

  const score = createDiscScoreCard({
    p1Label: me === DARK ? "You (dark)" : "Friend (dark)",
    p2Label: me === LIGHT ? "You (light)" : "Friend (light)",
  });
  const status = createTurnStatusCard({
    p1Label: me === DARK ? "You" : "Friend",
    p2Label: me === LIGHT ? "You" : "Friend",
  });
  const log = createGameLog();
  const shell = createMatchShell({ root, topLeft: score.el, topRight: status.el, log: log.el });

  // Torn down and recreated only when a NEW match is about to start (see
  // game-kit/docs/APP-PLAYBOOK.md gotcha 4).
  let board = createBoard(shell.boardSlot);

  for (;;) {
    let finished: { outcome: Outcome; counts: readonly [number, number] };
    try {
      finished = await playMatch(shell, board, score, status, log, peer, me);
    } catch (e) {
      board.destroy();
      if (e instanceof PeerGoneError) {
        await renderAbandoned(shell, e.message);
        return;
      }
      throw e;
    }

    const banner = renderMatchOver({
      outcome: finished.outcome,
      you: me,
      youLabel: "You",
      themLabel: "Friend",
      counts: finished.counts,
    });
    const again = await renderFinalFriend(shell, banner);
    board.destroy();
    if (!again) {
      trySend(peer, { kind: "leave" });
      return;
    }
    const accepted = await negotiateRematch(peer);
    if (!accepted) {
      await renderAbandoned(shell, "Your friend left the room.");
      return;
    }
    shell.reset();
    log.clear();
    score.update([2, 2]);
    board = createBoard(shell.boardSlot);
  }
}

async function playMatch(
  shell: MatchShell,
  board: BoardHandle,
  score: DiscScoreCard,
  status: TurnStatusCard,
  log: GameLog,
  peer: PeerHandle,
  me: Player,
): Promise<{ outcome: Outcome; counts: readonly [number, number] }> {
  let game: Game = newGame();
  let mover: Player = DARK;
  let lastMove: number | null = null;
  let flipped: readonly number[] = [];

  for (let turn = 0; ; turn++) {
    score.update(counts(game));

    if (isOver(game)) {
      board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false, over: true });
      status.setTurn(null);
      status.setIdle("Match over.");
      return { outcome: outcome(game), counts: counts(game) };
    }

    status.setTurn(mover, mover === me ? "You" : "Friend");

    if (mustPass(game, mover)) {
      await runPassTurn(shell, board, status, log, peer, game, turn, mover, me, lastMove, flipped);
      mover = otherPlayer(mover);
      continue;
    }

    const cell: number =
      mover === me
        ? await takeMyTurn(board, status, log, peer, game, turn, me, lastMove, flipped)
        : await takeTheirTurn(board, status, log, peer, game, turn, mover, lastMove, flipped);

    const applied = applyMove(game, mover, cell);
    game = applied.game;
    lastMove = cell;
    flipped = applied.flipped;
    mover = otherPlayer(mover);
  }
}

async function runPassTurn(
  shell: MatchShell,
  board: BoardHandle,
  status: TurnStatusCard,
  log: GameLog,
  peer: PeerHandle,
  game: Game,
  turn: number,
  mover: Player,
  me: Player,
  lastMove: number | null,
  flipped: readonly number[],
): Promise<void> {
  board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });

  if (mover === me) {
    status.setIdle("You have no legal move.");
    await askPass({
      container: shell.controls,
      headline: "You must pass",
      detail: "No legal move is available to you, so the turn goes back to your friend.",
      lockScope: shell.el,
      clock: {
        start: (expire) => status.runClock({ ms: STALL_MS, label: "Passing automatically in", onExpire: expire }),
        stop: () => status.stopClock(),
      },
    });
    trySend(peer, { kind: "move", turn, move: { pass: true } });
    log.append({ turn, head: "You had no legal move — passed" });
    return;
  }

  status.setIdle("Waiting for your friend…");
  shell.setNote([
    renderPassNotice({
      headline: "No legal moves — your friend passes",
      detail: "They cannot flip anything from this position, so you move again.",
    }),
  ]);

  // Listen before waiting — see game-kit's turn-inbox.ts doc comment.
  const inbox = openTurnInbox(peer, turn);
  try {
    const msg = await orPeerGone(inbox, inbox.move(0), "Your friend stopped responding.");
    if (!isPassMove(msg.move)) {
      throw new PeerGoneError("Your friend sent a move where a pass was the only legal option.");
    }
  } finally {
    inbox.close();
  }
  log.append({ turn, head: "Friend had no legal move — passed" });
}

async function takeMyTurn(
  board: BoardHandle,
  status: TurnStatusCard,
  log: GameLog,
  peer: PeerHandle,
  game: Game,
  turn: number,
  me: Player,
  lastMove: number | null,
  flipped: readonly number[],
): Promise<number> {
  status.setIdle("Your turn — click a highlighted cell.");
  const cell = await askCell({
    board,
    game,
    mover: me,
    lastMove,
    flipped,
    clock: {
      start: (expire) => status.runClock({ ms: STALL_MS, label: "Placement closes in", onExpire: expire }),
      stop: () => status.stopClock(),
      // Self-enforced: this client only ever auto-plays its OWN move, so a
      // timeout can never leave the two boards disagreeing.
      autoCell: () => pickMove(game, me),
    },
  });
  log.append({
    turn,
    head: `You played ${cellLabel(cell)} — flipped ${discCount(computeFlips(game.board, cell, me).length)}`,
  });
  trySend(peer, { kind: "move", turn, move: cell });
  return cell;
}

async function takeTheirTurn(
  board: BoardHandle,
  status: TurnStatusCard,
  log: GameLog,
  peer: PeerHandle,
  game: Game,
  turn: number,
  mover: Player,
  lastMove: number | null,
  flipped: readonly number[],
): Promise<number> {
  status.setIdle("Waiting for your friend…");
  board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });

  const inbox = openTurnInbox(peer, turn);
  let move: unknown;
  try {
    const msg = await orPeerGone(inbox, inbox.move(0), "Your friend stopped responding.");
    move = msg.move;
  } finally {
    inbox.close();
  }

  if (typeof move !== "number" || !Number.isInteger(move)) {
    throw new PeerGoneError("Received an invalid move from your friend.");
  }
  // Legality is checked against OUR board — a move the local engine rejects
  // means the two positions have diverged, which is unrecoverable by
  // definition.
  let flippedCount: number;
  try {
    flippedCount = applyMove(game, mover, move).flipped.length;
  } catch {
    throw new PeerGoneError("Received an illegal move from your friend.");
  }
  log.append({ turn, head: `Friend played ${cellLabel(move)} — flipped ${discCount(flippedCount)}` });
  return move;
}
