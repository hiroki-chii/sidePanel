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

// ===========================
// iframeのブロック回避 (declarativeNetRequest)
// ===========================
const RULE_ID_XFRAME = 1;
const RULE_ID_CSP = 2;

async function setupIframeRules() {
  const rules = [
    {
      id: RULE_ID_XFRAME,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'frame-options', operation: 'remove' }
        ]
      },
      condition: {
        resourceTypes: ['sub_frame']
      }
    },
    {
      id: RULE_ID_CSP,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'content-security-policy', operation: 'remove' }
        ]
      },
      condition: {
        resourceTypes: ['sub_frame']
      }
    }
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID_XFRAME, RULE_ID_CSP],
    addRules: rules
  });
}

// 起動時にルールを設定
chrome.runtime.onInstalled.addListener(() => {
  setupIframeRules();
});

// ブラウザ起動時にも再設定（確実性の向上）
chrome.runtime.onStartup.addListener(() => {
  setupIframeRules();
});
