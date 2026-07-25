/**
 * Seasons — the per-run identity of the surface world. Each layers a distinct
 * sky, treeline, colour grade, weather, ambience and a handful of small gameplay
 * modifiers over the depth biomes (biomes.ts) and material strata (tiles.ts).
 *
 * A season is CHOSEN BY THE PLAYER AT NEW GAME and is FIXED FOR THAT RUN. It has
 * to be fixed: `world` below feeds worldgen, and save.ts reconstructs the world
 * by re-running worldgen from the seed, so a season that changed mid-run would
 * silently mutate untouched terrain across a save/load. Picking it up front also
 * means the season is known *before* `new World(...)` is constructed, which makes
 * the whole thing deterministic for free.
 *
 * Hence the explicit two-field split:
 *   - `world`   — baked into terrain at World construction. Read ONCE, in
 *                 world.ts's rollTile. Captured in the save alongside the seed.
 *   - `runtime` — read fresh every sim step. Safe to change at any time; a dev
 *                 season switch only ever touches this half plus the visuals.
 *
 * Adding a fifth season = appending a row here. Everything downstream — sky,
 * flora, grade, weather, audio, HUD chip, title picker, dev switcher — is
 * table-driven off this, and seasons.test.ts / render/seasons-render.test.ts
 * fail loudly if a new row references an icon, weather kind or voice that
 * nobody implemented.
 *
 * Data only: colour strings and number tuples, no DOM — same as biomes.ts.
 * `game/` must never import from `render/`, so the HUD icon is typed as a plain
 * string and validated by a render-side test.
 */
import { SEASON } from "./config";
import { TileId } from "./tiles";

export type SeasonId = "spring" | "summer" | "autumn" | "winter";

// --- Gameplay ------------------------------------------------------------

/**
 * A seasonal pocket of filler material — spring meltwater, winter ice. Placed
 * during worldgen, replacing the plain stratum filler *only*, so a pocket can
 * never eat an ore vein, block a cave, or create an undiggable wall.
 */
export interface SeasonPocket {
  tile: TileId;
  /** Fraction of the band's area the pockets occupy, 0–1 (like a vein's area). */
  area: number;
  minDepth: number;
  maxDepth: number;
}

/** Baked into terrain at World construction. Changing these mid-run desyncs saves. */
export interface SeasonWorld {
  /** Multiplier on the lava spawn chance curve. 1 = unchanged. */
  lavaChanceMult: number;
  /** Multiplier on WORLDGEN.veinAreaScale. >1 = richer, more findable veins. */
  oreAreaMult: number;
  /** Seasonal filler pocket, or null for none. */
  pocket: SeasonPocket | null;
}

/** Read fresh every sim step. No save impact. */
export interface SeasonRuntime {
  /**
   * Added to the biome's ambient heat, units/s. Negative = a cold season.
   * An *offset*, not a multiplier: biome heat is 0 at the surface, so a
   * multiplier could never make a summer surface hot.
   */
  ambientHeat: number;
  /** Multiplier on radiator cooling (heat.ts). >1 = harder to overheat. */
  coolMult: number;
  /** Multiplier on all fuel burn. >1 = worse efficiency. */
  burnMult: number;
  /** Multiplier on SEASON.wind.accel — surface gust strength. 0 = calm. */
  gust: number;
}

// --- Presentation (never read by the sim) --------------------------------

export interface SkyPalette {
  /** Four vertical stops, top → bottom. */
  gradient: readonly [string, string, string, string];
  /** [top, bottom] fill per parallax ridge, far → near. Must be length 3. */
  ridges: readonly (readonly [string, string])[];
  /** Star brightness multiplier — 0 hides them entirely in bright daylight. */
  stars: number;
  /** `rise` is px above the horizon: a low sun reads as long autumn light. */
  sun: { core: string; mid: string; rise: number; radius: number };
  moon: number;
  haze: { color: string; alpha: number };
  cloud: { color: string; count: number; alpha: number };
  /** Distant industrial skyline silhouette. */
  structure: string;
}

export type FloraKind = "blossom" | "leafy" | "autumn" | "bare";

export interface FloraPalette {
  kind: FloraKind;
  /** Flat silhouette colour for the distant treeline inside the sky. */
  treeline: string;
  trunk: string;
  /** Canopy tones, picked per tree. Ignored by the "bare" painter. */
  canopy: readonly string[];
  /** Blossom / berry / snow-cap accent, or null. */
  accent: string | null;
  /**
   * Ground cover painted along the top of every solid tile exposed to the sky —
   * grass, leaf litter, snow. `depth` is how far down the tile it reaches (of
   * 32px) and `alpha` how opaque its top edge is, so a season can range from a
   * faint sunlit rim to a thick snow blanket.
   */
  ground: { rgb: string; depth: number; alpha: number };
}

