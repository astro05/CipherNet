// Registers the "CipherNet" panel in Chrome DevTools.
chrome.devtools.panels.create(
  "CipherNet",
  "assets/icon16.png", // icon shown next to the panel title in DevTools
  "panel.html",
  function (panel) {
    // Panel created. Nothing else to do here — src/main.js drives the UI.
  }
);
