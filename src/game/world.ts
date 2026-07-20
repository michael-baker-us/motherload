import { gasChanceAt, lavaChanceAt } from "./hazards";
import { STATIONS } from "./stations";
import { MINERAL_BANDS, TILE_DEFS, TileId, bandChanceAt, rockChanceAt } from "./tiles";
import { mulberry32 } from "./rng";

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
    this.generate();
  }

  private generate(): void {
    const rand = mulberry32(this.seed);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.tiles[y * this.width + x] = this.rollTile(x, y, rand);
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

  private rollTile(x: number, y: number, rand: () => number): TileId {
    if (y < this.surfaceRow) return TileId.Sky;
    // Bedrock border: side walls and floor are undiggable.
    if (x === 0 || x === this.width - 1 || y === this.height - 1) return TileId.Rock;

    const depth = y - this.surfaceRow;
    if (rand() < rockChanceAt(depth)) return TileId.Rock;
    if (rand() < gasChanceAt(depth)) return TileId.GasPocket;
    if (rand() < lavaChanceAt(depth)) return TileId.Lava;
    for (const band of MINERAL_BANDS) {
      if (rand() < bandChanceAt(band, depth)) return band.tile;
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
