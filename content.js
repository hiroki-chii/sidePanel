(() => {
  // --- 右サイドバー非表示 ---
  const styleRight = document.createElement('style');
  styleRight.id = 'x-hider-right';
  styleRight.textContent = '[data-testid="sidebarColumn"] { display: none !important; }';
  styleRight.disabled = true;

  // --- メイン幅最適化 ---
  const styleWidth = document.createElement('style');
  styleWidth.id = 'x-optimizer-width';
  styleWidth.textContent = `
    /* メインコンテナの幅制限を解除 */
    main[role="main"],
    main[role="main"] > div {
      width: 100% !important;
      max-width: 100% !important;
    }
    
    /* タイムラインの最大幅を広げ、中央寄せにする */
    [data-testid="primaryColumn"] {
      width: 100% !important;
      max-width: 1000px !important; 
      margin: 0 auto !important;
    }
    
    /* 内部のタイムラインラッパー制限も広げる */
    [data-testid="primaryColumn"] > div > div {
      max-width: 975px !important;
      margin: 0 auto !important;
    }

    /* 親要素の flexレイアウトなどによる不自然な制約を緩和 */
    .r-1ye8kvj, .r-13qz1uu {
      min-width: 0 !important;
    }
  `;
  styleWidth.disabled = true;

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

  // 初回読み込み時の状態適用
  chrome.storage.local.get(['hideXSidebar'], (result) => {
    if (result.hideXSidebar) {
      styleRight.disabled = false;
      styleWidth.disabled = false; // 右メニュー非表示と同時に幅最適化
    }
  });

  // ストレージ変更時のリアルタイム反映
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.hideXSidebar !== undefined) {
        styleRight.disabled = !changes.hideXSidebar.newValue;
        styleWidth.disabled = !changes.hideXSidebar.newValue; // 連動して切り替え
      }
    }
  });
})();
