// Top-level bootstrap for the Reversi web app.
//
// Routing:
//   - `#room=<id>` in the URL -> join as vs-Friend GUEST (no menu; the
//     match's variant arrives over the wire — see vs-friend.ts's `hello`
//     handshake).
//   - Otherwise the menu decides mode (vs Bot / vs Friend) and variant
//     (classic / bidding). Reversi has one board size, so there is nothing
//     else to choose.
//
// The menu is a LOOP, not a one-shot: every session module's "Back to menu"
// / "Leave" resolves back to here, and the menu is re-rendered. (Hex and D&B
// fall out of `bootstrap` instead, which leaves the finished match on screen
// with a dead button.)
//
// Mirrors bidding-tictactoe/web/src/main.ts's structure otherwise; the
// CrazyGames SDK gate, settings listener and home-link reset-by-reload logic
// are ported near-verbatim (now sourced from @sneat/game-kit rather than a
// per-game copy — see game-kit/docs/DESIGN.md "Distribution").

import {
  initSdk,
  getSettings,
  addSettingsChangeListener,
  gameplayStart,
  gameplayStop,
  loadingStart,
  loadingStop,
  roomIdFromLocation,
  createThemeToggle,
  createGamesFooter,
} from "@sneat/game-kit";
import { renderReversiMenu } from "./ui/menu";
import { runVsBotClassic } from "./ui/vs-bot-classic";
import { runVsBotBidding } from "./ui/vs-bot-bidding";
import { runVsFriend } from "./ui/vs-friend";
import { createStandingsButton } from "./ui/standings";

export async function bootstrap(): Promise<void> {
  loadingStart();
  try {
    await initSdk();
    const s = getSettings();
    if (s) applySettings(s);
    addSettingsChangeListener(applySettings);
  } catch (e) {
    console.warn("[boot] SDK init skipped/failed:", e);
  } finally {
    loadingStop();
  }

  // The boot placeholder has done its job; leaving it up makes a running
  // match look like it is still loading.
  document.getElementById("status")?.remove();

  wireHomeLink();
  wireHeaderActions();
  wireFooter();
  void maybeRegisterServiceWorker();

  const root = document.getElementById("game")!;
  root.innerHTML = "";

  const fromLink = roomIdFromLocation(window.location.href);
  if (fromLink) {
    gameplayStart();
    await runVsFriend(root, { as: "guest", roomId: fromLink });
    gameplayStop();
    // The invite is spent: drop the fragment so the menu below — and any
    // later reload — starts clean instead of trying to re-join a room that
    // is over.
    clearRoomFragment();
  }

  for (;;) {
    const choice = await renderReversiMenu(root);
    gameplayStart();
    if (choice.mode === "vs-bot") {
      if (choice.variant === "classic") await runVsBotClassic(root);
      else await runVsBotBidding(root);
    } else {
      await runVsFriend(root, { as: "host", variant: choice.variant });
    }
    gameplayStop();
  }
}

function applySettings(s: { disableChat?: boolean; muteAudio?: boolean }) {
  if (s.muteAudio) document.documentElement.classList.add("muted");
  else document.documentElement.classList.remove("muted");
  // No chat UI ships in the MVP; `disableChat` is honored by virtue of
  // having no chat surface.
}

function wireHeaderActions(): void {
  const el = document.getElementById("header-actions");
  if (!el) return;
  el.style.display = "flex";
  el.style.gap = "0.5rem";
  el.style.alignItems = "center";
  el.append(createStandingsButton().el, createThemeToggle().el);
}

function wireFooter(): void {
  const el = document.getElementById("footer-slot");
  if (!el) return;
  el.append(createGamesFooter({ current: "reversi" }));
}

function clearRoomFragment(): void {
  if (!window.location.hash) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * The title doubles as "back to the main menu". It is a real anchor so
 * middle-click and open-in-new-tab behave, but a plain same-page navigation
 * would only drop the `#room=` fragment without reloading — leaving a match,
 * its timers and any live peer connection running behind the menu.
 * Reloading is the one reset guaranteed to be complete.
 */
function wireHomeLink(): void {
  const link = document.getElementById("home-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
    e.preventDefault();
    clearRoomFragment();
    window.location.reload();
  });
}

/**
 * The built service worker (see astro.config.mjs's `injectRegister: false`)
 * registers only on this game's real deploy surface — never inside a
 * CrazyGames/itch.io iframe, never under `astro dev`, and deliberately NOT
 * on localhost either: a worker precaches built asset hashes, so on a dev
 * machine it keeps serving the PREVIOUS build after a rebuild, which is a
 * stale-preview trap that makes a landed fix look broken
 * (game-kit/docs/APP-PLAYBOOK.md gotcha 2). Offline behaviour is a
 * production concern; test it against a real *.sneat.games deploy.
 */
function shouldRegisterServiceWorker(): boolean {
  return window.location.hostname.endsWith(".sneat.games");
}

async function maybeRegisterServiceWorker(): Promise<void> {
  if (!shouldRegisterServiceWorker()) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (e) {
    console.warn("[pwa] service worker registration failed", e);
  }
}
