// The pass UI, and the engine fixture that proves it is a real position and
// not a hypothetical one.
//
// A forced pass cannot be produced on demand in an end-to-end match against
// the bot (whether one occurs depends on how the game happens to go), so the
// rule and its UI are pinned here instead: a CONSTRUCTED position where one
// player provably has no legal move while the other does, plus the banner
// that position puts on screen — including the promise every player relies
// on, that the Pass button is the only thing they can press.

import { describe, it, expect, beforeEach } from "vitest";
import { askPass, createFreeMoveNotice, renderPassNotice } from "./pass-banner";
import { DARK, LIGHT, cellOf, isOver, legalMoves, mustPass, type Disk, type Game } from "../engine/revplay";

/**
 * Dark on a1, Light on b1, nothing else.
 *
 *   - Dark can play c1: b1 (Light) is flanked between c1 and a1 (Dark).
 *   - Light has NO legal move: its only lever on the single Dark disc at a1
 *     would be an empty cell on a1's far side, and a1 is a corner — there is
 *     no far side. So Light must pass, and the game is NOT over, because
 *     Dark still has a move.
 */
function passPosition(): Game {
  const board: Disk[] = new Array<Disk>(64).fill(null);
  board[cellOf(0, 0)] = DARK;
  board[cellOf(0, 1)] = LIGHT;
  return { board };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the position that forces a pass", () => {
  it("leaves Light with no legal move while Dark still has one", () => {
    const game = passPosition();
    expect(legalMoves(game, LIGHT)).toEqual([]);
    expect(mustPass(game, LIGHT)).toBe(true);
    expect(mustPass(game, DARK)).toBe(false);
    expect(legalMoves(game, DARK)).toContain(cellOf(0, 2));
    // One player passing is not the end of the match — two in a row is.
    expect(isOver(game)).toBe(false);
  });
});

describe("renderPassNotice — the opponent's pass", () => {
  it("announces the pass and why the turn came back", () => {
    const el = renderPassNotice({
      headline: "No legal moves — Bot passes",
      detail: "The bot cannot flip anything from this position, so you move again.",
    });
    expect(el.getAttribute("data-pass-notice")).not.toBeNull();
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toContain("No legal moves — Bot passes");
    expect(el.textContent).toContain("so you move again");
  });
});

describe("askPass — the local player's pass", () => {
  it("shows a Pass button and resolves when it is clicked", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    const done = askPass({ container, headline: "You must pass", detail: "No legal move is available to you." });

    const button = container.querySelector<HTMLButtonElement>("[data-pass-button]")!;
    expect(button.textContent).toBe("Pass");
    expect(container.textContent).toContain("You must pass");

    button.click();
    await done;

    // The banner cleans up after itself.
    expect(container.querySelector("[data-pass-button]")).toBeNull();
    expect(container.querySelector("[data-pass-notice]")).toBeNull();
  });

  it("leaves the Pass button as the only enabled control in the match", async () => {
    const scope = document.createElement("div");
    const other = document.createElement("button");
    const bidInput = document.createElement("input");
    scope.append(other, bidInput);
    const container = document.createElement("div");
    scope.append(container);
    document.body.append(scope);

    const done = askPass({ container, headline: "You must pass", lockScope: scope });

    const button = container.querySelector<HTMLButtonElement>("[data-pass-button]")!;
    expect(button.disabled).toBe(false);
    expect(other.disabled).toBe(true);
    expect(bidInput.disabled).toBe(true);

    button.click();
    await done;

    expect(other.disabled).toBe(false);
    expect(bidInput.disabled).toBe(false);
  });

  it("restores — rather than blanket-enables — controls that were already disabled", async () => {
    const scope = document.createElement("div");
    const alreadyOff = document.createElement("button");
    alreadyOff.disabled = true;
    scope.append(alreadyOff);
    const container = document.createElement("div");
    scope.append(container);
    document.body.append(scope);

    const done = askPass({ container, headline: "You must pass", lockScope: scope });
    container.querySelector<HTMLButtonElement>("[data-pass-button]")!.click();
    await done;

    expect(alreadyOff.disabled).toBe(true);
  });

  it("passes for the player when the self-enforced clock expires", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    let expire: (() => void) | undefined;
    let stopped = false;
    const done = askPass({
      container,
      headline: "You must pass",
      clock: {
        start: (fn) => {
          expire = fn;
        },
        stop: () => {
          stopped = true;
        },
      },
    });

    expect(expire).toBeTypeOf("function");
    expire!();
    await done;
    expect(stopped).toBe(true);
    expect(container.querySelector("[data-pass-button]")).toBeNull();
  });
});

describe("createFreeMoveNotice — bidding's one-sided round", () => {
  it("states that no auction runs and nothing is paid", () => {
    const notice = createFreeMoveNotice("Free move — the bot has no legal move, so no auction runs.");
    expect(notice.el.getAttribute("data-free-move")).not.toBeNull();
    expect(notice.el.textContent).toContain("no auction runs");
    // Carries its own countdown for the vs-Friend case; idle until started.
    expect(notice.clock.el.hidden).toBe(true);
  });
});
