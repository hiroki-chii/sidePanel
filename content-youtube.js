(() => {
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
  // 動画プレイヤーが画面外にスクロールされたら、
  // 画面右下にフローティングミニプレイヤーを表示する

  const miniPlayerStyle = document.createElement('style');
  miniPlayerStyle.id = 'yt-mini-player-style';
  miniPlayerStyle.textContent = `
    /* ミニプレイヤー化時にプレイヤーに適用するスタイル */
    #movie_player.yt-ext-mini-player {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 400px !important;
      height: 225px !important;
      z-index: 99999 !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
      overflow: hidden !important;
    }

    /* ミニプレイヤー状態の閉じるボタン */
    .yt-ext-mini-player-close {
      position: fixed;
      bottom: 232px;
      right: 24px;
      width: 32px;
      height: 32px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      z-index: 100000;
      font-size: 18px;
      line-height: 32px;
      text-align: center;
      display: none;
      transition: opacity 0.3s ease, background 0.2s ease;
    }
    .yt-ext-mini-player-close:hover {
      background: rgba(255, 0, 0, 0.8);
    }
    .yt-ext-mini-player-close.visible {
      display: block;
    }

    /* プレイヤー元位置のプレースホルダー（レイアウト崩れ防止） */
    .yt-ext-mini-player-placeholder {
      width: 100%;
      background: #0f0f0f;
      border-radius: 12px;
    }
  `;

  // ミニプレイヤー状態管理
  let miniPlayerObserver = null;   // IntersectionObserver
  let miniPlayerEnabled = true;    // 機能のON/OFF
  let miniPlayerActive = false;    // 現在ミニプレイヤー中か
  let miniPlayerDismissed = false; // ユーザーが手動で閉じたか
  let playerPollTimer = null;      // 要素待機用ポーリングタイマー
  let closeBtn = null;             // 閉じるボタン要素
  let placeholder = null;          // プレースホルダー要素

  // スタイルの注入
  function injectMiniPlayerStyle() {
    if (!document.getElementById('yt-mini-player-style')) {
      document.head.appendChild(miniPlayerStyle);
    }
  }

  if (document.head) {
    injectMiniPlayerStyle();
  } else {
    document.addEventListener('DOMContentLoaded', injectMiniPlayerStyle);
  }

  // 閉じるボタンの生成
  function createCloseButton() {
    if (closeBtn) return closeBtn;
    closeBtn = document.createElement('button');
    closeBtn.className = 'yt-ext-mini-player-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'ミニプレイヤーを閉じる';
    closeBtn.addEventListener('click', () => {
      miniPlayerDismissed = true;
      deactivateMiniPlayer();
    });
    document.body.appendChild(closeBtn);
    return closeBtn;
  }

  // ミニプレイヤーを有効化
  function activateMiniPlayer() {
    if (miniPlayerActive || miniPlayerDismissed) return;

    const moviePlayer = document.querySelector('#movie_player');
    if (!moviePlayer) return;

    // 動画が再生中でなければミニプレイヤー化しない
    const video = moviePlayer.querySelector('video');
    if (!video || video.paused) return;

    // プレースホルダーを作成してレイアウト崩れを防ぐ
    const playerContainer = document.querySelector('#player-container-outer') ||
                            document.querySelector('#player-container') ||
                            document.querySelector('ytd-player#ytd-player');
    if (playerContainer && !placeholder) {
      const rect = moviePlayer.getBoundingClientRect();
      placeholder = document.createElement('div');
      placeholder.className = 'yt-ext-mini-player-placeholder';
      placeholder.style.height = `${rect.height}px`;
      // プレイヤーの直前に挿入
      moviePlayer.parentNode.insertBefore(placeholder, moviePlayer);
    }

    moviePlayer.classList.add('yt-ext-mini-player');
    miniPlayerActive = true;

    // 閉じるボタンを表示
    createCloseButton();
    closeBtn.classList.add('visible');
  }

  // ミニプレイヤーを解除
  function deactivateMiniPlayer() {
    const moviePlayer = document.querySelector('#movie_player');
    if (moviePlayer) {
      moviePlayer.classList.remove('yt-ext-mini-player');
    }
    miniPlayerActive = false;

    // 閉じるボタンを非表示
    if (closeBtn) {
      closeBtn.classList.remove('visible');
    }

    // プレースホルダーを除去
    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
  }

  // IntersectionObserverのセットアップ
  function setupMiniPlayerObserver(targetEl) {
    // 既存のオブザーバーがあれば破棄
    teardownMiniPlayerObserver();

    miniPlayerObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            // プレイヤーが画面外 → ミニプレイヤー化
            activateMiniPlayer();
          } else {
            // プレイヤーが画面内に復帰 → 解除
            if (miniPlayerActive) {
              deactivateMiniPlayer();
            }
            // 画面内に戻ったらdismissedフラグもリセット
            miniPlayerDismissed = false;
          }
        }
      },
      {
        // プレイヤーが50%以上見えなくなったらトリガー
        threshold: 0.5,
      }
    );

    miniPlayerObserver.observe(targetEl);
  }

  // IntersectionObserverの解除
  function teardownMiniPlayerObserver() {
    if (miniPlayerObserver) {
      miniPlayerObserver.disconnect();
      miniPlayerObserver = null;
    }
  }

  // プレイヤー要素が出現するまでポーリングで待機
  function waitForPlayerAndSetup() {
    // 既存のポーリングを停止
    if (playerPollTimer) {
      clearInterval(playerPollTimer);
      playerPollTimer = null;
    }

    let attempts = 0;
    const maxAttempts = 30; // 最大15秒（500ms × 30回）

    playerPollTimer = setInterval(() => {
      attempts++;

      // 監視対象: プレイヤーの外側コンテナ（スクロールで動く要素）
      const playerContainer = document.querySelector('#player-container-outer') ||
                              document.querySelector('#player-container') ||
                              document.querySelector('ytd-player#ytd-player');

      if (playerContainer) {
        clearInterval(playerPollTimer);
        playerPollTimer = null;
        setupMiniPlayerObserver(playerContainer);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(playerPollTimer);
        playerPollTimer = null;
      }
    }, 500);
  }

  // ページ遷移時のハンドラ
  function handleNavigation() {
    const isWatchPage = window.location.pathname === '/watch';

    // まずミニプレイヤーを解除・リセット
    deactivateMiniPlayer();
    miniPlayerDismissed = false;

    if (isWatchPage && miniPlayerEnabled) {
      // /watch ページ → 監視を開始
      waitForPlayerAndSetup();
    } else {
      // その他のページ → 監視を完全に解除
      teardownMiniPlayerObserver();
      if (playerPollTimer) {
        clearInterval(playerPollTimer);
        playerPollTimer = null;
      }
    }
  }

  // SPA遷移イベントをリッスン
  document.addEventListener('yt-navigate-finish', handleNavigation);

  // 初回ロード時にも実行（直接 /watch にアクセスした場合）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleNavigation);
  } else {
    handleNavigation();
  }

  // ストレージからON/OFF設定を読み込み（将来のUI連携用）
  chrome.storage.local.get(['miniPlayerEnabled'], (result) => {
    if (result.miniPlayerEnabled !== undefined) {
      miniPlayerEnabled = result.miniPlayerEnabled;
      if (!miniPlayerEnabled) {
        teardownMiniPlayerObserver();
        deactivateMiniPlayer();
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.miniPlayerEnabled !== undefined) {
      miniPlayerEnabled = changes.miniPlayerEnabled.newValue;
      if (miniPlayerEnabled) {
        handleNavigation();
      } else {
        teardownMiniPlayerObserver();
        deactivateMiniPlayer();
      }
    }
  });
})();
