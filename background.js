importScripts('presenter/core.js', 'presenter/background.js');

// サイドパネルをツールバーのアイコンクリックで開く
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {});

// サイドパネルの開閉状態を検知してストレージに保存
// サイドパネルが開くとruntime.connectで接続が来る
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    // サイドパネルが開いた
    chrome.storage.local.set({ sidePanelOpen: true });

    port.onDisconnect.addListener(() => {
      // サイドパネルが閉じた
      chrome.storage.local.set({ sidePanelOpen: false });
    });
  }
});

// Dynamic rules survive extension upgrades. Remove the rules shipped in 1.8.0.
function removeLegacyFrameRules() {
  return chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2] });
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(['numberingEnabled', 'isNumberingMode', 'wheelSelectEnabled']);
  return removeLegacyFrameRules();
});
chrome.runtime.onStartup.addListener(removeLegacyFrameRules);
