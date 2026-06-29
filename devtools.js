// Registers the "CipherNet" panel in Chrome DevTools.
chrome.devtools.panels.create(
  "CipherNet",
  "icon16.png",    // icon shown next to the panel title in DevTools
  "panel.html",
  function (panel) {
    // Panel created. Nothing else to do here — panel.js drives the UI.
  }
);
