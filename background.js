// サイドパネルをツールバーのアイコンクリックで開く
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

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
