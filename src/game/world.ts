import { gasChanceAt, lavaChanceAt } from "./hazards";
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
    this.tiles[y * this.width + x] = tile;
  }

  isSolid(x: number, y: number): boolean {
    return TILE_DEFS[this.getTile(x, y)].solid;
  }

  isDiggable(x: number, y: number): boolean {
    return TILE_DEFS[this.getTile(x, y)].hardness !== null;
  }

  /** Remove a diggable tile. Returns what was removed, or null if undiggable. */
  dig(x: number, y: number): TileId | null {
    if (!this.isDiggable(x, y)) return null;
    const tile = this.getTile(x, y);
    this.setTile(x, y, TileId.Empty);
    return tile;
  }
}
