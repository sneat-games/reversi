// Board renderer tests. The board is this game's identity (see board.ts's
// header), so the things that make it worth looking at — legal-move hints,
// the hover capture preview, the staggered flip cascade, keyboard reach —
// are asserted here rather than left to the e2e suite, which can only say
// "a board appeared".

import { describe, it, expect, beforeEach } from "vitest";
import { createBoard, flipDistance, FLIP_STAGGER_MS } from "./board";
import {
  DARK,
  LIGHT,
  applyMove,
  cellOf,
  computeFlips,
  legalMoves,
  newGame,
  type Disk,
  type Game,
} from "../engine/revplay";

function mount(): HTMLElement {
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

function boardOf(cells: Record<number, Disk>): Game {
  const board: Disk[] = new Array<Disk>(64).fill(null);
  for (const [cell, disk] of Object.entries(cells)) board[Number(cell)] = disk;
  return { board };
}

let root: HTMLElement;
beforeEach(() => {
  root = mount();
});

describe("board furniture", () => {
  it("draws 64 cells, the grid and the four star points", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false });

    expect(root.querySelectorAll("[data-cell]")).toHaveLength(64);
    expect(root.querySelectorAll("[data-star]")).toHaveLength(4);
    // 9 vertical + 9 horizontal lines for an 8x8 grid.
    expect(root.querySelectorAll(".rev-board__line")).toHaveLength(18);
    expect(root.querySelector(".rev-board__surface")).not.toBeNull();
  });

  it("renders the four opening discs with their owner", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false });

    const discs = root.querySelectorAll("[data-disc]");
    expect(discs).toHaveLength(4);
    expect(root.querySelector(`[data-disc="${cellOf(3, 4)}"]`)?.getAttribute("data-owner")).toBe("dark");
    expect(root.querySelector(`[data-disc="${cellOf(3, 3)}"]`)?.getAttribute("data-owner")).toBe("light");
  });
});

describe("legal-move hints", () => {
  it("dots exactly the cells the hinted player may play", () => {
    const game = newGame();
    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    const hinted = [...root.querySelectorAll("[data-hint]")].map((n) => Number(n.getAttribute("data-hint"))).sort();
    expect(hinted).toEqual(legalMoves(game, DARK).sort());
    expect(hinted).toHaveLength(4); // the standard opening has four
  });

  it("hints the LOCAL player in bidding mode, not the side to move", () => {
    const game = newGame();
    const board = createBoard(root);
    // Bidding: both sides commit against the same position, so `hintFor` is
    // passed explicitly and need not equal any notion of "whose turn".
    board.render({ game, mover: LIGHT, hintFor: LIGHT, interactive: true, onSelect: () => {} });

    const hinted = [...root.querySelectorAll("[data-hint]")].map((n) => Number(n.getAttribute("data-hint"))).sort();
    expect(hinted).toEqual(legalMoves(game, LIGHT).sort());
  });

  it("draws no hints when nobody is to move", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false });
    expect(root.querySelectorAll("[data-hint]")).toHaveLength(0);
  });
});

describe("aria-labels", () => {
  it("names an occupied cell by its disc colour", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false });
    expect(root.querySelector(`[data-cell="${cellOf(3, 3)}"]`)?.getAttribute("aria-label")).toBe("d4 — light disc");
  });

  it("tells a legal cell how many discs it flips", () => {
    const game = newGame();
    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    // d3 (row 2, col 3) is one of Dark's four opening moves and flips one disc.
    const d3 = cellOf(2, 3);
    expect(computeFlips(game.board, d3, DARK)).toHaveLength(1);
    expect(root.querySelector(`[data-cell="${d3}"]`)?.getAttribute("aria-label")).toBe("d3 — flips 1 disc");
  });

  it("calls an empty, unplayable cell empty", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: DARK, interactive: true, onSelect: () => {} });
    expect(root.querySelector('[data-cell="0"]')?.getAttribute("aria-label")).toBe("a1 — empty");
  });
});

describe("interaction", () => {
  it("makes only legal cells pickable, as real buttons", () => {
    const game = newGame();
    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    const picks = [...root.querySelectorAll(".rev-cell--pick")];
    expect(picks).toHaveLength(legalMoves(game, DARK).length);
    for (const p of picks) {
      expect(p.getAttribute("role")).toBe("button");
      expect(p.getAttribute("tabindex")).toBe("0");
    }
  });

  it("selects on click and on Enter — the board is keyboard-reachable", () => {
    const game = newGame();
    const board = createBoard(root);
    const picked: number[] = [];
    board.render({ game, mover: DARK, interactive: true, onSelect: (c) => picked.push(c) });

    const legal = legalMoves(game, DARK);
    root.querySelector<SVGElement>(`[data-cell="${legal[0]}"]`)!.dispatchEvent(new Event("click"));
    root
      .querySelector<SVGElement>(`[data-cell="${legal[1]}"]`)!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(picked).toEqual([legal[0], legal[1]]);
  });

  it("makes nothing pickable when the board is not interactive", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: DARK, interactive: false });
    expect(root.querySelectorAll(".rev-cell--pick")).toHaveLength(0);
  });
});

