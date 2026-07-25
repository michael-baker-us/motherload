import { describe, expect, it } from "vitest";
import { fitFontSize, wrapText } from "./text";

// Stand-in for ctx.measureText: every character is 10 units wide.
const measure = (s: string): number => s.length * 10;

describe("wrapText", () => {
  it("keeps a short line intact", () => {
    expect(wrapText("hold down to drill", 1000, measure)).toEqual(["hold down to drill"]);
  });

  it("breaks on words, never mid-word", () => {
    const lines = wrapText("steer off the platform then drill", 100, measure);
    expect(lines.every((l) => measure(l) <= 100 || !l.includes(" "))).toBe(true);
    expect(lines.join(" ")).toBe("steer off the platform then drill");
  });

  it("gives an over-long word its own line rather than hyphenating", () => {
    expect(wrapText("a supercalifragilistic b", 60, measure)).toEqual([
      "a",
      "supercalifragilistic",
      "b",
    ]);
  });

  it("survives a degenerate width", () => {
    expect(wrapText("anything", 0, measure)).toEqual(["anything"]);
  });
});

describe("fitFontSize", () => {
  it("keeps the preferred size when it already fits", () => {
    expect(fitFontSize(20, 10, 500, (s) => s * 10)).toBe(20);
  });

  it("shrinks proportionally to fit", () => {
    // width = size * 10 → 30 units wide at 3px, so 3px is the fit for 30.
    expect(fitFontSize(20, 1, 30, (s) => s * 10)).toBe(3);
  });

  it("never goes below the floor", () => {
    expect(fitFontSize(20, 12, 1, (s) => s * 10)).toBe(12);
  });
});
