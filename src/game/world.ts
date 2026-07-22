import { clamp } from "../engine/math";
import { WORLDGEN } from "./config";
import { gasChanceAt, lavaChanceAt } from "./hazards";
import { fbm2d, fieldMeanPow, fieldSamples, tailThreshold } from "./noise";
import { hash2d } from "./rng";
import { STATIONS } from "./stations";
import { MINERAL_BANDS, TILE_DEFS, TileId, bandChanceAt, rockChanceAt } from "./tiles";

// Distinct salts so each field/draw derived from the world seed is decorrelated
// from the others (rock masses, hazard speckle, and ore veins mustn't align).
const ROCK_FIELD = 0x9e3779b1;
const ROCK_DRAW = 0x85ebca6b;
const GAS_DRAW = 0xc2b2ae35;
const LAVA_DRAW = 0x27d4eb2f;
const VEIN_FIELD = 0x165667b1;
const VEIN_DRAW = 0xd3a2646c;
const CAVE_FIELD = 0x1b873593;

/**
 * The terrain: a flat Uint8Array of TileIds, row-major. At 60×2000 that's
 * ~120 KB — no chunking needed at this scale. Out-of-bounds reads return
 * Rock so the world edge behaves like solid bedrock everywhere.
 */
export class World {
  readonly tiles: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Every tile changed since generation (flat index → tile) — the save system's diff. */
  readonly changes = new Map<number, TileId>();

