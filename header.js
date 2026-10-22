// =====================================================================================
// Collapsible app header (for an immersive look inside an exb Embed widget).
//
//   • A "Hide header" button in the header; a small tab at the top-centre brings it back.
//   • Keyboard: H toggles the header (ignored while typing).
//   • Starting state, in priority order:
//       1. URL parameter  ?header=hide  or  ?header=show
//       2. the viewer's last choice (remembered per app in this browser)
//       3. hidden when the app is embedded in a frame, shown when opened directly
// =====================================================================================
const KEY = "app-header-hidden:" + location.pathname;
const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();

function initialState() {
  const p = (new URLSearchParams(location.search).get("header") || "").toLowerCase();
  if (["hide", "hidden", "off", "0", "false", "collapsed"].includes(p)) return true;
  if (["show", "on", "1", "true"].includes(p)) return false;
  try {
    const s = localStorage.getItem(KEY);
    if (s !== null) return s === "1";
  } catch { /* storage blocked: fall through */ }
  return IN_FRAME;
}

function setup() {
  const nav = document.querySelector('calcite-navigation[slot="header"]');
  if (!nav) return;

  // collapse button inside the header
  const btn = document.createElement("calcite-button");
  btn.id = "hideHeaderBtn";
  btn.setAttribute("appearance", "transparent");
  btn.setAttribute("kind", "neutral");
  btn.setAttribute("icon-start", "chevrons-up");
  btn.setAttribute("title", "Hide header (H)");
  btn.textContent = "Hide header";
  (nav.querySelector(".header-end") || nav).appendChild(btn);

  // floating tab shown while the header is hidden
  const tab = document.createElement("button");
  tab.id = "headerTab";
  tab.type = "button";
  tab.title = "Show header (H)";
  tab.setAttribute("aria-label", "Show header");
  tab.innerHTML = `<calcite-icon icon="chevrons-down" scale="s"></calcite-icon>`;
  document.body.appendChild(tab);

  let hidden = initialState();
  const apply = (h, remember) => {
    hidden = h;
    nav.classList.toggle("nav-hidden", h);
    tab.classList.toggle("show", h);
    if (remember) { try { localStorage.setItem(KEY, h ? "1" : "0"); } catch { /* ignore */ } }
  };
  apply(hidden, false);

  btn.addEventListener("click", () => apply(true, true));
  tab.addEventListener("click", () => apply(false, true));
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea, calcite-input-text, calcite-input, calcite-combobox, [contenteditable]")) return;
    if (e.key === "h" || e.key === "H") apply(!hidden, true);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
else setup();
