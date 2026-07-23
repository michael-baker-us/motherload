import { FUEL, HULL } from "../game/config";
import { cargoValue, refuelPlan } from "../game/economy";
import { ITEM_ORDER, ITEMS } from "../game/items";
import { MAX_MODULE_SLOTS, MODULE_ORDER, MODULES, type ModuleId } from "../game/modules";
import type { Station } from "../game/stations";
import { TILE_DEFS } from "../game/tiles";
import { currentTier, nextTier, UPGRADES, type UpgradeTrack } from "../game/upgrades";
import type { Game } from "../game/game";

const TRACK_STAT: Record<UpgradeTrack, (value: number) => string> = {
  drill: (v) => `speed ×${v}`,
  tank: (v) => `${v} fuel`,
  cargo: (v) => `${v} units`,
  hull: (v) => `${v} HP`,
  engine: (v) => `×${v} speed`,
  scanner: (v) => (v > 0 ? `${v}-tile range` : "none"),
  shield: (v) => (v > 0 ? `${Math.round(v * 100)}% resist` : "none"),
};

const TRACK_ICON: Record<UpgradeTrack, string> = {
  drill: "⛏",
  tank: "⛽",
  cargo: "📦",
  hull: "🔩",
  engine: "🚀",
  scanner: "📡",
  shield: "🛡",
};

