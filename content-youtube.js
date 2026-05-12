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

  // === YouTube Shorts 自動スクロール ===
  let autoScrollEnabled = false;
  let videoCheckInterval = null;
  const monitoredVideos = new WeakSet();
  let isNavigating = false;

  function initAutoScroll() {
    chrome.storage.local.get(['autoScrollYtShorts'], (result) => {
      autoScrollEnabled = result.autoScrollYtShorts === true;
      if (autoScrollEnabled) {
        startAutoScrollMonitor();
      }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.autoScrollYtShorts !== undefined) {
        autoScrollEnabled = changes.autoScrollYtShorts.newValue;
        if (autoScrollEnabled) {
          startAutoScrollMonitor();
        } else {
          stopAutoScrollMonitor();
        }
      }
    });
  }

  function startAutoScrollMonitor() {
    if (videoCheckInterval) return;
    // 新しく追加されたvideo要素を定期的にフックアップする
    videoCheckInterval = setInterval(bindVideoEvents, 1000);
    bindVideoEvents();
  }

  function stopAutoScrollMonitor() {
    if (videoCheckInterval) {
      clearInterval(videoCheckInterval);
      videoCheckInterval = null;
    }
  }

  function bindVideoEvents() {
    if (!autoScrollEnabled) return;
    if (!window.location.pathname.startsWith('/shorts/')) return;

    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (!monitoredVideos.has(video)) {
        monitoredVideos.add(video);
        video.addEventListener('timeupdate', handleTimeUpdate);
      }
    });
  }

  function handleTimeUpdate(e) {
    if (!autoScrollEnabled) return;
    if (isNavigating) return;
    if (!window.location.pathname.startsWith('/shorts/')) return;

    const video = e.target;
    // 画面内に見えているか、または再生中かを確認（非アクティブな裏の動画の判定を無視）
    const rect = video.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    // 動画終了まで残り 0.2 秒を切ったら次へ進む
    if (video.duration > 0 && video.currentTime >= video.duration - 0.2) {
      goToNextShort();
    }
  }

  function goToNextShort() {
    if (isNavigating) return;
    isNavigating = true;

    const nextBtn = document.querySelector('#navigation-button-down yt-button-shape button') ||
      document.querySelector('ytd-shorts-container #navigation-button-down button');

    if (nextBtn) {
      nextBtn.click();
    }

    // 次の動画ロードから再生開始までの猶予としてクールダウンを設ける
    setTimeout(() => {
      isNavigating = false;
    }, 1500);
  }

  initAutoScroll();

  // === YouTube スクロール連動ミニプレイヤー ===
  let miniPlayerEnabled = false;
  let miniPlayerActive = false;
  let miniPlayerDismissed = false; // ✕ボタンで一時的に非表示にしたフラグ
  let miniPlayerSize = 'medium'; // small | medium | large | xlarge
  let intersectionObserver = null;
  let playerPollTimer = null;
  let sentinelElement = null; // Observer監視用のセンチネル要素
  let floatingContainer = null; // フローティング表示用コンテナ
  let originalVideoParent = null; // video要素の元の親
  let originalVideoNextSibling = null; // video要素の元の次兄弟
  let videoElement = null; // 移動対象のvideo要素

  // サイズ定義マップ（width, height）
  const MINI_PLAYER_SIZES = {
    small: { w: 400, h: 225 },
    medium: { w: 520, h: 293 },
    large: { w: 640, h: 360 },
    xlarge: { w: 800, h: 450 }
  };

  // ミニプレイヤー用CSSを注入
  const MINI_PLAYER_STYLE_ID = 'yt-ext-mini-player-style';
  function injectMiniPlayerStyles() {
    if (document.getElementById(MINI_PLAYER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = MINI_PLAYER_STYLE_ID;
    style.textContent = `
      /* フローティングコンテナ（body直下に配置するので親のoverflow影響なし） */
      #yt-ext-floating-player {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: var(--yt-ext-fp-w, 400px);
        height: var(--yt-ext-fp-h, 225px);
        z-index: 2147483647;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        background: #000;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    width 0.3s ease, height 0.3s ease;
        transform: translateY(0);
        opacity: 1;
        resize: both;
        min-width: 260px;
        min-height: 146px;
        max-width: 800px;
        max-height: 450px;
      }
      #yt-ext-floating-player video {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
      }
      #yt-ext-floating-player.yt-ext-enter {
        transform: translateY(20px);
        opacity: 0;
      }
      /* センチネル要素（プレイヤー位置に常駐、Observer監視用） */
      #yt-ext-sentinel {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
      }
      /* ミニプレイヤー時にプレイヤー元位置の高さを維持するプレースホルダー */
      .yt-ext-mini-player-placeholder {
        background: var(--yt-spec-base-background, #0f0f0f);
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--yt-spec-text-secondary, #aaa);
        font-size: 14px;
        font-family: 'Roboto', Arial, sans-serif;
      }
      /* コントロールボタン共通スタイル */
      .yt-ext-fp-btn {
        position: absolute;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.2s, background 0.2s;
      }
      #yt-ext-floating-player:hover .yt-ext-fp-btn {
        opacity: 1;
      }
      .yt-ext-fp-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }
      .yt-ext-fp-close {
        top: 8px;
        right: 8px;
        font-size: 18px;
      }
      .yt-ext-fp-back {
        top: 8px;
        left: 8px;
        font-size: 16px;
      }
      .yt-ext-fp-play-pause {
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 48px;
        height: 48px;
        font-size: 24px;
        background: rgba(0, 0, 0, 0.5);
      }
      .yt-ext-fp-play-pause svg {
        width: 30px;
        height: 30px;
      }
    `;
    document.head.appendChild(style);
  }

  function initMiniPlayer() {
    // 設定の読み込み
    chrome.storage.local.get(['miniPlayerEnabled', 'miniPlayerSize'], (result) => {
      miniPlayerEnabled = result.miniPlayerEnabled !== false; // デフォルト有効
      miniPlayerSize = result.miniPlayerSize || 'medium';
      if (miniPlayerEnabled) {
        setupMiniPlayerOnNavigation();
      }
    });

    // 設定変更のリスン
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;

      if (changes.miniPlayerEnabled !== undefined) {
        miniPlayerEnabled = changes.miniPlayerEnabled.newValue;
        if (miniPlayerEnabled) {
          setupMiniPlayerOnNavigation();
        } else {
          deactivateMiniPlayer();
          teardownMiniPlayer();
        }
      }

      // サイズ変更をリアルタイム反映
      if (changes.miniPlayerSize !== undefined) {
        miniPlayerSize = changes.miniPlayerSize.newValue || 'medium';
        applyMiniPlayerSize();
      }
    });

    // YouTubeのSPAナビゲーション検知
    document.addEventListener('yt-navigate-finish', () => {
      // ページ遷移時にミニプレイヤーを必ずリセット
      deactivateMiniPlayer();
      teardownMiniPlayer();
      miniPlayerDismissed = false; // ページ遷移でフラグリセット

      if (miniPlayerEnabled) {
        setupMiniPlayerOnNavigation();
      }
    });
  }

  // 現在のURLが /watch ページかどうかを判定
  function isWatchPage() {
    return window.location.pathname === '/watch';
  }

  // /watchページの場合のみ、プレイヤー要素のポーリングを開始
  function setupMiniPlayerOnNavigation() {
    if (!isWatchPage()) return;
    injectMiniPlayerStyles();
    waitForPlayerElement();
  }

  // プレイヤー要素が DOM に現れるまでポーリングして待機
  function waitForPlayerElement() {
    if (playerPollTimer) return;

    let attempts = 0;
    const MAX_ATTEMPTS = 50; // 最大5秒（100ms × 50）

    playerPollTimer = setInterval(() => {
      attempts++;
      const player = document.querySelector('#movie_player');
      if (player) {
        clearInterval(playerPollTimer);
        playerPollTimer = null;
        setupObserver(player);
        return;
      }
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(playerPollTimer);
        playerPollTimer = null;
      }
    }, 100);
  }

  // センチネル要素を設置してIntersectionObserverをセットアップ
  function setupObserver(playerElement) {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }

    // 既存のセンチネルがあれば再利用
    sentinelElement = playerElement.querySelector('#yt-ext-sentinel');
    if (!sentinelElement) {
      sentinelElement = document.createElement('div');
      sentinelElement.id = 'yt-ext-sentinel';
      // playerElementに相対配置がなければ付与
      const pos = getComputedStyle(playerElement).position;
      if (pos === 'static') {
        playerElement.style.position = 'relative';
      }
      playerElement.appendChild(sentinelElement);
    }

    // センチネルを監視（プレイヤー自体ではなくセンチネルを監視するのでfixed化の影響なし）
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (!miniPlayerEnabled || !isWatchPage()) return;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            // プレイヤー位置が画面内に戻った → ミニプレイヤー解除＆フラグリセット
            deactivateMiniPlayer();
            miniPlayerDismissed = false;
          } else {
            // プレイヤー位置が画面外 → ミニプレイヤー化
            // ユーザーが✕で閉じた場合はスキップ
            if (miniPlayerDismissed) break;
            const video = document.querySelector('#movie_player video');
            if (video) {
              activateMiniPlayer();
            }
          }
        }
      },
      { threshold: 0.3 }
    );

    intersectionObserver.observe(sentinelElement);
  }

  // ミニプレイヤーを起動（video要素を独立フローティングコンテナに移動）
  function activateMiniPlayer() {
    if (miniPlayerActive) return;

    const video = document.querySelector('#movie_player video');
    if (!video) return;

    miniPlayerActive = true;
    videoElement = video;
    originalVideoParent = video.parentNode;
    originalVideoNextSibling = video.nextSibling;

    // フローティングコンテナを作成してbody直下に配置
    floatingContainer = document.createElement('div');
    floatingContainer.id = 'yt-ext-floating-player';
    floatingContainer.classList.add('yt-ext-enter');

    // 閉じるボタン
    const closeBtn = document.createElement('button');
    closeBtn.className = 'yt-ext-fp-btn yt-ext-fp-close';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'ミニプレイヤーを閉じる';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      miniPlayerDismissed = true; // プレイヤー位置に戻るまで再表示しない
      deactivateMiniPlayer();
    });

    // 元位置に戻るボタン
    const backBtn = document.createElement('button');
    backBtn.className = 'yt-ext-fp-btn yt-ext-fp-back';
    backBtn.innerHTML = '↑';
    backBtn.title = 'プレイヤーの位置に戻る';
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deactivateMiniPlayer();
      // プレイヤー位置にスクロール
      const player = document.querySelector('#movie_player');
      if (player) {
        player.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // 再生/停止ボタン
    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'yt-ext-fp-btn yt-ext-fp-play-pause';
    playPauseBtn.title = '再生/停止';

    const updatePlayPauseIcon = () => {
      if (video.paused) {
        playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      } else {
        playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      }
    };

    updatePlayPauseIcon();

    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    });

    // ビデオの状態変化を監視
    video.addEventListener('play', updatePlayPauseIcon);
    video.addEventListener('pause', updatePlayPauseIcon);

    // video要素をフローティングコンテナに移動
    floatingContainer.appendChild(video);
    floatingContainer.appendChild(closeBtn);
    floatingContainer.appendChild(backBtn);
    floatingContainer.appendChild(playPauseBtn);
    document.body.appendChild(floatingContainer);

    // サイズを適用
    applyMiniPlayerSize();

    // アニメーション開始
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (floatingContainer) {
          floatingContainer.classList.remove('yt-ext-enter');
        }
      });
    });
  }

  // ミニプレイヤーを解除してvideo要素を元の位置に戻す
  function deactivateMiniPlayer() {
    if (!miniPlayerActive) return;
    miniPlayerActive = false;

    // video要素を元の親に戻す
    if (videoElement && originalVideoParent) {
      if (originalVideoNextSibling && originalVideoNextSibling.parentNode === originalVideoParent) {
        originalVideoParent.insertBefore(videoElement, originalVideoNextSibling);
      } else {
        originalVideoParent.appendChild(videoElement);
      }
    }

    // フローティングコンテナを削除
    if (floatingContainer) {
      floatingContainer.remove();
      floatingContainer = null;
    }

    // 参照をリセット
    videoElement = null;
    originalVideoParent = null;
    originalVideoNextSibling = null;
  }

  // フローティングコンテナにサイズを適用（リアルタイム変更対応）
  function applyMiniPlayerSize() {
    if (!floatingContainer) return;

    const size = MINI_PLAYER_SIZES[miniPlayerSize] || MINI_PLAYER_SIZES.small;
    if (!size) return;
    floatingContainer.style.setProperty('--yt-ext-fp-w', `${size.w}px`);
    floatingContainer.style.setProperty('--yt-ext-fp-h', `${size.h}px`);
  }

  // 監視を完全に停止
  function teardownMiniPlayer() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    if (playerPollTimer) {
      clearInterval(playerPollTimer);
      playerPollTimer = null;
    }
    // センチネルは残しても問題ないが、次のセットアップで再利用される
    if (sentinelElement) {
      sentinelElement.remove();
      sentinelElement = null;
    }
  }

  initMiniPlayer();
})();

