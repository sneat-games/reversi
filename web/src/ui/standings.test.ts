import { describe, it, expect, beforeEach } from "vitest";
import { createStandingsButton, openStandingsPanel, recordVsBotResult, vsBotRecord } from "./standings";

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("local vs-Bot record", () => {
  it("starts empty", () => {
    expect(vsBotRecord()).toEqual({ wins: 0, losses: 0, draws: 0 });
  });

  it("keeps three buckets — Reversi draws, unlike Hex", () => {
    recordVsBotResult("win");
    recordVsBotResult("win");
    recordVsBotResult("loss");
    recordVsBotResult("draw");
    expect(vsBotRecord()).toEqual({ wins: 2, losses: 1, draws: 1 });
  });

  it("survives a reload — it is stored, not in memory", () => {
    recordVsBotResult("win");
    expect(JSON.parse(localStorage.getItem("reversi:standings:vs-bot")!)).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it("ignores a corrupted entry instead of throwing", () => {
    localStorage.setItem("reversi:standings:vs-bot", "not json");
    expect(vsBotRecord()).toEqual({ wins: 0, losses: 0, draws: 0 });
  });
});

describe("standings panel", () => {
  it("opens from the header trophy button", () => {
    const btn = createStandingsButton();
    document.body.append(btn.el);
    btn.el.click();
    expect(document.querySelector("[data-standings-overlay]")).not.toBeNull();
  });

  it("shows the REAL local record and labels the ladder as a preview", () => {
    recordVsBotResult("win");
    recordVsBotResult("draw");
    openStandingsPanel();

    const record = document.querySelector("[data-standings-record]")!;
    expect(record.textContent).toContain("1W");
    expect(record.textContent).toContain("0L");
    expect(record.textContent).toContain("1D");
    expect(document.querySelector(".standings-panel__badge")!.textContent).toBe(
      "Powered by Competios — coming soon",
    );
    expect(document.querySelectorAll(".standings-panel__ladder-list li")).toHaveLength(5);
  });

  it("closes on Escape", () => {
    openStandingsPanel();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("[data-standings-overlay]")).toBeNull();
  });
});
