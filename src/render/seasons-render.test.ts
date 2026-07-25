/**
 * The tests that make "adding a fifth season is a data change" actually true.
 *
 * A season row references an icon, a weather kind, and an audio voice *by name*,
 * because `game/` must not import from `render/` or `audio/`. That indirection
 * is what keeps the dependency direction right, but it also means a typo or an
 * unimplemented kind would fail silently at runtime — an invisible HUD icon, or
 * weather that never spawns. These assert the other end of every such link.
 *
 * All three are pure table lookups, so they run in the node environment with no
 * canvas or AudioContext.
 */
import { describe, expect, it } from "vitest";
import { AMBIENCE } from "../audio/engine";
import { SEASONS } from "../game/seasons";
import { ICON_IDS } from "./icons";
import { WEATHER_KINDS } from "./weather";

describe("season → render/audio wiring", () => {
  it("names an icon that icons.ts actually draws", () => {
    for (const season of SEASONS) {
      expect(ICON_IDS).toContain(season.look.iconId);
    }
  });

  it("names weather kinds the weather system knows how to spawn", () => {
    for (const season of SEASONS) {
      const { ambient, spell } = season.look.weather;
      if (ambient) expect(WEATHER_KINDS).toContain(ambient.kind);
      if (spell) expect(WEATHER_KINDS).toContain(spell.particle.kind);
    }
  });

  it("names an ambience voice the audio engine has an entry for", () => {
    for (const season of SEASONS) {
      expect(Object.keys(AMBIENCE)).toContain(season.sound.ambience.voice);
    }
  });
});
