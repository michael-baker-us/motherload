import { FUEL, HULL } from "../game/config";
import { cargoValue, refuelPlan } from "../game/economy";
import type { Station } from "../game/stations";
import { TILE_DEFS } from "../game/tiles";
import { currentTier, nextTier, UPGRADES, type UpgradeTrack } from "../game/upgrades";
import type { Game } from "../game/game";

const TRACK_STAT: Record<UpgradeTrack, (value: number) => string> = {
  drill: (v) => `speed ×${v}`,
  tank: (v) => `${v} fuel`,
  cargo: (v) => `${v} units`,
  hull: (v) => `${v} HP`,
};

/**
 * DOM overlay for surface stations. The game simulation is paused while
 * one is open; Escape (or the ✕ button) closes it.
 */
export class ShopOverlay {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private onClose: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent): void => {
    if (e.code === "Escape") {
      e.preventDefault();
      this.close();
    }
  };

  open(station: Station, game: Game, onClose: () => void): void {
    this.close();
    this.onClose = onClose;

    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,0.55);font-family:monospace;z-index:10;";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:rgba(16,19,26,0.82);backdrop-filter:blur(12px);color:#e8e8e8;" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:14px;" +
      "box-shadow:0 18px 50px rgba(0,0,0,0.55);padding:22px 26px;min-width:330px;";

    const title = document.createElement("div");
    title.textContent = station.label;
    title.style.cssText =
      "font-size:18px;font-weight:bold;margin-bottom:12px;letter-spacing:1px;";
    panel.appendChild(title);

    const body = document.createElement("div");
    panel.appendChild(body);

    const hint = document.createElement("div");
    hint.textContent = "[Esc] leave";
    hint.style.cssText = "margin-top:14px;color:#888;font-size:12px;";
    panel.appendChild(hint);

    root.appendChild(panel);
    document.body.appendChild(root);
    window.addEventListener("keydown", this.keyHandler);

    this.root = root;
    this.body = body;
    this.render(station, game);
  }

  close(): void {
    if (!this.root) return;
    window.removeEventListener("keydown", this.keyHandler);
    this.root.remove();
    this.root = null;
    this.body = null;
    const onClose = this.onClose;
    this.onClose = null;
    onClose?.();
  }

  private render(station: Station, game: Game): void {
    if (!this.body) return;
    this.body.replaceChildren();
    if (station.id === "fuel") this.renderFuel(station, game);
    else if (station.id === "trader") this.renderTrader(station, game);
    else this.renderUpgrades(station, game);
  }

  private renderFuel(station: Station, game: Game): void {
    const p = game.player;
    const plan = refuelPlan(p.fuel, p.maxFuel, game.money, FUEL.pricePerUnit);

    this.line(`Fuel  ${Math.floor(p.fuel)} / ${p.maxFuel}`);
    this.line(`Money $${game.money}`);

    const label =
      plan.units <= 0
        ? p.fuel >= p.maxFuel
          ? "Tank full"
          : "No money for fuel"
        : plan.units >= p.maxFuel - p.fuel
          ? `Refuel to full — $${plan.cost}`
          : `Refuel +${plan.units} (all you can afford) — $${plan.cost}`;

    this.button(label, plan.units > 0, () => {
      p.fuel += plan.units;
      game.money -= plan.cost;
      this.render(station, game);
    });
  }

  private renderTrader(station: Station, game: Game): void {
    const p = game.player;
    if (p.cargo.size === 0) {
      this.line("Cargo bay is empty.");
    } else {
      for (const [tile, count] of p.cargo) {
        const def = TILE_DEFS[tile];
        this.line(`${def.name.padEnd(12)} ×${count}  $${def.value * count}`);
      }
    }
    this.line(`Money $${game.money}`);

    const total = cargoValue(p.cargo);
    this.button(`Sell all — $${total}`, total > 0, () => {
      game.money += total;
      p.cargo.clear();
      this.render(station, game);
    });
  }

  private renderUpgrades(station: Station, game: Game): void {
    const p = game.player;
    this.line(`Money $${game.money}   Hull ${Math.ceil(p.hull)}/${p.maxHull}`);

    for (const track of Object.keys(UPGRADES) as UpgradeTrack[]) {
      const owned = currentTier(track, game.upgrades);
      const next = nextTier(track, game.upgrades);
      this.line(`${track.toUpperCase().padEnd(6)} ${owned.name} (${TRACK_STAT[track](owned.value)})`);
      if (next) {
        this.button(
          `→ ${next.name} (${TRACK_STAT[track](next.value)}) — $${next.cost}`,
          game.money >= next.cost,
          () => {
            game.buyUpgrade(track);
            this.render(station, game);
          },
        );
      } else {
        this.line("       maxed out");
      }
    }

    const repair = refuelPlan(p.hull, p.maxHull, game.money, HULL.repairPricePerHp);
    this.button(
      repair.units > 0 ? `Repair hull — $${repair.cost}` : "Hull fully repaired",
      repair.units > 0,
      () => {
        game.repairHull();
        this.render(station, game);
      },
    );
  }

  private line(text: string): void {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = "margin:4px 0;white-space:pre;";
    this.body?.appendChild(div);
  }

  private button(label: string, enabled: boolean, onClick: () => void): void {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.disabled = !enabled;
    btn.style.cssText =
      "display:block;margin-top:10px;padding:9px 16px;font-family:monospace;font-size:14px;" +
      "cursor:pointer;color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:8px;" +
      "background:linear-gradient(180deg,#3a9d40,#2a6e2f);transition:filter 0.12s;" +
      (enabled ? "" : "opacity:0.35;cursor:default;");
    if (enabled) {
      btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(1.2)"));
      btn.addEventListener("mouseleave", () => (btn.style.filter = ""));
    }
    btn.addEventListener("click", onClick);
    this.body?.appendChild(btn);
  }
}
