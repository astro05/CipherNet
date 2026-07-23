// core/dom.js — tiny DOM/util primitives shared across the UI.

import { logError } from "./errorLog.js";

// Create an element with an optional class and text content.
export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A small inline "Copy" button bound to a text getter.
export function copyBtn(getText) {
  const b = el("button", "linkbtn copy-inline", "Copy");
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(getText()).then(() => {
      b.textContent = "Copied!";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    }).catch((err) => {
      logError("dom.copyBtn", err);
      b.textContent = "Copy failed";
      setTimeout(() => (b.textContent = "Copy"), 1200);
    });
  });
  return b;
}

// Trailing-edge debounce.
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
