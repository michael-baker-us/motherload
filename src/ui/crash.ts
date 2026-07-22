import { SAVE_KEY } from "../game/save";

let shown = false;

/**
 * A friendly full-screen error overlay, shown once when the game hits an
 * unrecoverable error — better than a frozen/black screen. The save is left
 * intact so a reload resumes; a second button clears it in case a corrupt save
 * is what's crashing on load.
 */
export function showCrashScreen(error: unknown): void {
  if (shown) return;
  shown = true;
  console.error("Motherload crashed:", error);

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(6,4,8,0.93);font-family:ui-monospace,monospace;color:#e8e8e8;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "max-width:420px;text-align:center;padding:30px 28px;border-radius:16px;" +
    "border:1px solid rgba(255,255,255,0.14);background:rgba(22,17,24,0.92);" +
    "box-shadow:0 24px 60px rgba(0,0,0,0.6);";

  const heading = document.createElement("div");
  heading.textContent = "Something went wrong";
  heading.style.cssText = "font-size:20px;font-weight:bold;color:#e04a3a;margin-bottom:12px;";

  const msg = document.createElement("div");
  msg.textContent =
    "The game hit an unexpected error. Your last save is intact — reloading picks it right back up.";
  msg.style.cssText = "font-size:13px;color:#b8b3c6;line-height:1.6;margin-bottom:20px;";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;justify-content:center;flex-wrap:wrap;";
  row.append(
    crashButton("Reload", "#2e7d46", () => location.reload()),
    crashButton("Reset save & reload", "#33404f", () => {
      try {
        window.localStorage.removeItem(SAVE_KEY);
      } catch {
        // Storage unavailable — reload anyway.
      }
      location.reload();
    }),
  );

  panel.append(heading, msg, row);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function crashButton(label: string, background: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.cssText =
    "padding:10px 16px;font-family:ui-monospace,monospace;font-size:13px;cursor:pointer;color:#fff;" +
    `border:1px solid rgba(255,255,255,0.18);border-radius:8px;background:${background};`;
  btn.addEventListener("click", onClick);
  return btn;
}
