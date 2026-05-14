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

// コマンドリスナー（ショートカットキーなど）
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-numbering') {
    chrome.storage.local.get(['numberingEnabled', 'isNumberingMode'], (result) => {
      // 機能自体が無効（トグルOFF）の場合は何もしない
      if (result.numberingEnabled === false) return;

      const newState = !result.isNumberingMode;
      chrome.storage.local.set({ isNumberingMode: newState }, () => {
        // もしサイドパネルが開いていない場合は開く
        chrome.storage.local.get(['sidePanelOpen'], (spResult) => {
          if (!spResult.sidePanelOpen) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) {
                chrome.sidePanel.open({ tabId: tabs[0].id }).catch(() => {
                  chrome.sidePanel.open({ windowId: tabs[0].windowId });
                });
              }
            });
          }
          // サイドパネル側にフォーカス要求のメッセージを送信
          if (newState) {
            // 少し待ってから送信（サイドパネルが開く時間を考慮）
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: 'focusNumberingSelect' }).catch(() => {});
            }, 500);
          }
        });
      });
    });
  }
});
