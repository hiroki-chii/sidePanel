(() => {
  // --- 右サイドバー非表示 ---
  const styleRight = document.createElement('style');
  styleRight.id = 'x-hider-right';
  styleRight.textContent = 'html[data-x-optim="true"] [data-testid="sidebarColumn"] { display: none !important; }';

  // --- メイン幅最適化 ---
  const styleWidth = document.createElement('style');
  styleWidth.id = 'x-optimizer-width';
  styleWidth.textContent = `
    /* メインコンテナの最大幅制限を緩和 */
    html[data-x-optim="true"] [data-testid="primaryColumn"] {
      width: 100% !important;
      max-width: 1000px !important; 
      margin: 0 auto !important;
    }
    
    /* タイムライン内部のラッパー制限を緩和 */
    html[data-x-optim="true"] [data-testid="primaryColumn"] > div > div {
      max-width: none !important;
    }

    /* 親要素のコンテナ制限を解除するための、より安全なアプローチ */
    html[data-x-optim="true"] main[role="main"] > div > div {
      max-width: 100% !important;
      width: 100% !important;
    }
  `;

  function inject() {
    document.head.appendChild(styleRight);
    document.head.appendChild(styleWidth);
  }

  // なるべく早く注入
  if (document.head) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }

  // 状態反映関数
  function updateOptimizedState(isOptimized) {
    if (isOptimized) {
      document.documentElement.setAttribute('data-x-optim', 'true');
    } else {
      document.documentElement.removeAttribute('data-x-optim');
    }
  }

  // 現在のストレージ設定から状態を再評価して適用
  function evaluateState() {
    chrome.storage.local.get({ hideXSidebar: false, sidePanelOpen: false }, (result) => {
      // パネルが開いている ＆＆ 設定がONの時のみ最適化
      updateOptimizedState(result.hideXSidebar && result.sidePanelOpen);
    });
  }

  // 初回読み込み時の状態適用
  evaluateState();

  // ストレージ変更時のリアルタイム反映
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.hideXSidebar !== undefined || changes.sidePanelOpen !== undefined) {
        evaluateState();
      }
    }
  });
})();
