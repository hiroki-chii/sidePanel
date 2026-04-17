/**
 * サイドパネル - タブ&ブックマーク管理
 */

// サイドパネルの開閉状態をbackgroundに通知（接続/切断で検知）
const _sidePanelPort = chrome.runtime.connect({ name: 'sidepanel' });

// ===========================
// 状態管理
// ===========================
const state = {
  activeTab: 'tabs', // 'tabs' | 'bookmarks' | 'tools'
  tabs: [],
  bookmarks: [],
  openFolderIds: new Set(), // 開いているフォルダのIDを保持
  tabVolumes: {}, // tabId -> volume (0-100)
};

// ===========================
// DOM参照
// ===========================
const dom = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabIndicator: document.querySelector('.tab-indicator'),
  navBack: document.getElementById('navBack'),
  navForward: document.getElementById('navForward'),
  addressInput: document.getElementById('addressInput'),
  tabsPanel: document.getElementById('tabsPanel'),
  bookmarksPanel: document.getElementById('bookmarksPanel'),
  toolsPanel: document.getElementById('toolsPanel'),
  tabsList: document.getElementById('tabsList'),
  bookmarksList: document.getElementById('bookmarksList'),
  tabsEmpty: document.getElementById('tabsEmpty'),
  bookmarksEmpty: document.getElementById('bookmarksEmpty'),
  bookmarkPageBtn: document.getElementById('bookmarkPageBtn'),
};

// ===========================
// 初期化
// ===========================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupTabNavigation();
  setupAddressBar();
  setupBookmarkAction();
  setupContextMenu();
  setupNewTabAction();
  setupTabListeners(); // タブのイベントリスナーを設定
  updateNavButtonsStatus(); // ナビゲーションボタンの状態を初期更新
  loadTabs();
  await loadAppState(); // 保存された状態を読み込む
  switchTab(state.activeTab); // 保存されたタブに切り替え
  loadBookmarks();
  setupBookmarkListeners();
  loadToolsSettings();
  setupSettings(); // 設定パネルの初期化
  setupVoiceTool();
  setupSummaryTool(); // ページ要約ツールの初期化
});

// ===========================
// アクション関連
// ===========================
function setupNewTabAction() {
  const newTabBtn = document.getElementById('newTabBtn');
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => {
      chrome.tabs.create({});
    });
  }
}

// ===========================
// ページナビゲーション（戻る・進む・リロード）
// ===========================
function setupNavigation() {
  if (dom.navBack) {
    dom.navBack.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.goBack(tab.id);
        // 少し待ってから状態を更新（ナビゲーション完了を待つため）
        setTimeout(updateNavButtonsStatus, 100);
      }
    });
  }

  if (dom.navForward) {
    dom.navForward.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.goForward(tab.id);
        setTimeout(updateNavButtonsStatus, 100);
      }
    });
  }

  document.getElementById('navReload').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.reload(tab.id);
  });

  // 全画面に入る前の状態を記憶
  let previousWindowState = 'maximized';

  document.getElementById('navFullscreen').addEventListener('click', async () => {
    const win = await chrome.windows.getCurrent();
    if (win.state === 'fullscreen') {
      // 全画面解除 → 以前の状態に復元
      chrome.windows.update(win.id, { state: previousWindowState });
    } else {
      // 現在の状態を記憶してから全画面へ
      previousWindowState = win.state;
      chrome.windows.update(win.id, { state: 'fullscreen' });
    }
  });
}

/**
 * 戻る・進むボタンの有効/無効状態を更新
 */
async function updateNavButtonsStatus() {
  if (!dom.navBack || !dom.navForward) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      // 制限されたページではスクリプト実行不可なので、安全のため無効化するか、
      // あるいは判定不能として現在の状態を維持（ここでは安全のために一旦無効化）
      dom.navBack.disabled = true;
      dom.navForward.disabled = true;
      return;
    }

    // Navigation APIを使用して状態を取得
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return {
          canGoBack: window.navigation ? window.navigation.canGoBack : false,
          canGoForward: window.navigation ? window.navigation.canGoForward : false,
          // Navigation APIが未サポートの場合のフォールバック
          historyLength: window.history.length,
          hasNavigation: !!window.navigation
        };
      }
    });

    if (results && results[0] && results[0].result) {
      const { canGoBack, canGoForward, hasNavigation } = results[0].result;

      if (hasNavigation) {
        dom.navBack.disabled = !canGoBack;
        dom.navForward.disabled = !canGoForward;
      } else {
        // Navigation APIが使えない古いブラウザ等の場合（一応のケア）
        // history.length だけでは正確な位置が分からないため、常に有効にしておくか
        // 独自のトラッキングが必要だが、現在のChromeであれば基本問題ない
        dom.navBack.disabled = false;
        dom.navForward.disabled = false;
      }
    }
  } catch (error) {
    // スクリプト実行失敗（セキュリティ制限ページなど）
    dom.navBack.disabled = true;
    dom.navForward.disabled = true;
  }
}

// ===========================
// タブナビゲーション
// ===========================
function setupTabNavigation() {
  dom.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  state.activeTab = tab;

  // ボタンのアクティブ状態を更新
  dom.tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // インジケーターの位置を更新
  dom.tabIndicator.classList.remove('pos-1', 'pos-2');
  if (tab === 'bookmarks') {
    dom.tabIndicator.classList.add('pos-1');
  } else if (tab === 'tools') {
    dom.tabIndicator.classList.add('pos-2');
  }

  // パネルの表示切替
  dom.tabsPanel.classList.toggle('active', tab === 'tabs');
  dom.bookmarksPanel.classList.toggle('active', tab === 'bookmarks');
  if (dom.toolsPanel) dom.toolsPanel.classList.toggle('active', tab === 'tools');

  const addressBar = document.getElementById('addressBarContainer');
  if (addressBar) {
    addressBar.style.display = tab === 'tools' ? 'none' : 'flex';
  }

  // コンテンツを再描画
  if (tab === 'tabs') {
    renderTabs();
  } else if (tab === 'bookmarks') {
    renderBookmarks();
  }

  // 選択状態を保存
  saveAppState();
}