/**
 * The seasonal character of the near-surface earth itself — not a wash over it.
 * Worked into the topsoil stratum as its own texture (frost veins, root mats,
 * dried cracks) and blended back to the neutral rock over `depth` tiles, so the
 * ground you dig through for the first stretch of a run belongs to its season
 * and the transition is a gradient rather than a line.
 */
export interface TopsoilPalette {
  /** Tiles over which the seasonal earth fades back to the plain stratum. */
  depth: number;
  /** Base earth tone for the band. */
  color: string;
  /** Threads worked through it — roots, frost, cracks, buried leaf litter. */
  vein: string;
  /** Small specks scattered through the band. */
  fleck: string;
  /** How completely the seasonal earth replaces the plain stratum, 0–1. */
  strength: number;
}

export type WeatherKind = "petal" | "leaf" | "flake" | "mote" | "rain";

export interface ParticleSpec {
  kind: WeatherKind;
  /** Multiplier on SEASON.weather.ratePerSec. */
  rate: number;
  colors: readonly string[];
  /** Fall speed range, px/s. Negative rises (pollen). */
  vy: readonly [number, number];
  vx: readonly [number, number];
  gravity: number;
  /** Peak horizontal sway, px/s — leaves swing, snow wanders. */
  drift: number;
  driftHz: number;
  /** Rotation rad/s; 0 for the square kinds. */
  spin: number;
  size: readonly [number, number];
  life: readonly [number, number];
  additive: boolean;
}

export interface SeasonWeather {
  /** Always-on drifting particles. */
  ambient: ParticleSpec | null;
  /** Occasional weather event on an on/off duty cycle — spring's rain squalls. */
  spell: {
    particle: ParticleSpec;
    onSeconds: number;
    offSeconds: number;
    tint: string;
    tintAlpha: number;
  } | null;
  /** Depth (tiles) below the surface where weather fades to nothing. */
  depth: number;
}

export interface GradeSpec {
  /** Multiply wash — pulls the shadows toward this hue. × SEASON.grade.tintAlpha. */
  tint: readonly [number, number, number];
  tintScale: number;
  /** Additive highlight lift. × SEASON.grade.liftAlpha. */
  lift: readonly [number, number, number];
  liftScale: number;
  /** The biome fog colour is pulled toward this. × SEASON.fogMix. */
  fog: readonly [number, number, number];
  /** Ambient darkness floor at the surface — winter's short, dim days. 0–1. */
  surfaceDark: number;
  /** Warm/cool bias for the headlamp halo. */
  lampTint: readonly [number, number, number];
  /** Extra heat-shimmer strength at the surface, on top of the magma biome's. */
  heatHaze: number;
}

export interface SeasonLook {
  /** HUD chip and title-picker accent. */
  accent: string;
  /**
   * Key of render/icons.ts's DRAW table. Typed as a plain string so the
   * game → render dependency can't invert; a render-side test validates it.
   */
  iconId: string;
  sky: SkyPalette;
  flora: FloraPalette;
  /** Seasonal near-surface earth, or null to leave the stratum untouched. */
  topsoil: TopsoilPalette | null;
  weather: SeasonWeather;
  grade: GradeSpec;
}

export type SeasonVoice = "birds" | "insects" | "gust" | "none";

export interface SeasonSound {
  /**
   * The surface wind bed (audio/engine.ts's `wind` LoopVoice). `type` is a plain
   * union so game/ needn't name the DOM's BiquadFilterType.
   */
  wind: { gain: number; freq: number; type: "lowpass" | "bandpass" | "highpass" };
  ambience: { voice: SeasonVoice; gain: number };
  /** Depth (tiles) below which surface ambience is inaudible. */
  surfaceDepth: number;
}

export interface Season {
  id: SeasonId;
  name: string;
  /** Short all-caps subtitle for the title screen. */
  tagline: string;
  /** One-line summary of this season's modifiers, for the pause menu. */
  summary: string;
  /** Flavour line appended to the briefing screen. */
  briefing: string;
  world: SeasonWorld;
  runtime: SeasonRuntime;
  look: SeasonLook;
  sound: SeasonSound;
}

// --- The table -----------------------------------------------------------

