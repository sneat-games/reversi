// The Reversi board renderer — a bespoke SVG board, and the game's identity
// (see game-kit/docs/DESIGN.md "uniform chrome, unique hearts" and the board
// house style in game-kit/docs/APP-PLAYBOOK.md).
//
// # Not a green-felt skeuomorph
//
// Every colour comes from a theme.css token (or a `color-mix` of one), so
// the board is a flat, modern surface that follows the light/dark toggle
// with no JS: an accent-tinted board plane, hairline grid lines, and the
// four standard star points at the corners of the central 4x4 — the only
// piece of Othello board furniture worth keeping.
//
// # Coordinates
//
// revplay.ts stores cells row-major (`cell = row*8 + col`), so the layout is
// a plain square grid: cell (r, c) occupies the CELL-unit square at
// `(PAD + c*CELL, PAD + r*CELL)` in SVG user units. The on-screen size comes
// entirely from the viewBox + CSS `width: 100%`, so nothing here does pixel
// math and the same code scales from a phone to a wide desktop.
//
// # What makes this board worth looking at
//
//   - LEGAL-MOVE HINTS: a small translucent dot on every cell the hinted
//     player may play (the side to move in classic; the LOCAL player in
//     bidding, where both sides move against the same position).
//   - CAPTURE PREVIEW: hovering or focusing a legal cell ghosts the disc
//     that would land there AND outlines every disc it would flip. Reversi's
//     whole skill is seeing the flips before you commit; this shows them.
//   - CASCADING FLIP: after a move, each flipped disc animates through its
//     rim colour, staggered by its distance from the placed disc, so the
//     capture visibly radiates outward from where it was played.
//   - The placed disc drops in and keeps a last-move ring until the next
//     move; at the end of the match the board dims and a single soft sweep
//     crosses it.
//
// All motion is CSS (see styles/board.css) and honours
// `prefers-reduced-motion`; every cell is keyboard-reachable with a real
// aria-label ("d3 — flips 3 discs").

import {
  BOARD_SIZE,
  BOARD_CELLS,
  computeFlips,
  legalMoves,
  rowOf,
  colOf,
  type Game,
  type Player,
} from "../engine/revplay";
import { cellLabel, discCount, discName } from "./rev-format";

/** SVG user units per cell. Arbitrary — the viewBox scales it. */
const CELL = 100;
/** Board margin outside the grid, for the frame and focus rings. */
const PAD = 16;
const DISC_R = CELL * 0.4;
const BOARD_SPAN = CELL * BOARD_SIZE;
const VIEW = BOARD_SPAN + PAD * 2;

/** Per-step stagger of the flip cascade, in ms — see styles/board.css. */
export const FLIP_STAGGER_MS = 40;

export interface BoardRenderArgs {
  game: Game;
  /** Whose disc the hover/focus ghost shows. `null` disables the ghost. */
  mover: Player | null;
  /**
   * Whose legal moves get hint dots. Defaults to `mover`. Bidding mode
   * passes the LOCAL player explicitly: both sides commit against the same
   * position, so "the side to move" does not exist there.
   */
  hintFor?: Player | null;
  lastMove?: number | null;
  /** Cells flipped by the last move; animated as a cascade from `lastMove`. */
  flipped?: readonly number[];
  /** Whether legal cells are clickable/focusable at all. */
  interactive: boolean;
  /** Match over: dims the board and runs the end-of-match sweep once. */
  over?: boolean;
  onSelect?: (cell: number) => void;
}

export interface BoardHandle {
  readonly container: HTMLElement;
  render(args: BoardRenderArgs): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el as SVGElementTagNameMap[K];
}

function cellX(col: number): number {
  return PAD + col * CELL;
}
function cellY(row: number): number {
  return PAD + row * CELL;
}
function centerX(cell: number): number {
  return cellX(colOf(cell)) + CELL / 2;
}
function centerY(cell: number): number {
  return cellY(rowOf(cell)) + CELL / 2;
}

/**
 * How many steps out from the placed disc a flipped disc sits. Flips always
 * run along one of the 8 rays, so the Chebyshev distance IS the step index
 * along that ray — which is exactly what the cascade should stagger by.
 */
export function flipDistance(placed: number, flipped: number): number {
  return Math.max(Math.abs(rowOf(flipped) - rowOf(placed)), Math.abs(colOf(flipped) - colOf(placed)));
}

