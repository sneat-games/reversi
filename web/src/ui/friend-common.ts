// The plumbing both vs-Friend turn loops need, in one place: peer-gone
// detection, the rematch handshake, the end-of-match controls and the
// abandoned-match banner. Hex keeps two near-identical copies of this in its
// friend-classic.ts/friend-bidding.ts; Reversi's two loops differ only in
// what a "turn" is, so the shared half lives here instead.

import type { MatchShell, PeerHandle, TurnInbox, WireMessage } from "@sneat/game-kit";

/**
 * How long to wait for a peer's message before declaring them gone. Their
 * own clock forces a move within STALL_MS, so silence past this is a dead
 * tab, not a slow player — mirrors bidding-tictactoe/web/src/ui/vs-friend.ts.
 */
export const PEER_GRACE_MS = 45_000;

export class PeerGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerGoneError";
  }
}

/**
 * Race a turn's expected message against the two ways it may never arrive:
 * the channel closing (or an explicit `leave`), and simple silence past
 * PEER_GRACE_MS. A match is ABANDONED in either case, never resolved by
 * guessing what the peer would have done.
 */
export function orPeerGone<T>(inbox: TurnInbox, p: Promise<T>, message: string): Promise<T> {
  const gone = inbox.closed().then((): T => {
    throw new PeerGoneError("Your friend left the room.");
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PeerGoneError(message)), PEER_GRACE_MS);
  });
  return Promise.race([p, gone, timeout]).finally(() => clearTimeout(timer));
}

export function negotiateRematch(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (v: boolean) => {
      peer.offMessage(onMessage);
      peer.offClose(onClose);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (msg: WireMessage) => {
      if (msg.kind === "rematch-request") {
        trySend(peer, { kind: "rematch-accept" });
        settle(true);
      } else if (msg.kind === "rematch-accept") {
        settle(true);
      } else if (msg.kind === "leave") {
        settle(false);
      }
    };
    const onClose = () => settle(false);
    const timer = setTimeout(() => settle(false), PEER_GRACE_MS);
    peer.onMessage(onMessage);
    peer.onClose(onClose);
    trySend(peer, { kind: "rematch-request" });
  });
}

/** Send, tolerating a channel that has already gone away. */
export function trySend(peer: PeerHandle, msg: WireMessage): void {
  try {
    peer.send(msg);
  } catch (e) {
    console.debug("[pvp] send skipped", e);
  }
}

/** End-of-match controls under a game-built banner. Resolves true on a
 *  rematch request, false on leaving. */
export function renderFinalFriend(shell: MatchShell, banner: HTMLElement): Promise<boolean> {
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn--primary";
  again.textContent = "Rematch (same friend)";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Leave";

  shell.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => {
      again.disabled = true;
      again.textContent = "Waiting for your friend…";
      resolve(true);
    });
    leave.addEventListener("click", () => resolve(false));
  });
}

/**
 * The match ended because the other side went away. Resolves only once the
 * player acknowledges it: main.ts re-renders the menu the moment a session
 * function returns, so returning immediately here would wipe the
 * explanation off the screen before it could be read.
 */
export function renderAbandoned(shell: MatchShell, message: string): Promise<void> {
  shell.actions.hidden = true;
  shell.controls.innerHTML = "";
  const banner = document.createElement("p");
  banner.className = "result-banner";
  banner.setAttribute("data-abandoned", "");
  banner.textContent = message;
  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Back to menu";
  shell.controls.append(banner, leave);
  return new Promise((resolve) => leave.addEventListener("click", () => resolve()));
}

/** The wire shape of a pass in classic mode: `{ pass: true }`. */
export function isPassMove(move: unknown): boolean {
  return !!move && typeof move === "object" && (move as { pass?: unknown }).pass === true;
}
