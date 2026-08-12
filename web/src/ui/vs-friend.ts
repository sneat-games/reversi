// vs-Friend: hosts a private room (reserve a code, share a link) or joins an
// existing one as the guest, then negotiates the match config over the wire
// before handing off to the per-variant turn loop (friend-classic.ts /
// friend-bidding.ts).
//
// The HOST already knows the variant — it came from the menu. The GUEST
// joins straight off a `#room=` link (see main.ts) and has never seen the
// menu at all, so it learns the match's shape only from the host's `hello`
// message (game-kit/docs/DESIGN.md's PvP protocol v1: `{ kind: "hello",
// game, protocol: 1, config: { mode, size } }`, guest replies `hello-ack`).
// Reversi has exactly one board size, so `size` is sent as the constant 8
// and validated as such — the field stays in the config because the protocol
// is shared across kit games, not because there is anything to choose.
//
// The invite UI is rendered BEFORE awaiting hostPeer/guestPeer: both block
// until the DataChannel is open, so awaiting first would leave the host
// staring at a blank screen with no room code to share (game-kit/docs/
// APP-PLAYBOOK.md gotcha 5).

import {
  reserveRoomId,
  hostPeer,
  guestPeer,
  shareLinkFor,
  updateRoom,
  inviteLink,
  leftRoom,
  type PeerHandle,
  type WireMessage,
} from "@sneat/game-kit";
import type { ReversiVariant } from "./menu";
import { runFriendClassicMatch } from "./friend-classic";
import { runFriendBiddingMatch } from "./friend-bidding";

const GAME_ID = "reversi";
const PROTOCOL = 1;
const BOARD_SIZE = 8;
const HELLO_TIMEOUT_MS = 20_000;

export type VsFriendOptions = { as: "host"; variant: ReversiVariant } | { as: "guest"; roomId: string };

export async function runVsFriend(root: HTMLElement, opts: VsFriendOptions): Promise<void> {
  let peer: PeerHandle | null = null;
  try {
    if (opts.as === "host") {
      const roomId = await reserveRoomId({ gameId: GAME_ID });
      updateRoom({ roomId, isJoinable: true, inviteParams: { roomId } });
      renderInvite(root, {
        roomId,
        shareLink: shareLinkFor(shareBaseUrl(), roomId),
        cgShareLink: inviteLink({ roomId }),
      });

      peer = await hostPeer({ gameId: GAME_ID, roomId });
      peer.send({
        kind: "hello",
        game: GAME_ID,
        protocol: PROTOCOL,
        config: { mode: opts.variant, size: BOARD_SIZE },
      });
      const ackOk = await waitForHelloAck(peer);
      if (!ackOk) {
        await renderRefused(root, "Your friend's app could not join this match.");
        return;
      }
      await dispatch(root, peer, opts.variant);
    } else {
      updateRoom({ roomId: opts.roomId, isJoinable: true, inviteParams: { roomId: opts.roomId } });
      renderJoined(root, opts.roomId);

      peer = await guestPeer({ gameId: GAME_ID, roomId: opts.roomId });
      const hello = await waitForHello(peer);
      if (!hello) {
        await renderRefused(root, "Could not connect to your friend's game.");
        return;
      }
      peer.send({ kind: "hello-ack" });
      await dispatch(root, peer, hello.variant);
    }
  } catch (e) {
    await renderRefused(root, e instanceof Error ? e.message : "Connection failed.");
  } finally {
    peer?.close();
    leftRoom();
  }
}

function dispatch(root: HTMLElement, peer: PeerHandle, variant: ReversiVariant): Promise<void> {
  return variant === "classic" ? runFriendClassicMatch(root, peer) : runFriendBiddingMatch(root, peer);
}

/** The invite link's base URL. Off `*.sneat.games` (CrazyGames, itch.io —
 *  see docs/DESIGN.md's "Distribution" section) the host's own origin isn't
 *  a working link for anyone else, so this falls back to the game's
 *  canonical sneat.games subdomain instead. */
function shareBaseUrl(): string {
  const { hostname, origin, pathname } = window.location;
  if (hostname.endsWith(".sneat.games") || hostname === "localhost" || hostname.startsWith("127.")) {
    return `${origin}${pathname}`;
  }
  return "https://reversi.sneat.games/";
}

function waitForHello(peer: PeerHandle): Promise<{ variant: ReversiVariant } | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(null), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind !== "hello" || msg.game !== GAME_ID || msg.protocol !== PROTOCOL) return;
      const config = msg.config as { mode?: unknown; size?: unknown };
      if ((config.mode === "classic" || config.mode === "bidding") && config.size === BOARD_SIZE) {
        finish({ variant: config.mode });
      }
    }
    function finish(v: { variant: ReversiVariant } | null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function waitForHelloAck(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), HELLO_TIMEOUT_MS);
    function onMessage(msg: WireMessage) {
      if (msg.kind === "hello-ack") finish(true);
    }
    function finish(v: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.offMessage(onMessage);
      resolve(v);
    }
    peer.onMessage(onMessage);
  });
}

function renderInvite(root: HTMLElement, args: { roomId: string; shareLink: string; cgShareLink: string | null }): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  wrap.setAttribute("data-invite", "");

  const heading = document.createElement("h2");
  heading.className = "menu__title";
  heading.textContent = `Room ${args.roomId}`;

  const waiting = document.createElement("p");
  waiting.textContent = "Waiting for your friend to join…";

  const link = document.createElement("p");
  link.className = "invite-link";
  link.setAttribute("data-invite-link", "");
  link.textContent = args.shareLink;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--primary";
  copyBtn.textContent = "Copy link";
  copyBtn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(args.shareLink);
    copyBtn.textContent = "Copied";
    setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
  });

  wrap.append(heading, waiting, link, copyBtn);
  if (args.cgShareLink) {
    const cg = document.createElement("p");
    cg.textContent = `Or invite via CrazyGames: ${args.cgShareLink}`;
    wrap.append(cg);
  }
  root.append(wrap);
}

function renderJoined(root: HTMLElement, roomId: string): void {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  const p = document.createElement("p");
  p.textContent = `Joined room ${roomId}. Connecting…`;
  wrap.append(p);
  root.append(wrap);
}

/** Resolves only once the player acknowledges the failure: main.ts
 *  re-renders the menu the moment this session returns, so returning
 *  immediately would wipe the explanation before it could be read. */
function renderRefused(root: HTMLElement, message: string): Promise<void> {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "menu";
  wrap.setAttribute("data-connect-failed", "");
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = message;
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn--ghost";
  back.textContent = "Back to menu";
  wrap.append(p, back);
  root.append(wrap);
  return new Promise((resolve) => back.addEventListener("click", () => resolve()));
}
