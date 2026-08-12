// BIDDING mode vs Friend. Contested rounds exchange hidden-bid moves using
// game-kit's commit-reveal primitives on the 2x2 match screen (balances +
// disc count on the left, bid panel on the right, board + game log below),
// round by round until the board is settled.
//
// The commit hides BOTH the bid and the cell — `commitPayload([bid, cell],
// salt)` — matching game-kit/docs/DESIGN.md's PvP protocol v1 ("move fully
// hidden until reveal"), an improvement over bidding-tictactoe's protocol,
// which exposes the target cell in cleartext at commit time.
//
// # One-sided rounds carry no auction at all
//
// The auction runs only when BOTH players have a legal move. When exactly
// one player can move, that player moves FREE — a plain `move` message, no
// commit, no reveal, no transfer (docs/DESIGN.md §Reversi; spec
// `web-game-rules#ac:bidding-one-sided-free-move`). Both clients derive
// which case a round is from the SAME board position, so they always agree
// on which protocol that round follows without negotiating it.
//
// Turn clocks are self-enforced: each client only ever auto-submits its OWN
// move, so a deadline can never leave the two boards disagreeing. A silent
// peer abandons the match rather than being resolved by guesswork.

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
import { pickMove } from "../bot/bot";
import { createBoard, type BoardHandle } from "./board";
import { createDiscScoreCard, type DiscScoreCard } from "./score-card";
import { askBidMove, type ReversiBidMove } from "./ask-bid-move";
import { askCell } from "./ask-cell";
import { createFreeMoveNotice } from "./pass-banner";
import { renderMatchOver } from "./match-over";
import { cellLabel, discCount } from "./rev-format";
import {
  PeerGoneError,
  negotiateRematch,
  orPeerGone,
  renderAbandoned,
  renderFinalFriend,
  trySend,
} from "./friend-common";
import {
  commitPayload,
  createBalances,
  createBidPanel,
  createGameLog,
  createMatchShell,
  newAuction,
  newSalt,
  openTurnInbox,
  resolveAuction,
  STALL_MS,
  verifyPayload,
  type AuctionState,
  type Balances,
  type BidPanel,
  type GameLog,
  type MatchShell,
  type PeerHandle,
} from "@sneat/game-kit";

const BUDGET = 100;