const SPRING: Season = {
  id: "spring",
  name: "Spring",
  tagline: "THE THAW",
  summary: "Meltwater pockets underground · the radiator runs cool",
  briefing: "The thaw has come. Meltwater seeps through the upper strata.",
  world: {
    lavaChanceMult: 1,
    oreAreaMult: 1,
    pocket: { tile: TileId.Water, area: 0.06, minDepth: 8, maxDepth: 90 },
  },
  runtime: { ambientHeat: 0, coolMult: 1.25, burnMult: 1, gust: 0 },
  look: {
    accent: "#a8dc8a",
    iconId: "seasonSpring",
    sky: {
      gradient: ["#4d7cbe", "#87b2dc", "#c6dfe8", "#dcecca"],
      ridges: [
        ["#8fae7a", "#6f9160"],
        ["#5f8452", "#47673f"],
        ["#3d5c39", "#2b4328"],
      ],
      stars: 0.15,
      sun: { core: "#fff8dc", mid: "#ffeaa8", rise: 104, radius: 112 },
      moon: 0.25,
      haze: { color: "#d8ecc4", alpha: 0.22 },
      cloud: { color: "255,255,255", count: 6, alpha: 0.2 },
      structure: "rgba(38,34,26,0.85)",
    },
    flora: {
      kind: "blossom",
      treeline: "#4a6b42",
      trunk: "#5a4433",
      canopy: ["#7fb05f", "#98c46e", "#6a9a52"],
      accent: "#ffd7e8",
      ground: { rgb: "150,205,110", depth: 11, alpha: 0.72 },
    },
    topsoil: {
      depth: 24,
      color: "#7d4a2a", // rain-darkened earth
      vein: "#6f9e52", // root threads reaching down from the new growth
      fleck: "#a8d47a",
      strength: 0.8,
    },
    weather: {
      ambient: {
        kind: "petal",
        rate: 0.8,
        colors: ["#ffd7e8", "#fff2f6", "#ffe9b8"],
        vy: [-9, 6],
        vx: [-10, 10],
        gravity: -2,
        drift: 20,
        driftHz: 0.45,
        spin: 1.6,
        size: [1.2, 2.6],
        life: [4, 8],
        additive: false,
      },
      spell: {
        particle: {
          kind: "rain",
          rate: 3.4,
          colors: ["#bcd8ea", "#9fc4dd"],
          vy: [420, 560],
          vx: [-24, -8],
          gravity: 120,
          drift: 0,
          driftHz: 0,
          spin: 0,
          size: [1, 1.8],
          life: [0.7, 1.1],
          additive: false,
        },
        onSeconds: 16,
        offSeconds: 42,
        tint: "#5f7f9a",
        tintAlpha: 0.16,
      },
      depth: 26,
    },
    grade: {
      tint: [150, 190, 140],
      tintScale: 0.7,
      lift: [180, 220, 160],
      liftScale: 1,
      fog: [10, 14, 8],
      surfaceDark: 0,
      lampTint: [255, 200, 130],
      heatHaze: 0,
    },
  },
  sound: {
    wind: { gain: 0.7, freq: 340, type: "bandpass" },
    ambience: { voice: "birds", gain: 1 },
    surfaceDepth: 14,
  },
};

const SUMMER: Season = {
  id: "summer",
  name: "Summer",
  tagline: "THE SWELTER",
  summary: "Hotter at every depth · lava runs closer to the surface",
  briefing: "High summer. The rock holds its heat long after dark.",
  world: { lavaChanceMult: 1.6, oreAreaMult: 1, pocket: null },
  runtime: { ambientHeat: 4, coolMult: 1, burnMult: 1, gust: 0 },
  look: {
    accent: "#ffd764",
    iconId: "seasonSummer",
    sky: {
      gradient: ["#1a58aa", "#3a80cc", "#7cb4df", "#cfe6ef"],
      ridges: [
        ["#6e9457", "#547a45"],
        ["#456b3c", "#31512d"],
        ["#26401f", "#182c14"],
      ],
      stars: 0,
      sun: { core: "#ffffff", mid: "#fff3c0", rise: 152, radius: 136 },
      moon: 0,
      haze: { color: "#d6ecf4", alpha: 0.1 },
      cloud: { color: "255,255,255", count: 3, alpha: 0.13 },
      structure: "rgba(28,30,22,0.88)",
    },
    flora: {
      kind: "leafy",
      treeline: "#2f5228",
      trunk: "#4a3a26",
      canopy: ["#4f8438", "#63a046", "#3d6a2c"],
      accent: null,
      ground: { rgb: "104,170,60", depth: 10, alpha: 0.8 },
    },
    topsoil: {
      depth: 16,
      color: "#b0743d", // sun-bleached, dried out
      vein: "#89511f", // shrinkage cracks
      fleck: "#dcb87c",
      strength: 0.75,
    },
    weather: {
      ambient: {
        kind: "mote",
        rate: 0.7,
        colors: ["#ffe9b0", "#ffd98a"],
        vy: [-5, 3],
        vx: [-7, 7],
        gravity: -1,
        drift: 11,
        driftHz: 0.22,
        spin: 0,
        size: [0.9, 1.7],
        life: [4, 9],
        additive: true,
      },
      spell: null,
      depth: 22,
    },
    grade: {
      tint: [210, 175, 120],
      tintScale: 0.75,
      lift: [255, 235, 170],
      liftScale: 1.25,
      fog: [22, 12, 5],
      surfaceDark: 0,
      lampTint: [255, 210, 140],
      heatHaze: 0.035,
    },
  },
  sound: {
    wind: { gain: 0.45, freq: 240, type: "lowpass" },
    ambience: { voice: "insects", gain: 1 },
    surfaceDepth: 12,
  },
};

