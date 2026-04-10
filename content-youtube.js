(() => {
  // === YouTube関連動画の縦並びレイアウト ===
  // サイドパネル表示中、右サイドバーの動画一覧を
  // サムネイル+概要の縦並びにして横幅を節約する

  const style = document.createElement('style');
  style.id = 'yt-compact-layout';
  style.textContent = `
    /* 新UIのレイアウトコンテナを縦並びに強制 */
    div.ytLockupViewModelHost.ytLockupViewModelHorizontal {
      flex-direction: column !important;
    }

    /* サムネイルを横幅いっぱいに */
    a.ytLockupViewModelContentImage {
      width: 100% !important;
      max-width: none !important;
    }

    a.ytLockupViewModelContentImage ytd-thumbnail,
    a.ytLockupViewModelContentImage yt-thumbnail-view-model {
      width: 100% !important;
      max-width: none !important;
    }

    /* メタデータ領域 */
    div.ytLockupViewModelMetadata {
      width: 100% !important;
      padding-top: 8px !important;
    }

    /* 旧UI互換: ytd-compact-video-renderer */
    ytd-compact-video-renderer #dismissible,
    ytd-compact-radio-renderer #dismissible,
    ytd-compact-playlist-renderer #dismissible {
      flex-direction: column !important;
      align-items: stretch !important;
    }

    ytd-compact-video-renderer ytd-thumbnail,
    ytd-compact-radio-renderer ytd-thumbnail,
    ytd-compact-playlist-renderer ytd-thumbnail {
      width: 100% !important;
      max-width: 100% !important;
      margin-right: 0 !important;
    }

    ytd-compact-video-renderer ytd-thumbnail #thumbnail,
    ytd-compact-radio-renderer ytd-thumbnail #thumbnail,
    ytd-compact-playlist-renderer ytd-thumbnail #thumbnail {
      width: 100% !important;
      max-width: 100% !important;
    }

    ytd-compact-video-renderer .metadata,
    ytd-compact-radio-renderer .metadata,
    ytd-compact-playlist-renderer .metadata {
      padding-top: 8px !important;
      width: 100% !important;
      max-width: 100% !important;
    }

    /* 右サイドバー自体の幅を狭める */
    #secondary {
      max-width: 200px !important;
      min-width: 150px !important;
    }

    #secondary-inner {
      max-width: 100% !important;
    }
  `;
  style.disabled = true; // 初期状態は無効

  function inject() {
    if (!document.getElementById('yt-compact-layout')) {
      document.head.appendChild(style);
    }
  }

  // なるべく早く注入
  if (document.head) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }

  // サイドパネルの開閉状態をストレージ経由で受信
  chrome.storage.local.get(['sidePanelOpen'], (result) => {
    style.disabled = !result.sidePanelOpen;
  });

  // リアルタイムで反映
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.sidePanelOpen !== undefined) {
      style.disabled = !changes.sidePanelOpen.newValue;
    }
  });
})();
