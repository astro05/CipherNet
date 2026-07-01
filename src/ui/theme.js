// ui/theme.js — follow the host theme: dark when DevTools (or the browser) is
// dark, light otherwise. CSS defaults to dark; we only flip <html data-theme>
// for light.

function setTheme(name) {
  document.documentElement.setAttribute("data-theme", name === "dark" ? "dark" : "light");
}

function detectTheme() {
  // chrome.devtools.panels.themeName ("dark" | "default") is the authoritative
  // DevTools theme; fall back to the OS/browser preference when unavailable.
  const t = chrome.devtools && chrome.devtools.panels && chrome.devtools.panels.themeName;
  if (t === "dark") return "dark";
  if (t === "default") return "light";
  if (window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export function initTheme() {
  setTheme(detectTheme());
  // Live-update when the user flips the DevTools/browser theme — no reload.
  // (themeName isn't re-read on change, so trust the media query here.)
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setTheme(e.matches ? "dark" : "light");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Chrome
  }
}

// Run immediately on import (before the rest of the panel paints) to avoid a
// theme flash; main.js imports this module first.
initTheme();