const AUTUMN: Season = {
  id: "autumn",
  name: "Autumn",
  tagline: "THE TURNING",
  summary: "Richer ore veins · gusting wind near the surface",
  briefing: "The turning. Prospectors swear the veins run richer this time of year.",
  world: { lavaChanceMult: 1, oreAreaMult: 1.25, pocket: null },
  runtime: { ambientHeat: 0, coolMult: 1, burnMult: 1, gust: 1 },
  look: {
    accent: "#f0a24a",
    iconId: "seasonAutumn",
    sky: {
      gradient: ["#39477a", "#7a6a94", "#c78d68", "#e8b57a"],
      ridges: [
        ["#a9713f", "#8a5530"],
        ["#7b442a", "#5d321f"],
        ["#4c2a1b", "#31190f"],
      ],
      stars: 0.45,
      sun: { core: "#ffe7b0", mid: "#ffb774", rise: 68, radius: 124 },
      moon: 0.6,
      haze: { color: "#e0a06a", alpha: 0.34 },
      cloud: { color: "255,224,198", count: 5, alpha: 0.16 },
      structure: "rgba(34,20,15,0.9)",
    },
    flora: {
      kind: "autumn",
      treeline: "#7a4526",
      trunk: "#4f3722",
      canopy: ["#d2762a", "#e0a03a", "#a8442a"],
      accent: "#f0c04a",
      ground: { rgb: "182,104,42", depth: 9, alpha: 0.7 },
    },
    topsoil: {
      depth: 20,
      color: "#77361a", // dark, rich, rain-fed — well clear of plain dirt
      vein: "#d2762a", // leaf litter worked into the soil
      fleck: "#edb14a",
      strength: 0.8,
    },
    weather: {
      ambient: {
        kind: "leaf",
        rate: 1,
        colors: ["#d2762a", "#e0a03a", "#a8442a", "#c05a24"],
        vy: [22, 46],
        vx: [-16, 16],
        gravity: 14,
        drift: 42,
        driftHz: 0.7,
        spin: 3.2,
        size: [2.2, 3.8],
        life: [5, 9],
        additive: false,
      },
      spell: null,
      depth: 26,
    },
    grade: {
      tint: [215, 150, 95],
      tintScale: 1,
      lift: [255, 195, 130],
      liftScale: 1,
      fog: [20, 11, 6],
      surfaceDark: 0.05,
      lampTint: [255, 185, 105],
      heatHaze: 0,
    },
  },
  sound: {
    wind: { gain: 1.5, freq: 420, type: "bandpass" },
    ambience: { voice: "gust", gain: 1 },
    surfaceDepth: 16,
  },
};