// ===========================
// アドレスバー
// ===========================
function setupAddressBar() {
  if (!dom.addressInput) return;

  // 初期表示
  updateAddressBar();

  dom.addressInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const query = dom.addressInput.value.trim();
      if (!query) return;

      let targetUrl = query;
      if (!/^(https?|chrome|edge|about|file|view-source):/i.test(query)) {
        if (query.includes('.') && !query.includes(' ')) {
          targetUrl = 'https://' + query;
        } else {
          targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
      }

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.tabs.update(tab.id, { url: targetUrl });
        } else {
          await chrome.tabs.create({ url: targetUrl });
        }
        dom.addressInput.blur();
      } catch (error) {
        console.error('ナビゲーションエラー:', error);
        if (targetUrl.startsWith('chrome://')) {
          showToast('セキュリティ制限により chrome:// ページへの自動遷移は制限されています');
        } else {
          showToast('ページを開けませんでした');
        }
      }
    }
  });

  // フォーカス時に全選択（使いやすさのため）
  dom.addressInput.addEventListener('focus', () => {
    dom.addressInput.select();
  });
}

function setupBookmarkAction() {
  if (!dom.bookmarkPageBtn) return;

  dom.bookmarkPageBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    try {
      // 既存のブックマークを検索
      const bookmarks = await chrome.bookmarks.search({ url: tab.url });

      if (bookmarks.length > 0) {
        // 既に存在する場合は削除
        await chrome.bookmarks.remove(bookmarks[0].id);
        showToast('ブックマークから削除しました');
      } else {
        // 存在しない場合は追加（「その他のブックマーク」等に追加される）
        await chrome.bookmarks.create({
          title: tab.title,
          url: tab.url,
        });
        showToast('ブックマークに追加しました');
      }
      // UIを更新
      updateBookmarkButton(tab.url);
      loadBookmarks();
    } catch (error) {
      console.error('ブックマーク操作エラー:', error);
    }
  });
}

async function updateBookmarkButton(url) {
  if (!dom.bookmarkPageBtn) return;

  if (!url || url.startsWith('chrome:') || url.startsWith('chrome-extension:')) {
    dom.bookmarkPageBtn.classList.remove('is-bookmarked');
    dom.bookmarkPageBtn.title = '現在のページはブックマークできません';
    dom.bookmarkPageBtn.disabled = true;
    return;
  }

  dom.bookmarkPageBtn.disabled = false;
  try {
    const bookmarks = await chrome.bookmarks.search({ url });
    const isBookmarked = bookmarks.length > 0;

    dom.bookmarkPageBtn.classList.toggle('is-bookmarked', isBookmarked);
    dom.bookmarkPageBtn.title = isBookmarked ? 'ブックマークを削除' : 'ブックマークに追加';
  } catch (error) {
    console.error('ブックマーク検索エラー:', error);
  }
}

async function updateAddressBar() {
  if (!dom.addressInput || document.activeElement === dom.addressInput) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      dom.addressInput.value = tab.url;
      updateBookmarkButton(tab.url);
    }
  } catch (error) {
    console.error('アドレスバー更新エラー:', error);
  }
}

// ===========================
// タブ管理
// ===========================
async function loadTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    state.tabs = tabs;
    renderTabs();
  } catch (error) {
    console.error('タブの読み込みに失敗:', error);
  }
}

function setupTabListeners() {
  // タブの作成・削除・移動・着脱時は全リストを更新
  chrome.tabs.onCreated.addListener(() => loadTabs());
  chrome.tabs.onRemoved.addListener(() => loadTabs());
  chrome.tabs.onMoved.addListener(() => loadTabs());
  chrome.tabs.onDetached.addListener(() => loadTabs());
  chrome.tabs.onAttached.addListener(() => loadTabs());

  // タブの更新（タイトル、URL、アイコン、ピン状態、ミュート状態など）
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 全リストを更新（changeInfoに関わらず確実な反映のため）
    await loadTabs();

    // 現在のアクティブタブが更新されたらアドレスバーも合わせる
    if (tab.active) {
      updateAddressBar();
      updateNavButtonsStatus(); // 戻る・進むボタンの状態も更新
    }

    // 保存された音量があれば再適用
    if (changeInfo.status === 'complete' && state.tabVolumes[tabId] !== undefined) {
      setTabVolume(tabId, state.tabVolumes[tabId]);
    }
  });

  // タブのアクティブ変更
  chrome.tabs.onActivated.addListener(async () => {
    await loadTabs();
    updateAddressBar(); // アドレスバーとブックマークボタンの状態を更新
    updateNavButtonsStatus(); // 戻る・進むボタンの状態も更新
  });
}

function setupBookmarkListeners() {
  // ブックマークの変動を監視してボタンとリストを更新
  chrome.bookmarks.onCreated.addListener(() => {
    refreshBookmarkUI();
  });
  chrome.bookmarks.onRemoved.addListener(() => {
    refreshBookmarkUI();
  });
  chrome.bookmarks.onMoved.addListener(() => {
    refreshBookmarkUI();
  });
  chrome.bookmarks.onChanged.addListener(() => {
    refreshBookmarkUI();
  });
}

async function refreshBookmarkUI() {
  loadBookmarks();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    updateBookmarkButton(tab.url);
  }
}

function renderTabs() {
  let filteredTabs = state.tabs;

  // 空状態チェック
  if (filteredTabs.length === 0) {
    dom.tabsList.innerHTML = '';
    dom.tabsEmpty.classList.remove('hidden');
    return;
  }
  dom.tabsEmpty.classList.add('hidden');

  // ウィンドウ別にグループ化
  const grouped = {};
  filteredTabs.forEach((tab) => {
    if (!grouped[tab.windowId]) {
      grouped[tab.windowId] = [];
    }
    grouped[tab.windowId].push(tab);
  });

  const windowIds = Object.keys(grouped);
  let html = '';

  windowIds.forEach((windowId, index) => {
    const tabs = grouped[windowId];

    // 複数ウィンドウの場合はセパレーターを表示
    if (windowIds.length > 1) {
      html += `
        <div class="window-separator">
          <span class="window-separator-label">ウィンドウ ${index + 1}</span>
          <div class="window-separator-line"></div>
          <span class="window-separator-count">${tabs.length}</span>
        </div>
      `;
    }

    tabs.forEach((tab) => {
      html += createTabItemHTML(tab);
    });
  });

  dom.tabsList.innerHTML = html;

  // faviconエラーハンドリング
  bindFaviconErrorHandlers(dom.tabsList);

  // イベントバインド
  dom.tabsList.querySelectorAll('.tab-item').forEach((el) => {
    const tabId = parseInt(el.dataset.tabId);

    el.addEventListener('click', (e) => {
      if (e.target.closest('.close-btn')) return;
      activateTab(tabId);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e, tabId);
    });

    const closeBtn = el.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tabId);
      });
    }

    const volumeSlider = el.querySelector('.volume-slider');
    const volumeControl = el.querySelector('.volume-control');

    if (volumeSlider && volumeControl) {
      volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value);
        volumeControl.title = `音量: ${volume}%`;
        setTabVolume(tabId, volume);
      });

      // 並び替え（D&D）との干渉を防ぐガード
      // ボリューム操作エリアに入ったら親のドラッグを無効化
      volumeControl.addEventListener('mouseenter', () => {
        el.draggable = false;
      });
      volumeControl.addEventListener('mouseleave', () => {
        el.draggable = true;
      });

      volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());
      volumeSlider.addEventListener('click', (e) => e.stopPropagation());
    }

    // タブ全体でのマウスホイール調整
    el.addEventListener('wheel', (e) => {
      if (!volumeSlider || volumeSlider.disabled) return;
      
      // 他のスクロールを阻害しないよう、ボリュームコントロールが表示されている場合のみ奪う
      if (el.classList.contains('show-volume')) {
        e.preventDefault();
        e.stopPropagation();
        
        const step = 5;
        let newValue = parseInt(volumeSlider.value) + (e.deltaY < 0 ? step : -step);
        newValue = Math.max(0, Math.min(100, newValue));
        
        volumeSlider.value = newValue;
        volumeSlider.dispatchEvent(new Event('input'));
      }
    }, { passive: false });

    const muteBtn = el.querySelector('.mute-btn');
    if (muteBtn) {
      muteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab) {
          const newMutedState = !tab.mutedInfo?.muted;
          await chrome.tabs.update(tabId, { muted: newMutedState });
        }
      });
      muteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      muteBtn.addEventListener('mouseenter', () => {
        el.draggable = false;
      });
      muteBtn.addEventListener('mouseleave', () => {
        el.draggable = true;
      });
    }
  });

  bindTabDragAndDrop();
}

