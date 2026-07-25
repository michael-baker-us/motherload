import { afterEach, describe, expect, it } from "vitest";
import { itemsAsRow, layout, TOUCH_EDGE, TOUCH_ITEM_SIZE, touchReserve } from "./layout";

// The layout singleton is shared across tests — `measureLayout` needs a DOM, so
// these drive the fields directly and put them back afterwards.
const original = { ...layout };
afterEach(() => Object.assign(layout, original));

describe("touch control reserve", () => {
  it("reserves nothing without touch controls mounted", () => {
    Object.assign(layout, { touch: false, vh: 844 });
    expect(touchReserve()).toEqual({ top: 0, right: 0 });
  });

  it("reserves the right edge on a tall screen, where items are a column", () => {
    Object.assign(layout, { touch: true, vh: 844 });
    expect(itemsAsRow()).toBe(false);
    expect(touchReserve()).toEqual({ top: 0, right: TOUCH_EDGE + TOUCH_ITEM_SIZE });
  });

  it("reserves the top edge on a short screen, where items become a row", () => {
    Object.assign(layout, { touch: true, vh: 390 });
    expect(itemsAsRow()).toBe(true);
    expect(touchReserve()).toEqual({ top: TOUCH_EDGE + TOUCH_ITEM_SIZE, right: 0 });
  });

  it("never reserves both edges at once", () => {
    for (const vh of [320, 519, 520, 844, 1180]) {
      Object.assign(layout, { touch: true, vh });
      const r = touchReserve();
      expect(Math.min(r.top, r.right)).toBe(0);
    }
  });
});