export async function runFriendBiddingMatch(root: HTMLElement, peer: PeerHandle): Promise<void> {
  const me: Player = peer.role === "host" ? DARK : LIGHT;
  const opp: Player = me === DARK ? LIGHT : DARK;

  const labels = {
    p1Label: me === DARK ? "You (dark)" : "Friend (dark)",
    p2Label: me === LIGHT ? "You (light)" : "Friend (light)",
  };
  const balances = createBalances({ initialBudget: BUDGET, ...labels });
  const score = createDiscScoreCard(labels);
  const bidPanel = createBidPanel();
  const log = createGameLog();

  const topLeft = document.createElement("div");
  topLeft.className = "rev-topleft-stack";
  topLeft.append(balances.el, score.el);

  const shell = createMatchShell({ root, topLeft, topRight: bidPanel.el, log: log.el });

  // Torn down and recreated only when a NEW match is about to start (see
  // game-kit/docs/APP-PLAYBOOK.md gotcha 4).
  let board = createBoard(shell.boardSlot);

  for (;;) {
    let finished: FinishedMatch;
    try {
      finished = await playMatch(shell, board, bidPanel, balances, score, log, peer, me, opp);
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
      budgets: finished.budgets,
      initialBudget: BUDGET,
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
  peer: PeerHandle,
  me: Player,
  opp: Player,
): Promise<FinishedMatch> {
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

    const meCan = !mustPass(game, me);
    const oppCan = !mustPass(game, opp);

    // --- one-sided round: no auction, no payment --------------------------
    if (!meCan || !oppCan) {
      const mover: Player = meCan ? me : opp;
      const cell = await playFreeRound(shell, board, bidPanel, peer, game, turn, mover, me, lastMove, flipped);
      const applied = applyMove(game, mover, cell);
      game = applied.game;
      lastMove = cell;
      flipped = applied.flipped;
      log.append({
        turn,
        head: `${mover === me ? "You" : "Friend"} played ${cellLabel(cell)} free — flipped ${discCount(applied.flipped.length)}`,
      });
      continue;
    }

    // --- contested round: hidden auction ----------------------------------
    const resolved = await playAuctionRound(board, bidPanel, game, auction, lastMove, flipped, turn, peer, me, opp);
    auction = resolved.next;
    balances.update(auction.budgets);

    // Both sides committed against the identical position, so the winning
    // move is still legal at resolution time — the property the whole
    // variant rests on (docs/DESIGN.md §Reversi).
    let applied;
    try {
      applied = applyMove(game, resolved.auctionWinner, resolved.cell);
    } catch {
      throw new PeerGoneError("Your friend revealed a move that is not legal in this position.");
    }
    game = applied.game;
    lastMove = resolved.cell;
    flipped = applied.flipped;

    log.append({
      turn,
      head: `${resolved.auctionWinner === me ? "You" : "Friend"} played ${cellLabel(resolved.cell)} — flipped ${discCount(applied.flipped.length)}`,
      tie: resolved.tieBreak,
      rows: [
        bidRow(me === DARK ? "You" : "Friend", resolved.bids[0], 0, resolved.auctionWinner === 0),
        bidRow(me === LIGHT ? "You" : "Friend", resolved.bids[1], 1, resolved.auctionWinner === 1),
      ],
    });
  }
}

/**
 * A round only one side can play. The mover sends a plain `move`; the other
 * side waits for it. The message is redundant in principle (both clients can
 * derive who moves from the shared position) but it keeps the two streams
 * turn-for-turn aligned and gives the waiting player a visible reason for
 * the round they are sitting out.
 */
async function playFreeRound(
  shell: MatchShell,
  board: BoardHandle,
  bidPanel: BidPanel,
  peer: PeerHandle,
  game: Game,
  turn: number,
  mover: Player,
  me: Player,
  lastMove: number | null,
  flipped: readonly number[],
): Promise<number> {
  const mine = mover === me;
  const notice = createFreeMoveNotice(
    mine
      ? "Free move — your friend has no legal move, so no auction runs and nothing is paid."
      : "Free move — you have no legal move, so your friend plays unopposed. No auction, nothing paid.",
  );
  shell.setNote([notice.el]);

  if (mine) {
    bidPanel.setWaiting("No auction this round — your friend cannot move. Play any highlighted cell.");
    const cell = await askCell({
      board,
      game,
      mover: me,
      lastMove,
      flipped,
      clock: {
        start: (expire) => notice.clock.run({ ms: STALL_MS, label: "Playing automatically in", onExpire: expire }),
        stop: () => notice.clock.stop(),
        autoCell: () => pickMove(game, me),
      },
    });
    trySend(peer, { kind: "move", turn, move: cell });
    return cell;
  }

  bidPanel.setWaiting("No auction this round — you have no legal move. Waiting for your friend…");
  board.render({ game, mover: null, hintFor: null, lastMove, flipped, interactive: false });

  // Listen before waiting — see game-kit's turn-inbox.ts doc comment.
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
  return move;
}

interface ResolvedRound {
  auctionWinner: 0 | 1;
  cell: number;
  tieBreak: boolean;
  next: AuctionState;
  /** Both bids indexed by player, for the log. */
  bids: readonly [number, number];
}

async function playAuctionRound(
  board: BoardHandle,
  bidPanel: BidPanel,
  game: Game,
  auction: AuctionState,
  lastMove: number | null,
  flipped: readonly number[],
  turn: number,
  peer: PeerHandle,
  me: Player,
  opp: Player,
): Promise<ResolvedRound> {
  // Opened before the first await of the round, so a commit that lands while
  // the local player is still choosing is buffered rather than lost.
  const inbox = openTurnInbox(peer, turn);
  try {
    const myMove: ReversiBidMove = await askBidMove({
      board,
      bidPanel,
      game,
      mover: me,
      lastMove,
      flipped,
      ownBalance: auction.budgets[me],
      opponentBalance: auction.budgets[opp],
      opponentBidIn: inbox.hasCommit(),
      onOpponentBid: (fn) => inbox.onCommit(fn),
    });

    const salt = newSalt();
    const hash = await commitPayload([myMove.bid, myMove.cell], salt);
    peer.send({ kind: "commit", turn, hash });

    bidPanel.setWaiting("Bid committed. Waiting for your friend…");
    const oppCommit = await orPeerGone(inbox, inbox.commit(), "Your friend stopped responding.");

    peer.send({ kind: "reveal", turn, bid: myMove.bid, move: myMove.cell, salt });
    const oppReveal = await orPeerGone(inbox, inbox.reveal(), "Your friend stopped responding.");

    if (typeof oppReveal.move !== "number" || !Number.isInteger(oppReveal.move)) {
      throw new PeerGoneError("Your friend revealed an invalid move.");
    }
    const oppCell = oppReveal.move;
    const verified = await verifyPayload(oppCommit.hash, [oppReveal.bid, oppCell], oppReveal.salt);
    if (!verified) {
      throw new PeerGoneError("Your friend's revealed bid did not match their commitment.");
    }

    const bids: [number, number] =
      me === DARK ? [myMove.bid, oppReveal.bid] : [oppReveal.bid, myMove.bid];
    const { winner: auctionWinner, tieBreak, next } = resolveAuctionSafe(auction, bids);
    const cell = auctionWinner === me ? myMove.cell : oppCell;

    return { auctionWinner, cell, tieBreak, next, bids };
  } finally {
    inbox.close();
  }
}

// resolveAuction throws on a malformed bid (negative / over-budget); a
// well-behaved client's own UI never produces one, but a hostile or buggy
// peer's revealed bid could. Treat that exactly like any other protocol
// violation: abandon rather than guess.
function resolveAuctionSafe(auction: AuctionState, bids: readonly [number, number]) {
  try {
    return resolveAuction(auction, bids);
  } catch (e) {
    throw new PeerGoneError(
      e instanceof Error ? `Your friend's bid was invalid: ${e.message}` : "Your friend's bid was invalid.",
    );
  }
}

// Every row's bar fraction is relative to the fixed starting BUDGET (not the
// fluctuating post-transfer balance), so bars stay comparable round to round.
function bidRow(label: string, bid: number, player: 0 | 1, won: boolean) {
  return { label, value: String(bid), fraction: BUDGET > 0 ? bid / BUDGET : 0, player, won };
}