export function createBoard(root: HTMLElement): BoardHandle {
  const container = document.createElement("div");
  container.className = "rev-board";
  container.setAttribute("data-board", "");
  root.append(container);

  function paint(args: BoardRenderArgs): void {
    const {
      game,
      mover,
      lastMove = null,
      flipped = [],
      interactive,
      over = false,
      onSelect,
    } = args;
    const hintFor = args.hintFor === undefined ? mover : args.hintFor;

    container.classList.toggle("rev-board--over", over);

    const svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW} ${VIEW}`,
      class: "rev-board__svg",
      role: "group",
      "aria-label": `Reversi board, ${BOARD_SIZE} by ${BOARD_SIZE}`,
    });

    const surfaceLayer = svgEl("g", { class: "rev-board__surface-layer", "aria-hidden": "true" });
    const hintLayer = svgEl("g", { class: "rev-board__hints", "aria-hidden": "true" });
    const discLayer = svgEl("g", { class: "rev-board__discs", "aria-hidden": "true" });
    const previewLayer = svgEl("g", { class: "rev-board__preview", "aria-hidden": "true" });
    const cellLayer = svgEl("g", { class: "rev-board__cells" });
    svg.append(surfaceLayer, hintLayer, discLayer, previewLayer, cellLayer);

    drawSurface(surfaceLayer);

    // Legal moves for the hinted side, with their flip sets — computed once
    // per render and reused by the hints, the aria-labels and the hover
    // preview, so hovering never recomputes the rules.
    const flipsByCell = new Map<number, number[]>();
    if (hintFor !== null) {
      for (const cell of legalMoves(game, hintFor)) {
        flipsByCell.set(cell, computeFlips(game.board, cell, hintFor));
      }
    }

    const flippedSet = new Set(flipped);

    for (let cell = 0; cell < BOARD_CELLS; cell++) {
      const owner = game.board[cell];
      if (owner === null) continue;
      discLayer.append(
        disc(cell, owner, {
          placed: cell === lastMove,
          flipped: flippedSet.has(cell),
          distance: lastMove === null ? 0 : flipDistance(lastMove, cell),
        }),
      );
    }
    if (lastMove !== null && game.board[lastMove] !== null) {
      discLayer.append(
        svgEl("circle", {
          cx: String(centerX(lastMove)),
          cy: String(centerY(lastMove)),
          r: String(DISC_R + CELL * 0.09),
          class: "rev-disc__last-ring",
        }),
      );
    }

    for (const cell of flipsByCell.keys()) {
      hintLayer.append(
        svgEl("circle", {
          cx: String(centerX(cell)),
          cy: String(centerY(cell)),
          r: String(CELL * 0.11),
          class: `rev-hint rev-hint--p${(hintFor ?? 0) + 1}`,
          "data-hint": String(cell),
        }),
      );
    }

    // One shared ghost + one reusable pool of flip outlines: the preview
    // moves from cell to cell rather than being rebuilt on every pointer
    // event.
    const ghost = svgEl("circle", { r: String(DISC_R), class: "rev-ghost", "data-ghost": "" });
    ghost.style.display = "none";
    previewLayer.append(ghost);

    const clearPreview = () => {
      ghost.style.display = "none";
      previewLayer.querySelectorAll("[data-flip-outline]").forEach((n) => n.remove());
    };

    const showPreview = (cell: number) => {
      const flips = flipsByCell.get(cell);
      if (!flips || mover === null) return;
      clearPreview();
      ghost.setAttribute("cx", String(centerX(cell)));
      ghost.setAttribute("cy", String(centerY(cell)));
      ghost.setAttribute("class", `rev-ghost rev-ghost--p${mover + 1}`);
      ghost.style.display = "";
      for (const f of flips) {
        previewLayer.append(
          svgEl("circle", {
            cx: String(centerX(f)),
            cy: String(centerY(f)),
            r: String(DISC_R + CELL * 0.05),
            class: `rev-flip-outline rev-flip-outline--p${mover + 1}`,
            "data-flip-outline": String(f),
          }),
        );
      }
    };

    for (let cell = 0; cell < BOARD_CELLS; cell++) {
      const owner = game.board[cell];
      const flips = flipsByCell.get(cell);
      const canPick = interactive && !over && !!onSelect && flips !== undefined;

      const rect = svgEl("rect", {
        x: String(cellX(colOf(cell))),
        y: String(cellY(rowOf(cell))),
        width: String(CELL),
        height: String(CELL),
        class: `rev-cell${canPick ? " rev-cell--pick" : ""}`,
        "data-cell": String(cell),
        "aria-label": cellAriaLabel(cell, owner, flips),
      });

      if (canPick) {
        rect.setAttribute("role", "button");
        rect.setAttribute("tabindex", "0");
        const select = () => onSelect!(cell);
        rect.addEventListener("click", select);
        rect.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        });
        rect.addEventListener("pointerenter", () => showPreview(cell));
        rect.addEventListener("pointerleave", clearPreview);
        rect.addEventListener("focus", () => showPreview(cell));
        rect.addEventListener("blur", clearPreview);
      } else {
        rect.setAttribute("role", "img");
      }
      cellLayer.append(rect);
    }

    if (over) {
      // A narrow band parked just off the left edge; the CSS animation
      // translates it once across the board and fades it out.
      svg.append(
        svgEl("rect", {
          x: String(-VIEW * 0.4),
          y: String(-VIEW * 0.15),
          width: String(VIEW * 0.28),
          height: String(VIEW * 1.3),
          class: "rev-board__sweep",
          "data-sweep": "",
        }),
      );
    }

    container.innerHTML = "";
    container.append(svg);
  }

  return {
    container,
    render: paint,
    destroy() {
      container.remove();
    },
  };
}

/** The board plane, its hairline grid and the four star points. */
function drawSurface(layer: SVGGElement): void {
  layer.append(
    svgEl("rect", {
      x: String(PAD * 0.35),
      y: String(PAD * 0.35),
      width: String(BOARD_SPAN + PAD * 1.3),
      height: String(BOARD_SPAN + PAD * 1.3),
      rx: String(PAD),
      class: "rev-board__surface",
    }),
  );

  const grid = svgEl("g", { class: "rev-board__grid" });
  for (let i = 0; i <= BOARD_SIZE; i++) {
    grid.append(
      svgEl("line", {
        x1: String(cellX(i)),
        y1: String(cellY(0)),
        x2: String(cellX(i)),
        y2: String(cellY(BOARD_SIZE)),
        class: "rev-board__line",
      }),
      svgEl("line", {
        x1: String(cellX(0)),
        y1: String(cellY(i)),
        x2: String(cellX(BOARD_SIZE)),
        y2: String(cellY(i)),
        class: "rev-board__line",
      }),
    );
  }
  layer.append(grid);

  // The four standard Othello star points, at the corners of the central
  // 4x4 — i.e. the grid intersections two cells in from each corner.
  for (const row of [2, 6]) {
    for (const col of [2, 6]) {
      layer.append(
        svgEl("circle", {
          cx: String(cellX(col)),
          cy: String(cellY(row)),
          r: String(CELL * 0.045),
          class: "rev-board__star",
          "data-star": "",
        }),
      );
    }
  }
}

function disc(
  cell: number,
  owner: Player,
  state: { placed: boolean; flipped: boolean; distance: number },
): SVGCircleElement {
  const cls = ["rev-disc", `rev-disc--p${owner + 1}`];
  if (state.placed) cls.push("rev-disc--placed");
  if (state.flipped) cls.push("rev-disc--flip");

  const el = svgEl("circle", {
    cx: String(centerX(cell)),
    cy: String(centerY(cell)),
    r: String(DISC_R),
    class: cls.join(" "),
    "data-disc": String(cell),
    "data-owner": owner === 0 ? "dark" : "light",
  });

  if (state.flipped) {
    // The cascade: each step out from the placed disc delays this disc's
    // flip by FLIP_STAGGER_MS, so the capture radiates outward along its ray.
    el.style.animationDelay = `${state.distance * FLIP_STAGGER_MS}ms`;
    el.setAttribute("data-flip-step", String(state.distance));
  }
  return el;
}

function cellAriaLabel(cell: number, owner: Player | null, flips: number[] | undefined): string {
  const name = cellLabel(cell);
  if (owner !== null) return `${name} — ${discName(owner)} disc`;
  if (flips && flips.length > 0) return `${name} — flips ${discCount(flips.length)}`;
  return `${name} — empty`;
}