const WINTER: Season = {
  id: "winter",
  name: "Winter",
  tagline: "THE LONG DARK",
  summary: "Ice pockets quench heat · fuel burns faster in the cold",
  briefing: "The long dark. Fuel lines run thick and the ground is frozen through.",
  world: {
    lavaChanceMult: 1,
    oreAreaMult: 1,
    pocket: { tile: TileId.Ice, area: 0.07, minDepth: 6, maxDepth: 140 },
  },
  runtime: { ambientHeat: -2, coolMult: 1.35, burnMult: 1.15, gust: 0.5 },
  look: {
    accent: "#b8dcf0",
    iconId: "seasonWinter",
    sky: {
      gradient: ["#46566e", "#6b7a8e", "#98a5b3", "#c9d3da"],
      // Snow-covered hills read *lighter* than the rock they cover.
      ridges: [
        ["#b9c4cd", "#93a1ad"],
        ["#7d8b98", "#5e6b78"],
        ["#4a5560", "#313a43"],
      ],
      stars: 0.3,
      sun: { core: "#e8eef4", mid: "#cbd8e2", rise: 58, radius: 96 },
      moon: 0.8,
      haze: { color: "#c9d3da", alpha: 0.3 },
      cloud: { color: "222,232,242", count: 8, alpha: 0.26 },
      structure: "rgba(30,36,44,0.88)",
    },
    flora: {
      kind: "bare",
      treeline: "#5a6570",
      trunk: "#4a4038",
      canopy: [],
      accent: "#e8f0f6",
      ground: { rgb: "238,247,255", depth: 14, alpha: 0.95 },
    },
    topsoil: {
      // Frost drives deepest of the four — the frozen band is winter's real
      // presence underground, not just a white line at the surface.
      depth: 34,
      color: "#7e808c", // earth frozen grey-blue
      vein: "#cfe4f0", // ice lenses
      fleck: "#ffffff",
      strength: 0.88,
    },
    weather: {
      ambient: {
        kind: "flake",
        rate: 1.3,
        colors: ["#ffffff", "#e2eef7", "#cfe0ee"],
        vy: [26, 52],
        vx: [-12, 12],
        gravity: 6,
        drift: 30,
        driftHz: 0.35,
        spin: 0,
        size: [1, 2.2],
        life: [5, 9],
        additive: false,
      },
      spell: null,
      depth: 30,
    },
    grade: {
      tint: [130, 160, 195],
      tintScale: 1.1,
      lift: [200, 225, 250],
      liftScale: 0.8,
      fog: [8, 12, 20],
      surfaceDark: 0.12,
      lampTint: [220, 235, 255],
      heatHaze: 0,
    },
  },
  sound: {
    wind: { gain: 1.2, freq: 620, type: "highpass" },
    ambience: { voice: "gust", gain: 0.7 },
    surfaceDepth: 18,
  },
};

export const SEASONS: readonly Season[] = [SPRING, SUMMER, AUTUMN, WINTER];

export const SEASONS_BY_ID: Record<SeasonId, Season> = {
  spring: SPRING,
  summer: SUMMER,
  autumn: AUTUMN,
  winter: WINTER,
};

export const DEFAULT_SEASON: SeasonId = "spring";

export function isSeasonId(v: unknown): v is SeasonId {
  return typeof v === "string" && v in SEASONS_BY_ID;
}

/** Resolve a season by id, falling back to the default for anything unknown. */
export function seasonById(id: unknown): Season {
  return isSeasonId(id) ? SEASONS_BY_ID[id] : SEASONS_BY_ID[DEFAULT_SEASON];
}

export function seasonIndexById(id: unknown): number {
  const season = seasonById(id);
  return SEASONS.indexOf(season);
}

const TAU = Math.PI * 2;

/**
 * Surface gust acceleration (px/s², signed) at `depth` tiles and run-time `time`.
 * Deterministic in `time` (fed from Game.runTime) so it's reproducible and
 * testable; two incommensurate sines make it read as gusty rather than metronomic.
 * Shared by physics and audio so the felt gust and the heard gust are one gust.
 */
export function windAccelAt(season: Season, depth: number, time: number): number {
  const g = season.runtime.gust;
  if (g === 0 || depth >= SEASON.wind.depth) return 0;
  const falloff = 1 - depth / SEASON.wind.depth;
  const wave =
    Math.sin(time * SEASON.wind.gustHz * TAU) * 0.6 +
    Math.sin(time * SEASON.wind.gustHz * 2.7 * TAU + 1.3) * 0.4;
  return SEASON.wind.accel * g * falloff * wave * SEASON.windStrength;
}

/**
 * Blend a biome's fog colour toward the season's. One value feeds both
 * `Lighting.apply` and `PostFX.depthHaze`, which already take an [r,g,b].
 */
export function seasonFog(
  fog: readonly [number, number, number],
  season: Season,
): [number, number, number] {
  const t = SEASON.fogMix;
  const s = season.look.grade.fog;
  return [
    fog[0] + (s[0] - fog[0]) * t,
    fog[1] + (s[1] - fog[1]) * t,
    fog[2] + (s[2] - fog[2]) * t,
  ];
}
