import { TILE } from "./config";
import { hardnessScaleAt, TILE_DEFS, type TileId } from "./tiles";
import type { Player } from "./player";
import type { World } from "./world";

export interface DigIntent {
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Digging rules (matching the original's feel):
 * - Only while grounded. No drilling upward.
 * - Down: hold down over a diggable tile beneath the pod.
 * - Sideways: hold into a wall you're pressed against, at the pod's own row.
 * - Progress accumulates at dt / (hardness / drillPower); switching targets
 *   or letting go resets it.
 *
 * Returns the tile removed this step, or null.
 */
export function updateDrilling(
  p: Player,
  world: World,
  intent: DigIntent,
  drillPower: number,
  dt: number,
  digAnything = false, // dev cheat: rock and bedrock become drillable
): TileId | null {
  const target = findTarget(p, world, intent, digAnything);
  if (!target) {
    p.hasDigTarget = false;
    p.digProgress = 0;
    return null;
  }

  if (!p.hasDigTarget || target.x !== p.digTargetX || target.y !== p.digTargetY) {
    p.digTargetX = target.x;
    p.digTargetY = target.y;
    p.hasDigTarget = true;
    p.digProgress = 0;
  }

  // Undiggable tiles use a stand-in hardness under the dev override.
  const base = TILE_DEFS[world.getTile(target.x, target.y)].hardness ?? 0.6;
  const hardness = base * hardnessScaleAt(target.y - world.surfaceRow);

  p.digProgress += (dt * drillPower) / hardness;
  if (p.digProgress < 1) return null;

  p.hasDigTarget = false;
  p.digProgress = 0;
  return world.dig(target.x, target.y, digAnything);
}

function findTarget(
  p: Player,
  world: World,
  intent: DigIntent,
  digAnything: boolean,
): { x: number; y: number } | null {
  const canDig = (x: number, y: number): boolean =>
    digAnything ? world.inBounds(x, y) && world.isSolid(x, y) : world.isDiggable(x, y);
  if (!p.grounded) return null;

  // Grounded means the pod's bottom sits exactly on a tile boundary, so the
  // pod occupies exactly one tile row (height <= TILE). +0.5 guards float noise.
  const centerCol = Math.floor((p.x + p.width / 2) / TILE);
  const belowRow = Math.floor((p.y + p.height + 0.5) / TILE);
  const podRow = belowRow - 1;

  if (intent.down && canDig(centerCol, belowRow)) {
    return { x: centerCol, y: belowRow };
  }
  if (intent.left && p.touchingLeft) {
    const col = Math.floor((p.x - 0.5) / TILE);
    if (canDig(col, podRow)) return { x: col, y: podRow };
  }
  if (intent.right && p.touchingRight) {
    const col = Math.floor((p.x + p.width + 0.5) / TILE);
    if (canDig(col, podRow)) return { x: col, y: podRow };
  }
  return null;
}
