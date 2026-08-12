import { describe, it, expect } from "vitest";
import { cellLabel, cellLabelAt, discCount, discName } from "./rev-format";
import { cellOf, DARK, LIGHT } from "../engine/revplay";

describe("cellLabel — standard Reversi notation", () => {
  it("names the four opening discs the way an Othello book does", () => {
    // revplay's initialBoard(): Dark at E4/D5, Light at D4/E5.
    expect(cellLabel(cellOf(3, 4))).toBe("e4");
    expect(cellLabel(cellOf(4, 3))).toBe("d5");
    expect(cellLabel(cellOf(3, 3))).toBe("d4");
    expect(cellLabel(cellOf(4, 4))).toBe("e5");
  });

  it("covers both corners of the board", () => {
    expect(cellLabel(0)).toBe("a1");
    expect(cellLabel(63)).toBe("h8");
  });

  it("matches cellLabelAt for the same square", () => {
    expect(cellLabelAt(2, 3)).toBe("d3");
    expect(cellLabelAt(2, 3)).toBe(cellLabel(cellOf(2, 3)));
  });
});

describe("copy helpers", () => {
  it("names the disc colours", () => {
    expect(discName(DARK)).toBe("dark");
    expect(discName(LIGHT)).toBe("light");
  });

  it("pluralises the flip count", () => {
    expect(discCount(1)).toBe("1 disc");
    expect(discCount(3)).toBe("3 discs");
    expect(discCount(0)).toBe("0 discs");
  });
});