let draggedTabId = null;
let draggedBookmarkId = null;

function bindTabDragAndDrop() {
  const tabItems = dom.tabsList.querySelectorAll('.tab-item');

  tabItems.forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      draggedTabId = parseInt(item.dataset.tabId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.tabId);
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      tabItems.forEach(t => t.classList.remove('drag-over-top', 'drag-over-bottom'));
      draggedTabId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;

      item.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < mid) {
        item.classList.add('drag-over-top');
      } else {
        item.classList.add('drag-over-bottom');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over-top', 'drag-over-bottom');

      if (!draggedTabId) return;
      const targetTabId = parseInt(item.dataset.tabId);
      if (draggedTabId === targetTabId) return;

      const targetWindowId = parseInt(item.dataset.windowId);
      let targetIndex = parseInt(item.dataset.index);

      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;

      if (e.clientY >= mid) {
        targetIndex++;
      }

      try {
        await chrome.tabs.move(draggedTabId, { windowId: targetWindowId, index: targetIndex });
      } catch (err) {
        console.error('D&D Error:', err);
      }
    });
  });
}

function createTabItemHTML(tab) {
  const faviconHTML = tab.favIconUrl
    ? `<img class="favicon" src="${escapeHTML(tab.favIconUrl)}" alt="">`
    : getFaviconPlaceholderHTML();

  const pinBadge = tab.pinned
    ? `<svg class="pin-badge" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`
    : '';

  const currentClass = tab.active ? ' current' : '';

  // 表示条件: 再生中、ミュート中、または音量が100以外（調整済み）
  const isMuted = tab.mutedInfo?.muted;
  const volume = state.tabVolumes[tab.id] !== undefined ? state.tabVolumes[tab.id] : 100;
  const shouldShowVolume = tab.audible || isMuted || volume !== 100;
  const showVolumeClass = shouldShowVolume ? ' show-volume' : '';
  const mutedPlayingClass = (isMuted && tab.audible) ? ' muted-playing' : '';

  const muteIcon = isMuted
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

  return `
    <div class="tab-item${currentClass}${showVolumeClass}${mutedPlayingClass}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-index="${tab.index}" draggable="true">
      ${faviconHTML}
      <div class="tab-item-info">
        <div class="tab-item-title">${escapeHTML(tab.title || '新しいタブ')}</div>
        <div class="tab-item-url">${escapeHTML(getDisplayUrl(tab.url))}</div>
      </div>
      ${pinBadge}
      <div class="volume-control" title="${isMuted ? 'ミュート中' : '音量: ' + volume + '%'}">
        <button class="mute-btn${isMuted ? ' is-muted' : ''}" title="${isMuted ? 'ミュート解除' : 'ミュート'}">
          ${muteIcon}
        </button>
        <input type="range" class="volume-slider" min="0" max="100" value="${volume}" ${isMuted ? 'disabled' : ''}>
      </div>
      <button class="close-btn" title="タブを閉じる">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function getFaviconPlaceholderHTML() {
  return '<div class="favicon-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg></div>';
}

// favicon読み込みエラー時にプレースホルダーに差し替え
function bindFaviconErrorHandlers(container) {
  container.querySelectorAll('img.favicon').forEach((img) => {
    img.addEventListener('error', () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'favicon-placeholder';
      placeholder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>';
      img.replaceWith(placeholder);
    });
  });
}

async function activateTab(tabId) {
  try {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab) {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.error('タブのアクティブ化に失敗:', error);
  }
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    console.error('タブのクローズに失敗:', error);
  }
}

/**
 * タブの音量を調整する
 */
async function setTabVolume(tabId, volume) {
  try {
    state.tabVolumes[tabId] = volume;
    
    // スクリプトを実行して音量を変更
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (v) => {
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
          media.volume = v / 100;
        });
        
        // 新しく追加されるビデオ・オーディオ要素も監視（オブザーバー）
        if (!window._volumeObserver) {
          window._volumeObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
              mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {
                  node.volume = window._currentVolume !== undefined ? window._currentVolume : 1.0;
                }
                if (node.querySelectorAll) {
                  node.querySelectorAll('video, audio').forEach(m => {
                    m.volume = window._currentVolume !== undefined ? window._currentVolume : 1.0;
                  });
                }
              });
            });
          });
          window._volumeObserver.observe(document.body, { childList: true, subtree: true });
        }
        window._currentVolume = v / 100;
      },
      args: [volume]
    });
  } catch (error) {
    // セキュリティ制限ページなどは無視
    if (!error.message.includes('cannot be scripted') && !error.message.includes('chrome://')) {
      console.error('音量設定に失敗:', error);
    }
  }
}

// ===========================
// ブックマーク管理
// ===========================
async function loadBookmarks() {
  try {
    const tree = await chrome.bookmarks.getTree();
    state.bookmarks = tree;
    renderBookmarks();
  } catch (error) {
    console.error('ブックマークの読み込みに失敗:', error);
  }
}

function renderBookmarks() {
  if (state.bookmarks.length === 0) {
    dom.bookmarksList.innerHTML = '';
    dom.bookmarksEmpty.classList.remove('hidden');
    return;
  }

  let html = '';

  dom.bookmarksEmpty.classList.add('hidden');
  const root = state.bookmarks[0];
  if (root && root.children) {
    root.children.forEach((child) => {
      html += renderBookmarkNode(child);
    });
  }

  dom.bookmarksList.innerHTML = html;

  // faviconエラーハンドリング
  bindFaviconErrorHandlers(dom.bookmarksList);

  // イベントバインド
  bindBookmarkEvents();
}

function renderBookmarkNode(node) {
  if (node.children) {
    // フォルダ
    const childCount = countBookmarks(node);
    if (childCount === 0 && !node.children.length) return '';

    let childrenHTML = '';
    node.children.forEach((child) => {
      childrenHTML += renderBookmarkNode(child);
    });

    const isOpen = state.openFolderIds.has(node.id);
    const openClass = isOpen ? ' open' : '';

    return `
      <div class="bookmark-folder${openClass}" data-bookmark-id="${node.id}" draggable="true">
        <div class="bookmark-folder-header">
          <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <span class="bookmark-folder-name">${escapeHTML(node.title || 'フォルダ')}</span>
          <span class="bookmark-folder-count">${childCount}</span>
        </div>
        <div class="bookmark-folder-children">
          ${childrenHTML}
        </div>
      </div>
    `;
  } else if (node.url) {
    // ブックマーク
    return createBookmarkItemHTML(node);
  }
  return '';
}

function createBookmarkItemHTML(node) {
  const faviconUrl = getFaviconUrl(node.url);
  const faviconHTML = faviconUrl
    ? `<img class="favicon" src="${escapeHTML(faviconUrl)}" alt="">`
    : getFaviconPlaceholderHTML();

  return `
    <div class="bookmark-item" data-bookmark-id="${node.id}" data-url="${escapeHTML(node.url)}" draggable="true">
      ${faviconHTML}
      <span class="bookmark-item-title">${escapeHTML(node.title || node.url)}</span>
    </div>
  `;
}

function bindBookmarkEvents() {
  // フォルダの開閉
  dom.bookmarksList.querySelectorAll('.bookmark-folder-header').forEach((header) => {
    header.addEventListener('click', () => {
      const folder = header.closest('.bookmark-folder');
      const id = folder.dataset.bookmarkId;
      folder.classList.toggle('open');

      if (folder.classList.contains('open')) {
        state.openFolderIds.add(id);
      } else {
        state.openFolderIds.delete(id);
      }
      saveAppState(); // 状態を保存
    });
  });

  // ブックマークのクリック
  dom.bookmarksList.querySelectorAll('.bookmark-item').forEach((item) => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      if (url) {
        chrome.tabs.create({ url });
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBookmarkContextMenu(e, item.dataset.bookmarkId, item.dataset.url);
    });
  });

  // ドラッグ&ドロップのバインド
  bindBookmarkDragAndDrop();
}

function bindBookmarkDragAndDrop() {
  const items = dom.bookmarksList.querySelectorAll('.bookmark-item, .bookmark-folder');

  items.forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      const id = item.dataset.bookmarkId;
      if (!id) return;

      draggedBookmarkId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);

      // ドラッグ中の表示
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    item.addEventListener('dragend', (e) => {
      e.stopPropagation();
      item.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-into');
      draggedBookmarkId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!draggedBookmarkId) return;

      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;

      item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');

      if (item.classList.contains('bookmark-folder')) {
        const quarter = rect.height / 4;
        if (e.clientY < rect.top + quarter) {
          item.classList.add('drag-over-top');
        } else if (e.clientY > rect.bottom - quarter) {
          item.classList.add('drag-over-bottom');
        } else {
          item.classList.add('drag-over-into');
        }
      } else {
        if (e.clientY < mid) {
          item.classList.add('drag-over-top');
        } else {
          item.classList.add('drag-over-bottom');
        }
      }

      e.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const id = e.dataTransfer.getData('text/plain') || draggedBookmarkId;
      if (!id) return;

      const isOverTop = item.classList.contains('drag-over-top');
      const isOverBottom = item.classList.contains('drag-over-bottom');
      const isOverInto = item.classList.contains('drag-over-into');

      item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');

      const targetId = item.dataset.bookmarkId;
      if (!targetId || id === targetId) return;

      try {
        const targetNodes = await chrome.bookmarks.get(targetId);
        if (!targetNodes || targetNodes.length === 0) return;
        const targetNode = targetNodes[0];

        if (isOverInto && item.classList.contains('bookmark-folder')) {
          // フォルダの中に移動（末尾に追加）
          await chrome.bookmarks.move(id, { parentId: targetId });
        } else {
          // 前後への移動
          let targetIndex = targetNode.index;
          const targetParentId = targetNode.parentId;

          // ルートレベル（ID 0の子）への移動は制限があるため、親が0の場合は何もしないか、適切な処理が必要
          // 通常は「ブックマークバー(1)」や「その他のブックマーク(2)」の配下で動く
          if (targetParentId === '0') {
            return;
          }

          if (isOverBottom) {
            targetIndex++;
          }

          await chrome.bookmarks.move(id, {
            parentId: targetParentId,
            index: targetIndex
          });
        }
      } catch (err) {
        console.error('Bookmark D&D Error:', err);
        // エラーが発生した場合は再描画して状態を復元
        refreshBookmarkUI();
      }
    });
  });
}



async function saveAppState() {
  try {
    await chrome.storage.local.set({
      openFolderIds: Array.from(state.openFolderIds),
      activeTab: state.activeTab
    });
  } catch (error) {
    console.error('状態の保存に失敗:', error);
  }
}

async function loadAppState() {
  try {
    const result = await chrome.storage.local.get(['openFolderIds', 'activeTab']);
    if (result.openFolderIds) {
      state.openFolderIds = new Set(result.openFolderIds);
    }
    if (result.activeTab) {
      state.activeTab = result.activeTab;
    }
  } catch (error) {
    console.error('状態の読み込みに失敗:', error);
  }
}

function countBookmarks(node) {
  let count = 0;
  if (node.url) count = 1;
  if (node.children) {
    node.children.forEach((child) => {
      count += countBookmarks(child);
    });
  }
  return count;
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    // Chrome の内部ページはファビコン取得不可
    if (u.protocol === 'chrome:' || u.protocol === 'chrome-extension:') return null;
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
  } catch {
    return null;
  }
}

// ===========================
// コンテキストメニュー
// ===========================
let contextMenu = null;

function setupContextMenu() {
  document.addEventListener('click', () => {
    removeContextMenu();
  });
}

function removeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

function showTabContextMenu(e, tabId) {
  removeContextMenu();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    {
      label: tab.pinned ? 'ピン留め解除' : 'ピン留め',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>',
      action: () => chrome.tabs.update(tabId, { pinned: !tab.pinned }),
    },
    {
      label: tab.mutedInfo?.muted ? 'ミュート解除' : 'ミュート',
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>',
      action: () => chrome.tabs.update(tabId, { muted: !tab.mutedInfo?.muted }),
    },
    {
      label: 'URLをコピー',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      action: () => {
        navigator.clipboard.writeText(tab.url);
        showToast('URLをコピーしました');
      },
    },
    { divider: true },
    {
      label: 'タブを閉じる',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      action: () => closeTab(tabId),
      className: 'danger',
    },
  ];

  items.forEach((item) => {
    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
    } else {
      const btn = document.createElement('button');
      btn.className = `context-menu-item${item.className ? ' ' + item.className : ''}`;
      btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action();
        removeContextMenu();
      });
      menu.appendChild(btn);
    }
  });

  positionContextMenu(menu, e);
  document.body.appendChild(menu);
  contextMenu = menu;
}

function showBookmarkContextMenu(e, bookmarkId, url) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    {
      label: '新しいタブで開く',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      action: () => chrome.tabs.create({ url }),
    },
    {
      label: 'URLをコピー',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      action: () => {
        navigator.clipboard.writeText(url);
        showToast('URLをコピーしました');
      },
    },
    { divider: true },
    {
      label: 'ブックマークを削除',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
      action: async () => {
        try {
          await chrome.bookmarks.remove(bookmarkId);
          await loadBookmarks();
          showToast('ブックマークを削除しました');
        } catch (error) {
          console.error('ブックマークの削除に失敗:', error);
        }
      },
      className: 'danger',
    },
  ];

  items.forEach((item) => {
    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
    } else {
      const btn = document.createElement('button');
      btn.className = `context-menu-item${item.className ? ' ' + item.className : ''}`;
      btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        item.action();
        removeContextMenu();
      });
      menu.appendChild(btn);
    }
  });

  positionContextMenu(menu, e);
  document.body.appendChild(menu);
  contextMenu = menu;
}

function positionContextMenu(menu, e) {
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;

  // 画面からはみ出さないように調整
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}

// ===========================
// トースト通知
// ===========================
function showToast(message) {
  // 既存のトーストを削除
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // アニメーション表示
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 自動非表示
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ===========================
// ユーティリティ
// ===========================
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDisplayUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:') return url;
    if (u.protocol === 'chrome-extension:') return 'Extension';
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

// ===========================
// ツール設定管理
// ===========================
function loadToolsSettings() {
  const toggleXSidebar = document.getElementById('toggleXSidebar');
  const toggleYtShortsAutoScroll = document.getElementById('toggleYtShortsAutoScroll');

  // 初期値の読み込み
  chrome.storage.local.get({ hideXSidebar: false, autoScrollYtShorts: false }, (result) => {
    if (toggleXSidebar) toggleXSidebar.checked = result.hideXSidebar;
    if (toggleYtShortsAutoScroll) toggleYtShortsAutoScroll.checked = result.autoScrollYtShorts;
  });

  // 変更の保存
  if (toggleXSidebar) {
    toggleXSidebar.addEventListener('change', (e) => chrome.storage.local.set({ hideXSidebar: e.target.checked }));
  }
  if (toggleYtShortsAutoScroll) {
    toggleYtShortsAutoScroll.addEventListener('change', (e) => chrome.storage.local.set({ autoScrollYtShorts: e.target.checked }));
  }
}

// ===========================
// 設定管理 (Gemini API)
// ===========================
function setupSettings() {
  const settingsBtn = document.getElementById('navSettings');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsContainer = document.getElementById('settingsContainer');
  const apiKeyInput = document.getElementById('geminiApiKey');
  const saveKeyBtn = document.getElementById('saveApiKeyBtn');
  const modelSelect = document.getElementById('geminiModelSelect');

  if (!settingsBtn || !settingsContainer || !apiKeyInput || !saveKeyBtn) return;

  // 保存されているAPIキーとモデルを読み込む
  chrome.storage.local.get(['geminiApiKey', 'geminiModel'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
    if (result.geminiModel && modelSelect) {
      modelSelect.value = result.geminiModel;
    }
  });

  // モデルの変更を即時保存
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      chrome.storage.local.set({ geminiModel: modelSelect.value });
      showToast('モデル設定を保存しました');
    });
  }

  // 設定ボタンのクリックで表示/非表示を切り替え
  settingsBtn.addEventListener('click', () => {
    settingsContainer.classList.toggle('hidden');
    if (!settingsContainer.classList.contains('hidden')) {
      apiKeyInput.focus();
    }
  });

  // 閉じるボタン
  closeSettingsBtn.addEventListener('click', () => {
    settingsContainer.classList.add('hidden');
  });

  // APIキーを保存
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();

    if (!key) {
      chrome.storage.local.set({ geminiApiKey: '' }, () => {
        showToast('APIキーを削除しました');
        settingsContainer.classList.add('hidden');
      });
      return;
    }

    saveKeyBtn.disabled = true;
    const originalText = saveKeyBtn.textContent;
    saveKeyBtn.textContent = '確認中...';

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = await response.json();

      if (!response.ok) {
        throw { status: response.status, message: data.error?.message || 'API Error' };
      }

      chrome.storage.local.set({ geminiApiKey: key }, () => {
        alert('APIキーは有効です。正常に保存されました。');
        showToast('APIキーを保存しました');
        settingsContainer.classList.add('hidden');
      });
    } catch (e) {
      alert(getFriendlyErrorMessage(e));
    } finally {
      saveKeyBtn.disabled = false;
      saveKeyBtn.textContent = originalText;
    }
  });

  // 外側をクリックしたら閉じる（任意）
  document.addEventListener('mousedown', (e) => {
    if (!settingsContainer.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsContainer.classList.add('hidden');
    }
  });

  // 利用可能なモデルの確認
  const checkModelsBtn = document.getElementById('checkModelsBtn');
  if (checkModelsBtn) {
    checkModelsBtn.addEventListener('click', async () => {
      chrome.storage.local.get(['geminiApiKey'], async (result) => {
        const apiKey = result.geminiApiKey;
        if (!apiKey) {
          showToast('Gemini APIキーを入力して保存してください。');
          return;
        }
        showToast('モデル一覧を取得中...');
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          const data = await response.json();
          if (!response.ok) {
            throw { status: response.status, message: data.error?.message || 'API Error' };
          }
          if (data.models) {
            const names = data.models
              .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
              .map(m => m.name.replace('models/', ''))
              .join('\n');
            alert("利用可能なモデル一覧:\n" + names);
          } else {
            alert("モデルが見つかりませんでした。");
          }
        } catch (e) {
          alert(getFriendlyErrorMessage(e));
        }
      });
    });
  }
}

// ===========================
// AI音声入力ツール
// ===========================
let mediaRecorder = null;
let audioChunks = [];

function setupVoiceTool() {
  const voiceBtn = document.getElementById('voiceInputBtn');
  const statusDisplay = document.getElementById('voiceStatus');
  const resultArea = document.getElementById('voiceResultArea');
  const voiceModeSelect = document.getElementById('voiceMode');

  if (!voiceBtn || !voiceModeSelect) return;

  // 折りたたみ制御
  const voiceToolHeader = document.getElementById('voiceToolHeader');
  const voiceToolGroup = voiceToolHeader ? voiceToolHeader.closest('.collapsible-group') : null;

  if (voiceToolHeader && voiceToolGroup) {
    chrome.storage.local.get(['voiceToolExpanded'], (result) => {
      if (result.voiceToolExpanded) {
        voiceToolGroup.classList.add('open');
      }
    });

    voiceToolHeader.addEventListener('click', () => {
      const isOpen = voiceToolGroup.classList.toggle('open');
      chrome.storage.local.set({ voiceToolExpanded: isOpen });
    });
  }

  // 保存されている設定を読み込む
  chrome.storage.local.get(['voiceMode'], (result) => {
    if (result.voiceMode) {
      voiceModeSelect.value = result.voiceMode;
    }
  });

  voiceModeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ voiceMode: voiceModeSelect.value });
  });

  // コピーボタンの処理
  const copyBtn = document.getElementById('copyResultBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = resultArea.value;
      if (text) {
        navigator.clipboard.writeText(text);
        showToast('クリップボードにコピーしました');
      }
    });
  }

  // クリアボタンの処理
  const clearBtn = document.getElementById('clearResultBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      resultArea.value = '';
      const previewArea = document.getElementById('voicePreviewArea');
      if (previewArea) {
        previewArea.innerHTML = '';
      }
      if (statusDisplay && statusDisplay.textContent === 'エラーが発生しました') {
        statusDisplay.textContent = '待機中';
        statusDisplay.style.color = 'var(--text-muted, #666)';
      }
    });
  }

  let isRecording = false;
  let isVoiceCancelled = false;
  let recordingStartTime = 0;
  let audioCtx = null;
  let analyser = null;
  let animationId = null;

  const gaugeContainer = document.getElementById('voiceVolumeGaugeContainer');
  const gaugeBar = document.getElementById('voiceVolumeGaugeBar');

  function startVisualizer(stream) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      gaugeContainer.classList.remove('hidden');

      function updateGauge() {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);

        // 音量の平均値を計算
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // スケールに変換（感度調整：128で最大。声の大きさで調整）
        const scale = Math.min(average / 100, 1.2); 
        gaugeBar.style.transform = `scaleX(${scale})`;

        animationId = requestAnimationFrame(updateGauge);
      }
      updateGauge();
    } catch (err) {
      console.error('Visualizer error:', err);
    }
  }

  function stopVisualizer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (gaugeBar) {
      gaugeBar.style.transform = 'scaleX(0)';
    }
    if (gaugeContainer) {
      gaugeContainer.classList.add('hidden');
    }
    analyser = null;
  }

  const cancelBtn = document.getElementById('cancelVoiceBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isVoiceCancelled = true;
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    });
  }

  voiceBtn.addEventListener('click', async () => {
    if (!isRecording) {
      isVoiceCancelled = false;
      // 録音開始
      const result = await chrome.storage.local.get(['geminiApiKey']);
      const apiKey = result.geminiApiKey;
      if (!apiKey) {
        resultArea.value = '設定（歯車アイコン）からGemini APIキーを入力して保存してください。';
        return;
      }

      try {
        // 現在の権限状態を確認
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });

        if (permissionStatus.state === 'denied') {
          resultArea.value = 'マイクの使用がブラウザ設定でブロックされています。アドレスバーのアイコンから「許可」に設定し、ページを再読み込みしてください。';
          statusDisplay.textContent = '設定でブロック中';
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          // UIを元に戻す共通処理
          voiceBtn.style.backgroundColor = 'var(--primary-color, #007bff)';
          voiceBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
          cancelBtn.classList.add('hidden');
          copyBtn.classList.remove('hidden');
          if (clearBtn) clearBtn.classList.remove('hidden');
          stopVisualizer();

          if (isVoiceCancelled) {
            statusDisplay.textContent = '中止しました';
            statusDisplay.style.color = 'var(--text-muted, #666)';
            stream.getTracks().forEach(track => track.stop());
            return;
          }

          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const duration = (Date.now() - recordingStartTime) / 1000;

          // 1.5秒未満は短すぎると判断して中断
          if (duration < 1.5) {
            statusDisplay.textContent = '待機中';
            statusDisplay.style.color = 'var(--text-muted, #666)';
            resultArea.value = '音声が短すぎます（1.5秒以上お話しください）。';
            stream.getTracks().forEach(track => track.stop());
            return;
          }

          statusDisplay.textContent = '認識・生成中...';
          statusDisplay.style.color = 'var(--primary-color, #007bff)';

          try {
            const base64Data = await blobToBase64(audioBlob);
            const mode = voiceModeSelect.value;
            await sendToGemini(base64Data, apiKey, resultArea, statusDisplay, mode);
          } catch (e) {
            console.error('Gemini API Error:', e);
            const friendlyMsg = getFriendlyErrorMessage(e);
            resultArea.value = friendlyMsg;
            statusDisplay.textContent = 'エラーが発生しました';
            statusDisplay.style.color = 'var(--danger, red)';
          }

          // マイク解放
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();
        startVisualizer(stream);

        // 録音中の見た目
        voiceBtn.style.backgroundColor = 'red';
        voiceBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width: 24px; height: 24px;"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
        statusDisplay.textContent = '録音中... (クリックで停止)';
        statusDisplay.style.color = 'red';
        resultArea.value = '';

        // ボタンの切り替え
        copyBtn.classList.add('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
        cancelBtn.classList.remove('hidden');

      } catch (err) {
        console.error('マイクへのアクセスに失敗しました', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          // サイドパネルではプロンプトが出せないため、小さなポップアップを一時的に開いてダイアログを出す
          resultArea.value = 'マイクの使用許可が必要です。一時的に開かれるポップアップで「許可」を選択してください。';
          chrome.windows.create({
            url: chrome.runtime.getURL('sidepanel.html?requestMic=true&autoClose=true'),
            type: 'popup',
            width: 1,
            height: 1,
            focused: true
          });
          statusDisplay.textContent = '許可待ち...';
        } else {
          resultArea.value = '録音を開始できませんでした: ' + err.message;
          statusDisplay.textContent = 'エラーが発生しました';
        }
      }
    } else {
      // 録音停止（通常）
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      isRecording = false;
    }
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // "data:audio/webm;base64,xxxx" の "xxxx" 部分のみ取り出す
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getFriendlyErrorMessage(error) {
  const message = (error.message || '').toLowerCase();
  const status = error.status;

  if (message.includes('system_page_restricted')) {
    return '【制限】セキュリティ制限により取得できません。通常のウェブサイトで実行してください。';
  }
  if (message.includes('不足') || message.includes('取得できませんでした')) {
    return '【エラー】ページのテキスト内容が不足しているか、取得できません。動的なコンテンツのみのページや、テキストが含まれないページの可能性があります。';
  }
  if (status === 401 || status === 403 || message.includes('invalid') || message.includes('api_key') || message.includes('not valid')) {
    return '【エラー】APIキーが無効です。設定から正しいAPIキーを入力してください。';
  }
  if (status === 429 || message.includes('quota') || message.includes('too many requests')) {
    return '【エラー】リクエスト上限に達しました。しばらく時間を置いてから再度お試しください。';
  }
  if (status === 503 || message.includes('overloaded') || message.includes('high demand') || message.includes('temporarily unavailable')) {
    return '【エラー】AIモデルが現在大変混み合っています。少し時間をおくか、モデルを変更してお試しください。';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return '【エラー】ネットワーク接続に問題があります。接続を確認してください。';
  }

  return `【エラー】処理中に問題が発生しました。\n(詳細: ${error.message || '不明なエラー'})`;
}

async function sendToGemini(base64Audio, apiKey, resultArea, statusDisplay, mode) {
  const resultObj = await chrome.storage.local.get(['geminiModel']);
  const modelId = resultObj.geminiModel || "gemini-3.1-flash-lite-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  // 品質チェック用の共通指示
  const qualityInstruction = "\n\n重要：提供された音声が極端に短い、またはノイズのみで情報が含まれていない、内容が聞き取り不能な場合は、指示に従って生成するのではなく、必ず「音声が短すぎるか、内容が聞き取れませんでした。もう一度お話しください。」というメッセージのみを出力してください。";

  // モードに応じたプロンプトの出し分け
  let promptText = "";
  switch (mode) {
    case 'summary':
      promptText = "提供された音声を解析し、内容の要点を簡潔にまとめてください。主要なポイントを構造化されたMarkdown形式の箇条書きで出力してください。挨拶や解説は不要です。" + qualityInstruction;
      break;
    case 'business':
      promptText = "提供された音声の内容を、ビジネスシーンでそのまま使える丁寧な敬語（です・ます調）の文章に変換してください。論理構成を整え、Markdown形式（見出しや引用を適宜使用）で自然なビジネス文書の形式で出力してください。解説は不要です。" + qualityInstruction;
      break;
    case 'minutes':
      promptText = "提供された音声から詳細なMarkdown形式の議事録を作成してください。以下の項目を含めて整理してください：\n1. 内容の要旨\n2. 決定事項\n3. ネクストアクション（課題）\n項目ごとに分かりやすく構造化し、挨拶や余計な解説を省いて出力してください。" + qualityInstruction;
      break;
    case 'bullets':
      promptText = "提供された音声の内容をすべて網羅的に箇条書きに分解して整理してください。情報の階層構造（親子関係）を意識して、論理的にネストされたMarkdown形式のリスト形式で出力してください。解説は不要です。" + qualityInstruction;
      break;
    case 'standard':
    default:
      promptText = "提供された音声を解析して、論理的で自然な文章に整えてください。「えー」「あのー」などのフィラーを取り除き、文脈を補完して読みやすくしてください。挨拶や余計な解説を省き、Markdown形式（改行や強調を適切に使用）で出力してください。" + qualityInstruction;
      break;
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: promptText
          },
          {
            inlineData: {
              mimeType: "audio/webm",
              data: base64Audio
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    const errorMsg = errorData.error?.message || 'API Error';
    throw { status: response.status, message: errorMsg };
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  resultArea.value = text;
  updateMarkdownPreview(resultArea.id.includes('voice') ? 'voice' : 'summary');

  statusDisplay.textContent = '完了';
  statusDisplay.style.color = 'var(--text-color, #333)';
}

// ===========================
// AIページ要約ツール
// ===========================
function setupSummaryTool() {
  const summaryBtn = document.getElementById('summarizeBtn');
  const copyBtn = document.getElementById('copySummaryBtn');
  const clearBtn = document.getElementById('clearSummaryBtn');
  const resultArea = document.getElementById('summaryResultArea');
  const statusDisplay = document.getElementById('summaryStatus');
  const modeSelect = document.getElementById('summaryMode');

  if (!summaryBtn || !resultArea || !modeSelect) return;

  // 折りたたみ制御
  const header = document.getElementById('summaryToolHeader');
  const group = header ? header.closest('.collapsible-group') : null;
  if (header && group) {
    chrome.storage.local.get(['summaryToolExpanded'], (result) => {
      if (result.summaryToolExpanded) group.classList.add('open');
    });
    header.addEventListener('click', () => {
      const isOpen = group.classList.toggle('open');
      chrome.storage.local.set({ summaryToolExpanded: isOpen });
    });
  }

  // 保存設定の読み込み
  chrome.storage.local.get(['summaryMode'], (result) => {
    if (result.summaryMode) modeSelect.value = result.summaryMode;
  });
  modeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ summaryMode: modeSelect.value });
  });

  // 要約実行
  summaryBtn.addEventListener('click', async () => {
    const res = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = res.geminiApiKey;
    if (!apiKey) {
      resultArea.value = '設定（歯車アイコン）からGemini APIキーを入力して保存してください。';
      return;
    }

    statusDisplay.textContent = 'ページ内容を取得中...';
    statusDisplay.style.display = 'block';
    resultArea.value = '';

    try {
      const text = await getActiveTabText();
      if (!text || text.trim().length < 20) {
        throw new Error('ページのテキスト内容が不足しているか、取得できませんでした。');
      }

      statusDisplay.textContent = '要約を作成中...';
      const mode = modeSelect.value;
      await sendTextToGemini(text, apiKey, resultArea, statusDisplay, mode);
    } catch (e) {
      console.error('Summary Error:', e);
      const friendlyMsg = getFriendlyErrorMessage(e);
      resultArea.value = friendlyMsg;
      statusDisplay.textContent = 'エラーが発生しました';
      statusDisplay.style.color = 'var(--danger)';
    }
  });

  // コピー・クリア
  copyBtn.addEventListener('click', () => {
    if (resultArea.value) {
      navigator.clipboard.writeText(resultArea.value);
      showToast('クリップボードにコピーしました');
    }
  });
  clearBtn.addEventListener('click', () => {
    resultArea.value = '';
    const previewArea = document.getElementById('summaryPreviewArea');
    if (previewArea) {
      previewArea.innerHTML = '';
    }
    if (statusDisplay && statusDisplay.textContent === 'エラーが発生しました') {
      statusDisplay.style.display = 'none';
      statusDisplay.textContent = '';
    }
  });

  // Markdown形式でコピー
  const copyMdBtn = document.getElementById('copyMdBtn');
  if (copyMdBtn) {
    copyMdBtn.addEventListener('click', async () => {
      statusDisplay.textContent = 'ページ内容を取得中...';
      statusDisplay.style.display = 'block';
      statusDisplay.style.color = 'var(--text-muted)';

      try {
        const data = await getActivePageData();
        if (!data || !data.text || data.text.trim().length < 20) {
          throw new Error('ページのテキスト内容が不足しているか、取得できませんでした。');
        }

        const mdText = `# ${data.title}\nURL: ${data.url}\n\n---\n\n${data.text}`;
        await navigator.clipboard.writeText(mdText);

        showToast('MD形式でコピーしました');
        statusDisplay.textContent = 'コピー完了';
        statusDisplay.style.color = 'var(--text-primary)';
        setTimeout(() => {
          if (statusDisplay.textContent === 'コピー完了') {
            statusDisplay.style.display = 'none';
          }
        }, 3000);
      } catch (e) {
        console.error('MD Export Error:', e);
        const friendlyMsg = getFriendlyErrorMessage(e);
        resultArea.value = friendlyMsg;
        showToast('内容を取得できませんでした');
        statusDisplay.textContent = 'エラーが発生しました';
        statusDisplay.style.color = 'var(--danger)';
      }
    });
  }
}