const MODULE_ICON: Record<ModuleId, string> = {
  turbo: "⚡",
  compactor: "🧲",
  recycler: "♻️",
  plating: "🛡",
  probe: "📡",
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
      "position:relative;background:rgba(16,19,26,0.86);backdrop-filter:blur(14px);color:#e8e8e8;" +
      "border:1px solid rgba(255,255,255,0.14);border-radius:16px;" +
      "box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:20px 22px;width:410px;max-width:92vw;" +
      "max-height:86vh;overflow-y:auto;";

    const title = document.createElement("div");
    title.textContent = station.label;
    title.style.cssText =
      "font-size:18px;font-weight:bold;margin-bottom:12px;letter-spacing:1px;";
    panel.appendChild(title);
    panel.appendChild(this.closeButton());

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
      game.sellCargo();
      this.render(station, game);
    });

    // The trader doubles as the supply store — insurance for the trip down.
    this.line("");
    this.line("SUPPLIES  (use with keys 1-4)");
    ITEM_ORDER.forEach((id, i) => {
      const def = ITEMS[id];
      const owned = p.items[id];
      const full = owned >= def.maxStack;
      this.button(
        `[${i + 1}] ${def.name} ×${owned} — ${def.blurb} — ${full ? "max carried" : `$${def.cost}`}`,
        !full && game.money >= def.cost,
        () => {
          game.buyItem(id);
          this.render(station, game);
        },
      );
    });
  }

  private renderUpgrades(station: Station, game: Game): void {
    const p = game.player;
    this.line(`Money  $${game.money.toLocaleString()}`);

    this.heading("Upgrades");
    for (const track of Object.keys(UPGRADES) as UpgradeTrack[]) {
      const owned = currentTier(track, game.upgrades);
      const next = nextTier(track, game.upgrades);
      this.card({
        icon: TRACK_ICON[track],
        title: track.toUpperCase(),
        sub: next ? `${owned.name} → ${next.name}` : owned.name,
        stat: next
          ? `${TRACK_STAT[track](owned.value)}  →  ${TRACK_STAT[track](next.value)}`
          : TRACK_STAT[track](owned.value),
        actionLabel: next ? `$${next.cost.toLocaleString()}` : "MAX",
        enabled: !!next && game.money >= next.cost,
        onClick: next
          ? () => {
              game.buyUpgrade(track);
              this.render(station, game);
            }
          : undefined,
      });
    }

    const repair = refuelPlan(p.hull, p.maxHull, game.money, HULL.repairPricePerHp);
    this.card({
      icon: "🩹",
      title: "REPAIR",
      sub: "restore hull",
      stat: `${Math.ceil(p.hull)} / ${p.maxHull} HP`,
      actionLabel: repair.units > 0 ? `$${repair.cost}` : "FULL",
      enabled: repair.units > 0,
      onClick:
        repair.units > 0
          ? () => {
              game.repairHull();
              this.render(station, game);
            }
          : undefined,
    });

    // Modules: own any, equip up to MAX_MODULE_SLOTS — a loadout tradeoff.
    this.heading(`Modules  ·  ${game.equippedModules.length}/${MAX_MODULE_SLOTS} equipped`);
    for (const id of MODULE_ORDER) {
      const def = MODULES[id];
      const owned = game.ownedModules.has(id);
      const equipped = game.equippedModules.includes(id);
      this.card({
        icon: MODULE_ICON[id],
        title: def.name,
        sub: def.blurb,
        actionLabel: !owned ? `$${def.cost}` : equipped ? "Unequip" : "Equip",
        enabled: !owned
          ? game.money >= def.cost
          : equipped || game.equippedModules.length < MAX_MODULE_SLOTS,
        highlight: equipped,
        onClick: () => {
          if (!owned) game.buyModule(id);
          else game.toggleModule(id);
          this.render(station, game);
        },
      });
    }
  }

  private line(text: string): void {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.cssText = "margin:4px 0;white-space:pre;";
    this.body?.appendChild(div);
  }

  /** A small uppercase section heading in the shop. */
  private heading(text: string): void {
    const h = document.createElement("div");
    h.textContent = text.toUpperCase();
    h.style.cssText = "margin:16px 0 8px;font-size:10px;letter-spacing:2px;color:#7f8ba3;font-weight:bold;";
    this.body?.appendChild(h);
  }

  /**
   * An upgrade/module card: icon · title + sub + stat delta · action button.
   * `action` is null for an inert card (e.g. maxed) which shows `actionLabel`
   * as a static badge instead of a button.
   */
  private card(opts: {
    icon: string;
    title: string;
    sub: string;
    stat?: string;
    actionLabel: string;
    enabled: boolean;
    highlight?: boolean;
    onClick?: () => void;
  }): void {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:12px;margin-top:8px;padding:9px 12px;border-radius:10px;" +
      `border:1px solid ${opts.highlight ? "rgba(75,214,160,0.5)" : "rgba(255,255,255,0.1)"};` +
      `background:${opts.highlight ? "rgba(40,90,70,0.35)" : "rgba(255,255,255,0.04)"};`;

    const icon = document.createElement("div");
    icon.textContent = opts.icon;
    icon.style.cssText = "font-size:20px;width:26px;text-align:center;flex:none;";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";
    const title = document.createElement("div");
    title.textContent = opts.title;
    title.style.cssText = "font-size:13px;font-weight:bold;letter-spacing:0.3px;";
    const sub = document.createElement("div");
    sub.textContent = opts.sub;
    sub.style.cssText = "font-size:11px;color:#9aa4b2;margin-top:1px;";
    info.append(title, sub);
    if (opts.stat) {
      const stat = document.createElement("div");
      stat.textContent = opts.stat;
      stat.style.cssText = "font-size:11px;color:#8ec8ff;margin-top:2px;font-family:monospace;";
      info.appendChild(stat);
    }

    row.append(icon, info);

    if (opts.onClick) {
      const btn = document.createElement("button");
      btn.textContent = opts.actionLabel;
      btn.disabled = !opts.enabled;
      btn.style.cssText =
        "flex:none;padding:8px 12px;font-family:monospace;font-size:12px;font-weight:bold;cursor:pointer;" +
        "color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:8px;" +
        `background:linear-gradient(180deg,${opts.highlight ? "#3d7a5e,#2a5a44" : "#3a9d40,#2a6e2f"});` +
        "transition:filter 0.12s;" +
        (opts.enabled ? "" : "opacity:0.35;cursor:default;");
      if (opts.enabled) {
        btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(1.2)"));
        btn.addEventListener("mouseleave", () => (btn.style.filter = ""));
        btn.addEventListener("click", opts.onClick);
      }
      row.appendChild(btn);
    } else {
      const badge = document.createElement("div");
      badge.textContent = opts.actionLabel;
      badge.style.cssText = "flex:none;font-size:11px;color:#7f8ba3;font-weight:bold;padding:0 6px;";
      row.appendChild(badge);
    }

    this.body?.appendChild(row);
  }

  /** Tap/click target for touch devices, which have no Escape key. */
  private closeButton(): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.setAttribute("aria-label", "Close");
    btn.style.cssText =
      "position:absolute;top:14px;right:14px;width:30px;height:30px;padding:0;" +
      "font-family:monospace;font-size:15px;line-height:1;cursor:pointer;color:#fff;" +
      "border:1px solid rgba(255,255,255,0.18);border-radius:8px;" +
      "background:rgba(255,255,255,0.08);";
    btn.addEventListener("click", () => this.close());
    return btn;
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
