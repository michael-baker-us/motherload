export type StationId = "fuel" | "trader" | "upgrades";

export interface Station {
  id: StationId;
  label: string;
  /** Inclusive tile-column range the building occupies on the surface. */
  x0: number;
  x1: number;
  color: string;
}

// Three 3-tile shops with equal 3-tile gaps, centered on the 60-tile world.
export const STATIONS: Station[] = [
  { id: "fuel", label: "FUEL DEPOT", x0: 23, x1: 25, color: "#c94f3d" },
  { id: "trader", label: "MINERAL TRADER", x0: 29, x1: 31, color: "#3d7fc9" },
  { id: "upgrades", label: "UPGRADE SHOP", x0: 35, x1: 37, color: "#8a4fc9" },
];

/** The station whose footprint overlaps the given tile-column span, if any. */
export function stationInSpan(left: number, right: number): Station | null {
  for (const s of STATIONS) {
    if (right >= s.x0 && left <= s.x1) return s;
  }
  return null;
}