async function getActivePageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;

  // chrome:// や edge:// などのシステムページはスクリプト実行不可
  if (tab.url.startsWith('chrome:') || tab.url.startsWith('edge:') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension:')) {
    throw new Error('SYSTEM_PAGE_RESTRICTED');
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: window.location.href,
        text: document.body.innerText
      })
    });
    return results[0]?.result;
  } catch (err) {
    console.error('Scripting Error:', err);
    throw new Error('ページのテキスト内容を取得できませんでした。');
  }
}

async function getActiveTabText() {
  const data = await getActivePageData();
  return data ? data.text : null;
}

async function sendTextToGemini(text, apiKey, resultArea, statusDisplay, mode) {
  const resultObj = await chrome.storage.local.get(['geminiModel']);
  const modelId = resultObj.geminiModel || "gemini-3.1-flash-lite-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  let promptText = "";
  switch (mode) {
    case 'bullets':
      promptText = "以下のウェブページの内容を、重要なポイントに絞って構造化されたMarkdown形式の箇条書き（ネスト形式）でまとめてください。解説や前段の挨拶は省き、本文のみを出力してください。\n\n内容:\n" + text;
      break;
    case 'detailed':
      promptText = "以下のウェブページの内容を詳細にMarkdown形式で解説してください。見出し、強調、リスト等を使用して背景、主要な主張、結論、および注目すべき詳細を含めて丁寧に説明してください。\n\n内容:\n" + text;
      break;
    case 'summary':
    default:
      promptText = "以下のウェブページの内容をMarkdown形式で簡潔に要約してください。全体像がひと目で分かるようにまとめ、改行や強調を適切に使用してください。\n\n内容:\n" + text;
      break;
  }

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw { status: response.status, message: errorData.error?.message || 'API Error' };
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  resultArea.value = resultText;
  updateMarkdownPreview('summary');
  statusDisplay.textContent = '完了';
  statusDisplay.style.color = 'var(--text-primary)';
  setTimeout(() => { statusDisplay.style.display = 'none'; }, 3000);
}

