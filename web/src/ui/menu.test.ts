import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderReversiMenu } from "./menu";

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderReversiMenu", () => {
  it("offers both modes and both variants, defaulting to vs Bot / classic", () => {
    void renderReversiMenu(root);

    expect(root.querySelector<HTMLInputElement>("#mode-vs-bot")!.checked).toBe(true);
    expect(root.querySelector<HTMLInputElement>("#mode-vs-friend")).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>("#variant-classic")!.checked).toBe(true);
    expect(root.querySelector<HTMLInputElement>("#variant-bidding")).not.toBeNull();
  });

  it("offers exactly one board — 8x8 — and calls the group 'Board', not 'Board size'", () => {
    void renderReversiMenu(root);

    const size = root.querySelector<HTMLInputElement>("#size-8")!;
    expect(size.checked).toBe(true);
    const group = size.closest("fieldset")!;
    expect(group.querySelectorAll("input[type=radio]")).toHaveLength(1);
    expect(group.querySelector(".menu__legend")!.textContent).toBe("Board");
  });

  it("resolves the player's choice when Play is pressed", async () => {
    const choice = renderReversiMenu(root);
    root.querySelector<HTMLInputElement>("#variant-bidding")!.checked = true;
    root.querySelector<HTMLFormElement>(".menu__form")!.dispatchEvent(new Event("submit"));

    await expect(choice).resolves.toEqual({ mode: "vs-bot", variant: "bidding" });
  });

  it("disables vs Friend with a reason while the browser is offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    void renderReversiMenu(root);

    const friend = root.querySelector<HTMLInputElement>("#mode-vs-friend")!;
    expect(friend.disabled).toBe(true);
    expect(root.querySelector<HTMLInputElement>("#mode-vs-bot")!.checked).toBe(true);
    expect(friend.closest(".menu-card")!.textContent).toContain("Offline");
  });
});
