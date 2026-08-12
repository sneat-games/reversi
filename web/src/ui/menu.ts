// Reversi's mode-select menu: a thin wrapper around game-kit's `renderMenu`
// (mode/variant/size radio groups + a Play button) that types the result to
// Reversi's own choices and disables "vs Friend" with a friendly note when
// the browser reports it is offline (see game-kit/docs/DESIGN.md "Offline":
// vs-Friend needs the network by nature; vs-Bot runs entirely client-side).
//
// Reversi is played on ONE board size — the standard 8x8 — so unlike Hex or
// Dots & Boxes there is nothing to choose there. The kit's `renderMenu`
// always renders its third group, so rather than smuggling an empty group
// past it (a radio group with no checked option silently drops the field
// from the submitted FormData), this passes a single-option group re-titled
// "Board": it reads as the informative label it is, and the menu keeps the
// exact shape every other kit game's menu has.

import { renderMenu } from "@sneat/game-kit";

export type ReversiMode = "vs-bot" | "vs-friend";
export type ReversiVariant = "classic" | "bidding";

export interface ReversiMenuChoice {
  mode: ReversiMode;
  variant: ReversiVariant;
}

export function renderReversiMenu(root: HTMLElement): Promise<ReversiMenuChoice> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const promise = renderMenu({
    root,
    title: "Play Reversi",
    modes: [
      { id: "vs-bot", label: "vs Bot", desc: "Play the built-in bot — works offline." },
      { id: "vs-friend", label: "vs Friend", desc: "Invite a friend over a private link (WebRTC)." },
    ],
    variants: [
      { id: "classic", label: "Classic", desc: "Standard Othello: take turns, pass when you have no move." },
      { id: "bidding", label: "Bidding", desc: "Hidden per-turn auctions decide who plays each disc." },
    ],
    sizes: [{ id: "8", label: "8 × 8", desc: "The standard Othello board" }],
    defaults: { mode: "vs-bot", variant: "classic", size: "8" },
  });

  // renderMenu builds its DOM synchronously before returning the pending
  // promise (only the form's submit resolves it), so it is safe to reach
  // back into `root` here, before the player has interacted.
  retitleSizeGroup(root);
  if (offline) disableVsFriend(root);

  return promise.then((choice) => ({
    mode: choice.mode as ReversiMode,
    variant: choice.variant as ReversiVariant,
  }));
}

/** "Board size" reads like a choice; with one fixed board it is a fact. */
function retitleSizeGroup(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("#size-8");
  const legend = input?.closest("fieldset")?.querySelector(".menu__legend");
  if (legend) legend.textContent = "Board";
}

function disableVsFriend(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>("#mode-vs-friend");
  const card = input?.closest<HTMLElement>(".menu-card");
  if (!input || !card) return;

  input.disabled = true;
  card.setAttribute("aria-disabled", "true");
  card.style.opacity = "0.55";
  card.style.cursor = "not-allowed";

  // The default landed on vs-bot already (see `defaults` above), so this is
  // a defensive re-check rather than the primary mechanism — it keeps the
  // menu correct even if a future default changes independently of this
  // guard.
  if (input.checked) {
    input.checked = false;
    const bot = root.querySelector<HTMLInputElement>("#mode-vs-bot");
    if (bot) bot.checked = true;
  }

  const desc = card.querySelector(".menu-card__desc");
  if (desc) desc.textContent = "Offline — connect to the internet to play a friend.";
}
