import { TILE_DEFS, type TileId } from "../game/tiles";

export interface HudData {
  depth: number;
  minerals: ReadonlyMap<TileId, number>;
}

export function drawHud(ctx: CanvasRenderingContext2D, data: HudData): void {
  const lines: string[] = [`DEPTH ${data.depth} m`];
  for (const [tile, count] of data.minerals) {
    lines.push(`${TILE_DEFS[tile].name} × ${count}`);
  }

  ctx.font = "14px monospace";
  ctx.textBaseline = "top";

  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(8, 8, width, lines.length * 18 + 10);

  ctx.fillStyle = "#ffffff";
  lines.forEach((line, i) => {
    ctx.fillText(line, 16, 14 + i * 18);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fillText("← → fly/dig · ↑ thrust · ↓ drill", 16, ctx.canvas.clientHeight - 26);
}
