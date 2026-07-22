import { describe, expect, it } from "vitest";
import { BIOMES, biomeAt, biomeIndexAt } from "./biomes";

describe("biomes", () => {
  it("returns the deepest biome whose minDepth has been passed", () => {
    expect(biomeAt(0).name).toBe("Topsoil");
    expect(biomeAt(59).name).toBe("Topsoil");
    expect(biomeAt(60).name).toBe("The Caverns");
    expect(biomeAt(300).name).toBe("Magma Depths");
    expect(biomeAt(9999).name).toBe("The Deep");
  });

  it("indexes monotonically with depth", () => {
    expect(biomeIndexAt(0)).toBe(0);
    expect(biomeIndexAt(70)).toBe(1);
    expect(biomeIndexAt(800)).toBe(BIOMES.length - 1);
    for (let d = 0, prev = 0; d < 1200; d += 10) {
      const i = biomeIndexAt(d);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
});
