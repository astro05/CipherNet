// Chrome only loads a panel's page once the user switches to that tab, so
// requests firing while DevTools is open but the user is still on Elements/
// Console/Network would otherwise be missed. Buffer them here instead — this
// script runs the instant DevTools (Inspect mode) opens — and hand them off
// to panel.html as soon as it's shown for the first time.
const bufferedHars = [];
function bufferHar(har) {
  bufferedHars.push(har);
}
chrome.devtools.network.onRequestFinished.addListener(bufferHar);

// Registers the "CipherNet" panel in Chrome DevTools.
chrome.devtools.panels.create(
  "CipherNet",
  "assets/icon16.png", // icon shown next to the panel title in DevTools
  "panel.html",
  function (panel) {
    let flushed = false;
    panel.onShown.addListener(function (panelWindow) {
      if (flushed) return;
      flushed = true;
      chrome.devtools.network.onRequestFinished.removeListener(bufferHar);
      if (panelWindow && typeof panelWindow.__ciphernetFlushBuffered === "function") {
        panelWindow.__ciphernetFlushBuffered(bufferedHars);
      }
      bufferedHars.length = 0;
    });
  }
);