  // Seeds and normalisers for coherent placement, all derived from `seed`.
  private readonly rockFieldSeed: number;
  private readonly veinFieldSeed: number;
  private readonly caveFieldSeed: number;
  private readonly rockNorm: number;
  /** Empirical CDF of the vein field — turns a target area into a mask threshold. */
  private readonly veinCdf: Float64Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly surfaceRow: number,
    readonly seed: number,
    readonly tileSize: number,
  ) {
    this.tiles = new Uint8Array(width * height);
    this.pixelWidth = width * tileSize;
    this.pixelHeight = height * tileSize;

    this.rockFieldSeed = seed ^ ROCK_FIELD;
    this.veinFieldSeed = seed ^ VEIN_FIELD;
    this.caveFieldSeed = seed ^ CAVE_FIELD;
    // Normalise the placement weights so biasing ore/rock toward high field
    // values leaves the average spawn density equal to the chance curves.
    // The fBm field is stationary, so one estimate serves every mineral band.
    this.rockNorm = fieldMeanPow(
      (x, y) => fbm2d(x * WORLDGEN.rockFreq, y * WORLDGEN.rockFreq, this.rockFieldSeed),
      WORLDGEN.rockSharp,
    );
    this.veinCdf = fieldSamples((x, y) =>
      fbm2d(x * WORLDGEN.veinFreq, y * WORLDGEN.veinFreq, this.veinFieldSeed),
    );

    this.generate();
  }

  private generate(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y * this.width + x] = this.rollTile(x, y);
      }
    }
    // Bedrock strip under the whole station district — shops and the ground
    // between them — so none of it can be undermined. Written directly (not
    // via setTile) so it's part of generation, not the save diff.
    const stripX0 = Math.min(...STATIONS.map((s) => s.x0));
    const stripX1 = Math.max(...STATIONS.map((s) => s.x1));
    for (let x = Math.max(0, stripX0); x <= stripX1 && x < this.width; x++) {
      for (let y = this.surfaceRow; y <= this.surfaceRow + 1 && y < this.height; y++) {
        this.tiles[y * this.width + x] = TileId.Rock;
      }
    }
  }

  /**
   * Pick a tile purely from its coordinates. Rock and ore keep the average
   * density of the chance curves, but a smooth noise field biases where they
   * land so rock forms masses and ore forms veins. `weight` averages to 1 over
   * space (that's what `*Norm` guarantees), so `chance * weight` preserves the
   * expected count while concentrating it into the field's hotspots.
   */
  private rollTile(x: number, y: number): TileId {
    if (y < this.surfaceRow) return TileId.Sky;
    // Bedrock border: side walls and floor are undiggable.
    if (x === 0 || x === this.width - 1 || y === this.height - 1) return TileId.Rock;

    const depth = y - this.surfaceRow;

    // Caves: carve air where a broad, low-frequency field peaks. The threshold
    // eases down with depth so caverns grow roomier further from the surface,
    // and there are none in the intro zone. Air overrides rock and ore, so
    // caves read as open chambers whose walls you can still mine.
    if (depth >= WORLDGEN.caveMinDepth) {
      const t = clamp((depth - WORLDGEN.caveMinDepth) / WORLDGEN.caveDepthFull, 0, 1);
      const threshold = WORLDGEN.caveThresholdNear + (WORLDGEN.caveThresholdDeep - WORLDGEN.caveThresholdNear) * t;
      const cave = fbm2d(x * WORLDGEN.caveFreq, y * WORLDGEN.caveFreq, this.caveFieldSeed);
      if (cave > threshold) return TileId.Empty;
    }

    const rockBase = rockChanceAt(depth);
    if (rockBase > 0) {
      const f = fbm2d(x * WORLDGEN.rockFreq, y * WORLDGEN.rockFreq, this.rockFieldSeed);
      const weight = Math.min(WORLDGEN.rockCap, f ** WORLDGEN.rockSharp / this.rockNorm);
      if (hash2d(x, y, ROCK_DRAW ^ this.seed) < rockBase * weight) return TileId.Rock;
    }

    // Hazards stay sparse speckle — a hidden trap shouldn't clump into a wall.
    if (hash2d(x, y, GAS_DRAW ^ this.seed) < gasChanceAt(depth)) return TileId.GasPocket;
    if (hash2d(x, y, LAVA_DRAW ^ this.seed) < lavaChanceAt(depth)) return TileId.Lava;

    // Ore veins: each mineral occupies vein regions where its field crosses a
    // threshold; fill feathers from a sparse edge to a dense core. First band
    // to hit wins (same precedence as the old roll).
    const meanFill = (WORLDGEN.veinFillMin + WORLDGEN.veinFillMax) / 2;
    for (const band of MINERAL_BANDS) {
      const base = bandChanceAt(band, depth);
      if (base <= 0) continue;
      // Vein area that reproduces this mineral's average density given the fill.
      const area = Math.min(0.5, (base / meanFill) * WORLDGEN.veinAreaScale);
      const thr = tailThreshold(this.veinCdf, area);
      const fieldSeed = (this.veinFieldSeed + band.tile * 0x9e3779b1) | 0;
      const f = fbm2d(x * WORLDGEN.veinFreq, y * WORLDGEN.veinFreq, fieldSeed);
      if (f <= thr) continue;
      // 0 at the vein edge → 1 at its core.
      const edge = (f - thr) / (1 - thr);
      const fill = WORLDGEN.veinFillMin + (WORLDGEN.veinFillMax - WORLDGEN.veinFillMin) * edge;
      const drawSeed = ((VEIN_DRAW ^ this.seed) + band.tile * 0x85ebca6b) | 0;
      if (hash2d(x, y, drawSeed) < fill) return band.tile;
    }
    return TileId.Dirt;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTile(x: number, y: number): TileId {
    if (!this.inBounds(x, y)) return TileId.Rock;
    return this.tiles[y * this.width + x] as TileId;
  }

  setTile(x: number, y: number, tile: TileId): void {
    if (!this.inBounds(x, y)) return;
    const index = y * this.width + x;
    this.tiles[index] = tile;
    this.changes.set(index, tile);
  }

  isSolid(x: number, y: number): boolean {
    return TILE_DEFS[this.getTile(x, y)].solid;
  }

  isDiggable(x: number, y: number): boolean {
    return TILE_DEFS[this.getTile(x, y)].hardness !== null;
  }

  /**
   * Dynamite: destroy every solid tile within `radius` (euclidean, in tiles)
   * of the blast-centre tile — rock included, which is dynamite's whole point.
   * Protected: the bedrock border walls/floor, and rock in the top two ground
   * rows (the station strip must never be undermined). Destroyed minerals are
   * gone, not collected. Returns the tiles destroyed.
   */
  blast(cx: number, cy: number, radius: number): TileId[] {
    const destroyed: TileId[] = [];
    const r = Math.ceil(radius);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        if (!this.inBounds(x, y) || !this.isSolid(x, y)) continue;
        if (x === 0 || x === this.width - 1 || y === this.height - 1) continue;
        if (y <= this.surfaceRow + 1 && !this.isDiggable(x, y)) continue;
        destroyed.push(this.getTile(x, y));
        this.setTile(x, y, TileId.Empty);
      }
    }
    return destroyed;
  }

  /**
   * Remove a diggable tile. Returns what was removed, or null if undiggable.
   * `force` (dev cheat) digs any solid in-bounds tile, rock included.
   */
  dig(x: number, y: number, force = false): TileId | null {
    if (!this.inBounds(x, y)) return null;
    const tile = this.getTile(x, y);
    if (!TILE_DEFS[tile].solid) return null;
    if (!force && TILE_DEFS[tile].hardness === null) return null;
    this.setTile(x, y, TileId.Empty);
    return tile;
  }
}