describe("capture preview — the standout feature", () => {
  it("ghosts the disc and outlines every disc the move would flip", () => {
    // A long row: Dark at a1, Light at b1..d1, so playing e1 flips three.
    const game = boardOf({
      [cellOf(0, 0)]: DARK,
      [cellOf(0, 1)]: LIGHT,
      [cellOf(0, 2)]: LIGHT,
      [cellOf(0, 3)]: LIGHT,
    });
    const target = cellOf(0, 4);
    const expected = computeFlips(game.board, target, DARK);
    expect(expected).toHaveLength(3);

    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    const cell = root.querySelector<SVGElement>(`[data-cell="${target}"]`)!;
    cell.dispatchEvent(new Event("pointerenter"));

    const ghost = root.querySelector<SVGElement>("[data-ghost]")!;
    expect(ghost.style.display).toBe("");
    expect(ghost.getAttribute("class")).toContain("rev-ghost--p1");

    const outlined = [...root.querySelectorAll("[data-flip-outline]")]
      .map((n) => Number(n.getAttribute("data-flip-outline")))
      .sort();
    expect(outlined).toEqual([...expected].sort());
  });

  it("clears the preview when the pointer leaves", () => {
    const game = newGame();
    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    const cell = root.querySelector<SVGElement>(`[data-cell="${legalMoves(game, DARK)[0]}"]`)!;
    cell.dispatchEvent(new Event("pointerenter"));
    expect(root.querySelectorAll("[data-flip-outline]").length).toBeGreaterThan(0);

    cell.dispatchEvent(new Event("pointerleave"));
    expect(root.querySelectorAll("[data-flip-outline]")).toHaveLength(0);
    expect(root.querySelector<SVGElement>("[data-ghost]")!.style.display).toBe("none");
  });

  it("previews on keyboard focus too, not just hover", () => {
    const game = newGame();
    const board = createBoard(root);
    board.render({ game, mover: DARK, interactive: true, onSelect: () => {} });

    const cell = root.querySelector<SVGElement>(`[data-cell="${legalMoves(game, DARK)[0]}"]`)!;
    cell.dispatchEvent(new Event("focus"));
    expect(root.querySelectorAll("[data-flip-outline]").length).toBeGreaterThan(0);
  });
});

describe("flip cascade", () => {
  it("staggers each flipped disc by its distance from the placed disc", () => {
    // Dark at a1, Light along b1..d1: playing e1 flips all three, at
    // distances 1, 2 and 3 from e1.
    const game = boardOf({
      [cellOf(0, 0)]: DARK,
      [cellOf(0, 1)]: LIGHT,
      [cellOf(0, 2)]: LIGHT,
      [cellOf(0, 3)]: LIGHT,
    });
    const placed = cellOf(0, 4);
    const applied = applyMove(game, DARK, placed);

    const board = createBoard(root);
    board.render({
      game: applied.game,
      mover: null,
      lastMove: placed,
      flipped: applied.flipped,
      interactive: false,
    });

    for (const cell of applied.flipped) {
      const disc = root.querySelector<SVGElement>(`[data-disc="${cell}"]`)!;
      expect(disc.getAttribute("class")).toContain("rev-disc--flip");
      const steps = flipDistance(placed, cell);
      expect(disc.getAttribute("data-flip-step")).toBe(String(steps));
      expect(disc.style.animationDelay).toBe(`${steps * FLIP_STAGGER_MS}ms`);
    }

    // The placed disc drops in and keeps the last-move ring; it is not part
    // of the cascade.
    const placedDisc = root.querySelector<SVGElement>(`[data-disc="${placed}"]`)!;
    expect(placedDisc.getAttribute("class")).toContain("rev-disc--placed");
    expect(placedDisc.getAttribute("class")).not.toContain("rev-disc--flip");
    expect(root.querySelector(".rev-disc__last-ring")).not.toBeNull();
  });

  it("measures distance along the flip ray in whole steps", () => {
    expect(flipDistance(cellOf(0, 0), cellOf(0, 3))).toBe(3); // along a row
    expect(flipDistance(cellOf(4, 4), cellOf(2, 2))).toBe(2); // diagonal
    expect(flipDistance(cellOf(4, 4), cellOf(4, 4))).toBe(0);
  });
});

describe("end of match", () => {
  it("dims the board and runs a single sweep", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false, over: true });

    expect(board.container.classList.contains("rev-board--over")).toBe(true);
    expect(root.querySelectorAll("[data-sweep]")).toHaveLength(1);
  });

  it("drops the over state on the next live render", () => {
    const board = createBoard(root);
    board.render({ game: newGame(), mover: null, interactive: false, over: true });
    board.render({ game: newGame(), mover: DARK, interactive: true, onSelect: () => {} });

    expect(board.container.classList.contains("rev-board--over")).toBe(false);
    expect(root.querySelectorAll("[data-sweep]")).toHaveLength(0);
  });
});