// ===========================
// マークダウン・ビューアー共有ロジック
// ===========================

/**
 * プレビューの更新
 */
function updateMarkdownPreview(group) {
  const resultArea = document.getElementById(group === 'voice' ? 'voiceResultArea' : 'summaryResultArea');
  const previewArea = document.getElementById(group === 'voice' ? 'voicePreviewArea' : 'summaryPreviewArea');
  
  if (!resultArea || !previewArea) return;
  
  const markdown = resultArea.value;
  // marked が読み込まれているか確認
  if (typeof marked !== 'undefined') {
    previewArea.innerHTML = marked.parse(markdown);
  } else {
    // フォールバック
    previewArea.innerText = markdown;
  }
}

/**
 * 出力タブの切り替え
 */
function setupOutputTabs() {
  const tabs = document.querySelectorAll('.output-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      const group = tab.dataset.group;
      const targetId = tab.dataset.target;
      
      // 同じグループのタブのアクティブ状態を更新
      document.querySelectorAll(`.output-tab[data-group="${group}"]`).forEach(t => {
        t.classList.toggle('active', t === tab);
      });
      
      // テキストエリアとプレビューの表示切替
      const resultArea = document.getElementById(group === 'voice' ? 'voiceResultArea' : 'summaryResultArea');
      const previewArea = document.getElementById(group === 'voice' ? 'voicePreviewArea' : 'summaryPreviewArea');
      
      if (mode === 'edit') {
        resultArea.classList.remove('hidden');
        previewArea.classList.add('hidden');
      } else {
        updateMarkdownPreview(group);
        resultArea.classList.add('hidden');
        previewArea.classList.remove('hidden');
      }
    });
  });
}

// 初期化時にタブセットアップを追加
// 既に DOMContentLoaded 內で setupVoiceTool と setupSummaryTool を呼んでいるので、
// それらの関数內で呼ぶか、個別に初期化します。
document.addEventListener('DOMContentLoaded', () => {
  // marked の初期設定
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: false,
      mangle: false
    });
  }

  setupOutputTabs();
  
  // 要約や音声入力のテキストエリアが変更されたらプレビューも更新するようにイベントバインド
  ['voiceResultArea', 'summaryResultArea'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        updateMarkdownPreview(id.includes('voice') ? 'voice' : 'summary');
      });
    }
  });
});
