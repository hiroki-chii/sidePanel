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
  isSplitView: true, // 分割表示モード (固定)
  splitRatio: 50, // 分割比率 (0-100)
  theme: 'system', // 'light' | 'dark' | 'system'
};

// ===========================
// DOM参照
// ===========================
const dom = {
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
  navTools: document.getElementById('navTools'),
  navFeatures: document.getElementById('navFeatures'),
  navMain: document.getElementById('navMain'),
  splitResizer: document.getElementById('splitResizer'),
  addressSuggestions: document.getElementById('addressSuggestions'),
  newFolderBtn: document.getElementById('newFolderBtn'),
};

// ===========================
// 初期化
// ===========================
document.addEventListener('DOMContentLoaded', async () => {

  setupNavigation();
  setupAddressBar();
  setupBookmarkAction();
  setupContextMenu();
  setupTabListeners(); // タブのイベントリスナーを設定
  updateNavButtonsStatus(); // ナビゲーションボタンの状態を初期更新
  setupResizer(); // リサイザーの初期化
  setupGlobalDragAndDrop(); // グローバルなD&D（切り離し、背景ドロップ等）の初期化
  loadTabs();
  await loadAppState(); // 保存された状態を読み込む
  switchTab(state.activeTab); // 保存されたタブに切り替え
  loadBookmarks();
  setupBookmarkListeners();
  setupBookmarkFolderActions();
  loadToolsSettings();
  setupFeatures(); // 機能一覧パネルの初期化
  setupSummaryTool(); // ページ要約ツールの初期化
  setupCustomModal(); // カスタムダイアログの初期化

  // 初期化時に全画面状態をチェック
  updateFullscreenHighlight();
  setupTheme(); // テーマ切り替えの初期化
});

// ===========================
// アクション関連
// ===========================

/**
 * 分割表示のセットアップ
 */

/**
 * 分割表示の適用
 */
function applySplitView() {
  const content = document.querySelector('.content');
  if (!content) return;

  content.classList.toggle('split-mode', state.isSplitView);

  if (state.isSplitView) {
    const addressBar = document.getElementById('addressBarContainer');
    if (addressBar) addressBar.style.display = 'flex';

    renderTabs();
    renderBookmarks();
    applySplitRatio(); // 比率を適用
  }
}

/**
 * リサイザーのセットアップ
 */
function setupResizer() {
  if (!dom.splitResizer) return;

  let isDragging = false;

  dom.splitResizer.addEventListener('mousedown', (e) => {
    if (!state.isSplitView) return;
    isDragging = true;
    dom.splitResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !state.isSplitView) return;

    const content = document.querySelector('.content');
    const rect = content.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const totalWidth = rect.width;

    if (totalWidth <= 0) return;

    // 比率を計算 (0-100)
    let ratio = (offsetX / totalWidth) * 100;

    // 制約の適用
    const minTabWidth = 50; // 「新規タブを追加」が改行されない最小
    const minBookmarkWidth = 60; // ファビコンが見える最小

    const minTabRatio = (minTabWidth / totalWidth) * 100;
    const minBookmarkRatio = (minBookmarkWidth / totalWidth) * 100;

    ratio = Math.max(minTabRatio, Math.min(100 - minBookmarkRatio, ratio));

    state.splitRatio = ratio;
    applySplitRatio();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      dom.splitResizer.classList.remove('dragging');
      document.body.style.cursor = '';
      saveAppState();
    }
  });

  // ウィンドウサイズ変更時にも比率を再計算
  window.addEventListener('resize', () => {
    if (state.isSplitView) applySplitRatio();
  });
}

/**
 * 分割比率の適用
 */
function applySplitRatio() {
  const content = document.querySelector('.content');
  if (!content || !state.isSplitView) return;

  const ratio = state.splitRatio || 50;
  content.style.setProperty('--tabs-width', `${ratio}%`);
  content.style.setProperty('--bookmarks-width', `${100 - ratio}%`);

  // 各パネルの表示モード切り替え（ファビコンのみにするか）
  const contentWidth = content.getBoundingClientRect().width;
  if (contentWidth > 0) {
    const tabWidth = contentWidth * (ratio / 100);
    const bookmarkWidth = contentWidth * ((100 - ratio) / 100);

    let currentMode = 'large';
    if (tabWidth > 165) {
      currentMode = 'large';
    } else if (tabWidth > 130) {
      currentMode = 'normal';
    } else if (tabWidth > 95) {
      currentMode = 'compact';
    } else {
      currentMode = 'minimal';
    }

    // ウィンドウセパレーターのラベル制御（タブパネル内のみを対象にする）
    const windowLabels = dom.tabsPanel.querySelectorAll('.window-separator-label');
    windowLabels.forEach(label => {
      const index = label.dataset.index;
      if (currentMode === 'large' || currentMode === 'normal') {
        label.textContent = `WINDOW ${index}`;
      } else if (currentMode === 'compact') {
        label.textContent = `WIN ${index}`;
      } else {
        label.textContent = `W ${index}`;
      }
    });

    // パネルの表示モードクラスを更新
    if (dom.tabsPanel) {
      dom.tabsPanel.classList.remove('mode-large', 'mode-normal', 'mode-compact', 'mode-minimal', 'favicon-only');
      dom.tabsPanel.classList.add(`mode-${currentMode}`);
      // 後方互換性のための favicon-only (必要な場合)
      if (currentMode === 'minimal') dom.tabsPanel.classList.add('favicon-only');
    }

    // ブックマークパネルは従来通りの判定を維持（または必要に応じて拡張）
    if (dom.bookmarksPanel) {
      const isFaviconOnly = bookmarkWidth < 95;
      dom.bookmarksPanel.classList.toggle('favicon-only', isFaviconOnly);

      // ラベルの更新（×ボタンが消えるタイミングで FOLDER -> FLD に変更）
      const bookmarkLabel = dom.bookmarksPanel.querySelector('.window-separator-label');
      if (bookmarkLabel) {
        bookmarkLabel.textContent = isFaviconOnly ? 'FLD' : 'FOLDER';
      }
    }
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
      await chrome.windows.update(win.id, { state: previousWindowState });
    } else {
      // 現在の状態を記憶してから全画面へ
      previousWindowState = win.state;
      await chrome.windows.update(win.id, { state: 'fullscreen' });
    }
    updateFullscreenHighlight();
  });

  if (dom.navTools) {
    dom.navTools.addEventListener('click', () => {
      const nextTab = state.activeTab === 'tools' ? 'tabs' : 'tools';
      switchTab(nextTab);
    });
  }

  if (dom.navMain) {
    dom.navMain.addEventListener('click', () => {
      switchTab('tabs');
    });
  }
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

/**
 * 全画面状態を監視してハイライトを更新
 */
async function updateFullscreenHighlight() {
  const btn = document.getElementById('navFullscreen');
  if (!btn) return;
  const win = await chrome.windows.getCurrent();
  btn.classList.toggle('active', win.state === 'fullscreen');
}

/**
 * テーマ切り替えのセットアップ
 */
function setupTheme() {
  const btn = document.getElementById('navTheme');
  if (!btn) return;

  btn.addEventListener('click', () => {
    // light -> dark -> system の順で切り替え
    if (state.theme === 'light') {
      state.theme = 'dark';
    } else if (state.theme === 'dark') {
      state.theme = 'system';
    } else {
      state.theme = 'light';
    }
    applyTheme();
    saveAppState();
  });

  // 外部（Gemini上のボタン等）からの変更を監視
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) {
      state.theme = changes.theme.newValue;
      applyTheme();
    }
  });

  // 初期適用
  applyTheme();
}

/**
 * テーマの適用
 */
function applyTheme() {
  const html = document.documentElement;
  const icon = document.getElementById('navThemeIcon');
  const btn = document.getElementById('navTheme');
  if (!html || !icon || !btn) return;

  // クラスのクリーンアップ
  html.classList.remove('light-theme', 'dark-theme');

  // アイコンとクラスの切り替え
  if (state.theme === 'light') {
    html.classList.add('light-theme');
    btn.title = 'テーマ: ライト (クリックでダークに切り替え)';
    icon.innerHTML = `
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    `;
  } else if (state.theme === 'dark') {
    html.classList.add('dark-theme');
    btn.title = 'テーマ: ダーク (クリックでシステムに切り替え)';
    icon.innerHTML = `
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    `;
  } else {
    // system
    btn.title = 'テーマ: システム (クリックでライトに切り替え)';
    icon.innerHTML = `
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    `;
  }
}

// ===========================
// タブナビゲーション
// ===========================

/**
 * ボタンのアクティブ状態を更新（相互排律）
 */
function updateActiveButtons(activeId) {
  if (dom.navMain) {
    dom.navMain.classList.toggle('active', activeId === 'tabs' || activeId === 'bookmarks');
  }
  if (dom.navTools) {
    dom.navTools.classList.toggle('active', activeId === 'tools');
  }
}

function switchTab(tab) {
  state.activeTab = tab;
  // ツール選択時は分割表示を無効化、それ以外は有効化
  state.isSplitView = (tab !== 'tools');

  applySplitView();

  updateActiveButtons(tab);

  // 個別パネルの表示切替（分割モード外の場合）
  if (!state.isSplitView) {
    dom.tabsPanel.classList.remove('active');
    dom.bookmarksPanel.classList.remove('active');
    if (dom.toolsPanel) dom.toolsPanel.classList.add('active');

    const addressBar = document.getElementById('addressBarContainer');
    if (addressBar) addressBar.style.display = 'none';
  } else {
    // 分割モード時は両方表示
    dom.tabsPanel.classList.add('active');
    dom.bookmarksPanel.classList.add('active');
    if (dom.toolsPanel) dom.toolsPanel.classList.remove('active');
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

  // サジェスト機能のセットアップ
  setupAddressSuggestions();

  dom.addressInput.addEventListener('keydown', async (e) => {
    // サジェストが選択されている場合は、Enterでそのサジェストを確定する
    // (setupAddressSuggestions 内の keydown で処理されるため、ここでは通常のEnter処理をガードする)
    if (e.key === 'Enter') {
      const selected = dom.addressSuggestions.querySelector('.suggestion-item.selected');
      if (selected && !dom.addressSuggestions.classList.contains('hidden')) {
        return; // setupAddressSuggestions 側の Enter 処理に任せる
      }

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
        dom.addressSuggestions.classList.add('hidden');
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

  // フォーカス時に全選択
  dom.addressInput.addEventListener('focus', () => {
    dom.addressInput.select();
  });

  // フォーカスが外れたらサジェストを隠す (少し遅延させてクリックイベントを優先)
  dom.addressInput.addEventListener('blur', () => {
    setTimeout(() => {
      dom.addressSuggestions.classList.add('hidden');
    }, 200);
  });
}

/**
 * アドレスバーのサジェスト機能
 */
function setupAddressSuggestions() {
  if (!dom.addressInput || !dom.addressSuggestions) return;

  let selectedIndex = -1;
  let currentSuggestions = [];

  const updateSelection = () => {
    const items = dom.addressSuggestions.querySelectorAll('.suggestion-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === selectedIndex);
      if (index === selectedIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  dom.addressInput.addEventListener('input', async () => {
    const query = dom.addressInput.value.trim();
    if (query.length < 1) {
      dom.addressSuggestions.classList.add('hidden');
      currentSuggestions = [];
      return;
    }

    // 各ソースから検索 (個別にtry-catchして、一部のAPIが失敗しても他を表示できるようにする)
    let tabs = [];
    let history = [];
    let bookmarks = [];

    try {
      [tabs, history, bookmarks] = await Promise.all([
        chrome.tabs.query({}).catch(() => []),
        (chrome.history ? chrome.history.search({ text: query, maxResults: 5 }).catch(() => []) : Promise.resolve([])),
        chrome.bookmarks.search(query).catch(() => [])
      ]);
    } catch (err) {
      console.error('サジェスト取得エラー:', err);
    }

    // フィルタリングと整形
    const queryLower = query.toLowerCase();

    // タブ: タイトルまたはURLがマッチするもの
    const tabResults = tabs
      .filter(t => (t.title && t.title.toLowerCase().includes(queryLower)) || (t.url && t.url.toLowerCase().includes(queryLower)))
      .slice(0, 3)
      .map(t => ({ type: 'tab', title: t.title, url: t.url, tabId: t.id, windowId: t.windowId }));

    // ブックマーク
    const bookmarkResults = (bookmarks || [])
      .filter(b => b.url)
      .slice(0, 3)
      .map(b => ({ type: 'bookmark', title: b.title, url: b.url }));

    // 履歴
    const historyResults = (history || [])
      .filter(h => h.url)
      .map(h => ({ type: 'history', title: h.title || h.url, url: h.url }));

    // 重複削除 (URLをキーにする)
    const seenUrls = new Set();
    // 現在のタブは除外（URLが一致する場合）
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) seenUrls.add(activeTab.url);
    } catch (e) { }

    currentSuggestions = [...tabResults, ...bookmarkResults, ...historyResults]
      .filter(item => {
        if (!item.url) return false;
        if (seenUrls.has(item.url)) return false;
        seenUrls.add(item.url);
        return true;
      })
      .slice(0, 10);

    renderSuggestions(currentSuggestions);
    selectedIndex = -1;
  });

  dom.addressInput.addEventListener('keydown', (e) => {
    if (dom.addressSuggestions.classList.contains('hidden')) return;

    const items = dom.addressSuggestions.querySelectorAll('.suggestion-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection();
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0) {
        e.preventDefault();
        handleSuggestionSelect(currentSuggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      dom.addressSuggestions.classList.add('hidden');
    }
  });

  function renderSuggestions(suggestions) {
    if (suggestions.length === 0) {
      dom.addressSuggestions.classList.add('hidden');
      return;
    }

    dom.addressSuggestions.innerHTML = suggestions.map((s, i) => `
      <div class="suggestion-item ${s.type}" data-index="${i}">
        <div class="suggestion-icon">
          ${getSuggestionIcon(s.type)}
        </div>
        <div class="suggestion-info">
          <div class="suggestion-title">${escapeHTML(s.title || '無題')}</div>
          <div class="suggestion-url">${escapeHTML(s.url)}</div>
        </div>
        <div class="suggestion-type">${getSuggestionTypeText(s.type)}</div>
      </div>
    `).join('');

    dom.addressSuggestions.classList.remove('hidden');

    // クリックイベント
    dom.addressSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        handleSuggestionSelect(suggestions[index]);
      });
    });
  }

  async function handleSuggestionSelect(suggestion) {
    dom.addressSuggestions.classList.add('hidden');
    dom.addressInput.blur();

    if (suggestion.type === 'tab') {
      // タブ切り替え
      await chrome.tabs.update(suggestion.tabId, { active: true });
      await chrome.windows.update(suggestion.windowId, { focused: true });
    } else {
      // ページ遷移
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.update(tab.id, { url: suggestion.url });
      } else {
        await chrome.tabs.create({ url: suggestion.url });
      }
    }
    updateAddressBar();
  }

  function getSuggestionIcon(type) {
    if (type === 'tab') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>';
    if (type === 'bookmark') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  }

  function getSuggestionTypeText(type) {
    if (type === 'tab') return 'タブ';
    if (type === 'bookmark') return 'ブックマーク';
    return '履歴';
  }
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
        // 存在しない場合は追加（ブックマークバーに追加）
        await chrome.bookmarks.create({
          parentId: '1',
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

/**
 * フォルダ作成の初期設定
 */
function setupBookmarkFolderActions() {
  if (!dom.newFolderBtn) return;
  dom.newFolderBtn.addEventListener('click', () => {
    createBookmarkFolder();
  });
}

/**
 * フォルダの作成
 */
async function createBookmarkFolder(parentId = '1') {
  const name = prompt('新しいフォルダの名前を入力してください:', '新規フォルダ');
  if (name === null) return;

  try {
    await chrome.bookmarks.create({
      parentId: parentId,
      title: name || '新規フォルダ'
    });
    showToast('フォルダを作成しました');
    // loadBookmarks() は setupBookmarkListeners のリスナーにより自動で呼ばれるはずだが、
    // 念のためここでも呼ぶか、onCreated を待つ
  } catch (error) {
    console.error('フォルダ作成エラー:', error);
    showToast('フォルダの作成に失敗しました');
  }
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
  });

  // タブのアクティブ変更
  chrome.tabs.onActivated.addListener(async () => {
    await loadTabs();
    updateAddressBar(); // アドレスバーとブックマークボタンの状態を更新
    updateNavButtonsStatus(); // 戻る・進むボタンの状態も更新
  });

  // ウィンドウの状態変更を監視（全画面ハイライト用）
  chrome.windows.onBoundsChanged.addListener(() => {
    updateFullscreenHighlight();
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

    // 全てのウィンドウでセパレーターを表示（ユーザーの「各ウィンドウに」という要望に応えるため、また一貫性のため）
    html += `
      <div class="window-separator">
        <span class="window-separator-label" data-index="${index + 1}">WINDOW ${index + 1}</span>
        <button class="window-new-tab-btn" data-window-id="${windowId}" title="このウィンドウに新しいタブを追加">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    `;

    tabs.forEach((tab) => {
      html += createTabItemHTML(tab);
    });
  });

  dom.tabsList.innerHTML = html;

  // faviconエラーハンドリング
  bindFaviconErrorHandlers(dom.tabsList);

  // イベントバインド
  dom.tabsList.querySelectorAll('.window-new-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const windowId = parseInt(btn.dataset.windowId);
      chrome.tabs.create({ windowId });
    });
  });

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

    const pinBtn = el.querySelector('.pin-btn');
    if (pinBtn) {
      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab) {
          await chrome.tabs.update(tabId, { pinned: !tab.pinned });
        }
      });
      pinBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    }

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
      if (!draggedTabId && !draggedBookmarkId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = draggedTabId ? 'move' : 'copy';

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
      e.stopPropagation(); // documentレベルのdetachハンドラへの伝播を防止
      item.classList.remove('drag-over-top', 'drag-over-bottom');

      if (!draggedTabId && !draggedBookmarkId) return;
      
      const targetWindowId = parseInt(item.dataset.windowId);
      let targetIndex = parseInt(item.dataset.index);

      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;

      if (e.clientY >= mid) {
        targetIndex++;
      }

      try {
        if (draggedTabId) {
          const targetTabId = parseInt(item.dataset.tabId);
          if (draggedTabId === targetTabId) return;
          await chrome.tabs.move(draggedTabId, { windowId: targetWindowId, index: targetIndex });
        } else if (draggedBookmarkId) {
          const [bookmark] = await chrome.bookmarks.get(draggedBookmarkId);
          if (bookmark && bookmark.url) {
            await chrome.tabs.create({
              windowId: targetWindowId,
              index: targetIndex,
              url: bookmark.url,
              active: false
            });
          }
        }
      } catch (err) {
        console.error('D&D Error:', err);
      }
    });
  });
}

/**
 * タブを背景にドロップして新規ウィンドウに切り離す機能
 * documentレベルでリスンし、タブドラッグ中に.tab-item以外に
 * ドロップしたら新規ウィンドウへ切り離す
 */
/**
 * グローバルなドラッグ＆ドロップのセットアップ
 * タブの切り離し（新規ウィンドウ化）や、背景へのブックマークドロップを管理
 */
function setupGlobalDragAndDrop() {
  const handleDragOver = (e) => {
    const isOverTabItem = e.target.closest('.tab-item');
    const isOverTabsPanel = e.target.closest('#tabsPanel');

    // ブックマークをドラッグ中：タブパネルの上（アイテム以外）ならドロップ許可
    if (draggedBookmarkId && isOverTabsPanel && !isOverTabItem) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }

    // タブをドラッグ中
    if (draggedTabId) {
      if (!isOverTabsPanel) {
        // パネル外：切り離し許可
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      } else if (!isOverTabItem) {
        // パネル内の背景：ドロップを許可（末尾追加等）
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    }
  };

  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('dragenter', handleDragOver);

  document.addEventListener('drop', async (e) => {
    const isOverTabItem = e.target.closest('.tab-item');
    const isOverTabsPanel = e.target.closest('#tabsPanel');
    
    // タブの切り離し（新規ウィンドウ化）
    if (draggedTabId && !isOverTabsPanel) {
      e.preventDefault();
      try {
        await chrome.windows.create({ tabId: draggedTabId });
      } catch (err) {
        console.error('新規ウィンドウ切り離しエラー:', err);
      }
    } 
    // ブックマークをタブパネルの背景にドロップ（現在のウィンドウの末尾に追加）
    else if (draggedBookmarkId && isOverTabsPanel && !isOverTabItem) {
      e.preventDefault();
      try {
        const [bookmark] = await chrome.bookmarks.get(draggedBookmarkId);
        if (bookmark && bookmark.url) {
          await chrome.tabs.create({ url: bookmark.url, active: false });
        }
      } catch (err) {
        console.error('ブックマーク背景ドロップエラー:', err);
      }
    }
  });
}

function createTabItemHTML(tab) {
  const faviconHTML = tab.favIconUrl
    ? `<img class="favicon" src="${escapeHTML(tab.favIconUrl)}" alt="">`
    : getFaviconPlaceholderHTML();


  const currentClass = tab.active ? ' current' : '';

  // 表示条件: 再生中またはミュート中
  const isMuted = tab.mutedInfo?.muted;
  const shouldShowMute = tab.audible || isMuted;
  const showMuteClass = shouldShowMute ? ' show-mute' : '';
  const mutedPlayingClass = (isMuted && tab.audible) ? ' muted-playing' : '';

  const muteIcon = isMuted
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

  return `
    <div class="tab-item${currentClass}${showMuteClass}${mutedPlayingClass}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-index="${tab.index}" draggable="true" title="${escapeHTML(tab.title || '新しいタブ')}">
      ${faviconHTML}
      <div class="tab-item-info">
        <div class="tab-item-title">${escapeHTML(tab.title || '新しいタブ')}</div>
        <div class="tab-item-url">${escapeHTML(getDisplayUrl(tab.url))}</div>
      </div>
      <div class="mute-control" title="${isMuted ? 'ミュート中' : '音声再生中'}">
        <button class="mute-btn${isMuted ? ' is-muted' : ''}" title="${isMuted ? 'ミュート解除' : 'ミュート'}">
          ${muteIcon}
        </button>
      </div>
      <button class="pin-btn${tab.pinned ? ' is-pinned' : ''}" title="${tab.pinned ? 'ピン留め解除' : 'ピン留め'}">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
        </svg>
      </button>
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

    let childrenHTML = '';
    node.children.forEach((child) => {
      childrenHTML += renderBookmarkNode(child);
    });

    const isOpen = state.openFolderIds.has(node.id);
    const openClass = isOpen ? ' open' : '';

    return `
      <div class="bookmark-folder${openClass}" data-bookmark-id="${node.id}" draggable="true" title="${escapeHTML(node.title || 'フォルダ')}">
        <div class="bookmark-folder-header">
          <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          <span class="bookmark-folder-name">${escapeHTML(node.title || 'フォルダ')}</span>
          <span class="bookmark-folder-count">${childCount}</span>
          ${node.parentId === '0' ? '' : `
          <button class="bookmark-delete-btn" title="フォルダを削除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
          `}
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
    <div class="bookmark-item" data-bookmark-id="${node.id}" data-url="${escapeHTML(node.url)}" draggable="true" title="${escapeHTML(node.title || node.url)}">
      ${faviconHTML}
      <span class="bookmark-item-title">${escapeHTML(node.title || node.url)}</span>
      <button class="bookmark-delete-btn" title="ブックマークを削除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function bindBookmarkEvents() {
  // フォルダの開閉
  dom.bookmarksList.querySelectorAll('.bookmark-folder-header').forEach((header) => {
    const folder = header.closest('.bookmark-folder');
    const id = folder.dataset.bookmarkId;

    header.addEventListener('click', () => {
      folder.classList.toggle('open');

      if (folder.classList.contains('open')) {
        state.openFolderIds.add(id);
      } else {
        state.openFolderIds.delete(id);
      }
      saveAppState(); // 状態を保存
    });

    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBookmarkContextMenu(e, id, null); // url=null はフォルダを意味する
    });

    const deleteBtn = header.querySelector('.bookmark-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleBookmarkDelete(id, null);
      });
    }
  });

  // ブックマークのクリック
  dom.bookmarksList.querySelectorAll('.bookmark-item').forEach((item) => {
    const id = item.dataset.bookmarkId;
    const url = item.dataset.url;

    item.addEventListener('click', async () => {
      if (url) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.tabs.update(tab.id, { url });
        } else {
          chrome.tabs.create({ url });
        }
      }
    });

    // マウスホイール押し込み（中央クリック）の処理
    item.addEventListener('mousedown', (e) => {
      if (e.button === 1 && url) { // 中央クリック
        e.preventDefault(); // オートスクロールを防止
        chrome.tabs.create({ url, active: false }); // 標準的な挙動に合わせて背景タブで開く
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBookmarkContextMenu(e, id, url);
    });

    const deleteBtn = item.querySelector('.bookmark-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleBookmarkDelete(id, url);
      });
    }
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
      e.dataTransfer.effectAllowed = 'copyMove';
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
      activeTab: state.activeTab,
      isSplitView: state.isSplitView,
      splitRatio: state.splitRatio,
      theme: state.theme
    });
  } catch (error) {
    console.error('状態の保存に失敗:', error);
  }
}

async function loadAppState() {
  try {
    const result = await chrome.storage.local.get(['openFolderIds', 'activeTab', 'isSplitView', 'splitRatio', 'theme']);
    if (result.openFolderIds) {
      state.openFolderIds = new Set(result.openFolderIds);
    }
    if (result.activeTab) {
      state.activeTab = result.activeTab;
    }
    if (result.isSplitView !== undefined) {
      state.isSplitView = result.isSplitView;
    }
    if (result.splitRatio !== undefined) {
      state.splitRatio = result.splitRatio;
    }
    if (result.theme) {
      state.theme = result.theme;
      applyTheme(); // 保存されたテーマを適用
    }

    // 初期ロード時の状態適用
    if (state.isSplitView) {
      applySplitView();
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

  const items = [];

  if (url) {
    items.push({
      label: '新しいタブで開く',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      action: () => chrome.tabs.create({ url }),
    });
    items.push({
      label: 'URLをコピー',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      action: () => {
        navigator.clipboard.writeText(url);
        showToast('URLをコピーしました');
      },
    });
    items.push({ divider: true });
  }

  items.push({
    label: url ? 'ブックマークを削除' : 'フォルダを削除',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    action: () => handleBookmarkDelete(bookmarkId, url),
    className: 'danger',
  });

  // フォルダの場合のみ「この中にフォルダを作成」を追加
  if (!url) {
    items.unshift({
      label: 'この中にフォルダを作成',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>',
      action: () => createBookmarkFolder(bookmarkId),
    });
  }

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

/**
 * ブックマーク・フォルダ削除の共通処理
 */
async function handleBookmarkDelete(bookmarkId, url) {
  const confirmMsg = url ? 'このブックマークを削除しますか？' : 'このフォルダと中身をすべて削除しますか？';
  if (!confirm(confirmMsg)) return;

  try {
    if (url) {
      await chrome.bookmarks.remove(bookmarkId);
    } else {
      await chrome.bookmarks.removeTree(bookmarkId);
    }
    showToast(url ? 'ブックマークを削除しました' : 'フォルダを削除しました');
  } catch (error) {
    console.error('削除に失敗:', error);
    showToast('削除に失敗しました');
  }
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
// カスタムダイアログ (alertの代替)
// ===========================
function setupCustomModal() {
  const modal = document.getElementById('customModal');
  const closeBtn = document.getElementById('modalCloseBtn');
  const okBtn = document.getElementById('modalOkBtn');

  if (!modal || !closeBtn || !okBtn) return;

  const closeModal = () => {
    modal.classList.add('hidden');
  };

  closeBtn.addEventListener('click', closeModal);
  okBtn.addEventListener('click', closeModal);

  // 背景クリックで閉じる
  modal.addEventListener('mousedown', (e) => {
    if (e.target === modal) closeModal();
  });
}

/**
 * 標準のalertを置き換えるカスタムダイアログを表示
 */
function showAlert(message, title = '通知') {
  const modal = document.getElementById('customModal');
  const titleEl = document.getElementById('modalTitle');
  const messageEl = document.getElementById('modalMessage');

  if (!modal || !titleEl || !messageEl) {
    // 万が一DOMがない場合は標準alertにフォールバック
    alert(message);
    return;
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  modal.classList.remove('hidden');
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
  const toggleAiEnterGuard = document.getElementById('toggleAiEnterGuard');
  const miniPlayerSize = document.getElementById('miniPlayerSize');

  // 初期値の読み込み
  chrome.storage.local.get({
    hideXSidebar: false,
    autoScrollYtShorts: false,
    aiEnterGuard: true,
    miniPlayerSize: 'small'
  }, (result) => {
    if (toggleXSidebar) toggleXSidebar.checked = result.hideXSidebar;
    if (toggleYtShortsAutoScroll) toggleYtShortsAutoScroll.checked = result.autoScrollYtShorts;
    if (toggleAiEnterGuard) toggleAiEnterGuard.checked = result.aiEnterGuard;
    if (miniPlayerSize) miniPlayerSize.value = result.miniPlayerSize;
  });

  // 変更の保存
  if (toggleXSidebar) {
    toggleXSidebar.addEventListener('change', (e) => chrome.storage.local.set({ hideXSidebar: e.target.checked }));
  }
  if (toggleYtShortsAutoScroll) {
    toggleYtShortsAutoScroll.addEventListener('change', (e) => chrome.storage.local.set({ autoScrollYtShorts: e.target.checked }));
  }
  if (toggleAiEnterGuard) {
    toggleAiEnterGuard.addEventListener('change', (e) => chrome.storage.local.set({ aiEnterGuard: e.target.checked }));
  }
  if (miniPlayerSize) {
    miniPlayerSize.addEventListener('change', (e) => chrome.storage.local.set({ miniPlayerSize: e.target.value }));
  }
}



/**
 * 機能一覧のセットアップ
 */
function setupFeatures() {
  if (!dom.navFeatures) return;

  dom.navFeatures.addEventListener('click', () => {
    const features = [
      "・タブ管理＆検索：開いているタブを一覧表示し、検索・切り替えが可能です。",
      "・タブ上から音声ミュート：タブの右にあるスピーカーアイコンをクリックすると、そのタブの音声をミュート/解除できます。",
      "・ブックマーク：ブラウザのブックマークをツリー形式で表示・管理できます。",
      "・AIチャットの誤送信防止：AIチャットの誤送信を防ぎます。Ctrl+Enterを押すまでは送信されません。",
      "・YouTubeミニプレイヤー：動画をスクロールアウトした際に、自動で画面右下に固定表示（ミニプレイヤー化）します。サイズは設定から5段階で変更可能です。",
      "・Gemini Canvas拡張：Gemini Canvasのプレビューを全画面表示可能です。",
      "・ブラウジング補助：Xのサイドバー非表示やYouTube Shortsの自動送りなどが可能です。",
      "・ページテキスト取得：表示中のページ内容をMarkdownまたはHTML形式で取得・コピーできます。"
    ];
    showAlert(features.join("\n\n"), "利用可能な機能一覧");
  });
}

// ===========================
// AIページ要約ツール
// ===========================

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

/**
 * サイトの性質（制限ページ、SNS、YouTube等）を確認し、必要に応じてユーザーに確認を行う
 * @returns {Promise<boolean>} 処理を続行する場合は true
 */
async function checkSiteAndConfirm(resultArea, statusDisplay) {
  // システムページ制限の事前チェック
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return false;

  const url = tab.url.toLowerCase();
  if (url.startsWith('chrome:') || url.startsWith('edge:') || url.startsWith('about:') || url.startsWith('chrome-extension:')) {
    const friendlyMsg = '【制限】セキュリティ制限により取得できません。通常のウェブサイトで実行してください。';
    resultArea.value = friendlyMsg;
    showToast('内容を取得できませんでした');
    statusDisplay.textContent = 'エラーが発生しました';
    statusDisplay.style.display = 'block';
    statusDisplay.style.color = 'var(--danger)';
    return false;
  }

  // サイト別メッセージ表示判定
  let confirmMsg = null;
  const isYouTube = url.includes('youtube.com');
  const isSNS = ['x.com', 'twitter.com'].some(d => url.includes(d));
  const isAI = [
    'chatgpt.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com',
    'cloud.microsoft', 'deepseek.com', 'grok.com', 'perplexity.ai',
    'mistral.ai', 'notebooklm.google.com', 'github.com', 'poe.com',
    'v0.app', 'cursor.com'
  ].some(d => url.includes(d));

  if (isYouTube) {
    confirmMsg = "YouTubeなどの動画サイトでは、動画そのものの内容（映像・音声）ではなく、現在画面上に表示されているテキスト情報（タイトル、説明、表示済みのコメント等）を取得します。\n\n続行しますか？";
  } else if (isSNS || isAI) {
    confirmMsg = "このページ（SNS、AIチャット、GitHubなど）は、表示に合わせてコンテンツが読み込まれます。\n\nやり取りが長い場合や無限スクロールのページでは、一番下までスクロールして全てのコンテンツを表示させてから実行することを推奨します。\n\n続行しますか？";
  }

  if (confirmMsg && !window.confirm(confirmMsg)) {
    return false;
  }

  return true;
}


function setupSummaryTool() {
  const copyBtn = document.getElementById('copySummaryBtn');
  const clearBtn = document.getElementById('clearSummaryBtn');
  const resultArea = document.getElementById('summaryResultArea');
  const statusDisplay = document.getElementById('summaryStatus');

  if (!resultArea) return;

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

  // コピー・クリア
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (resultArea.value) {
        navigator.clipboard.writeText(resultArea.value);
        showToast('クリップボードにコピーしました');
      }
    });
  }
  if (clearBtn) {
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
  }

  // Markdown形式で取得
  const copyMdBtn = document.getElementById('copyMdBtn');
  if (copyMdBtn) {
    copyMdBtn.addEventListener('click', async () => {
      // サイト別の確認・制限チェック
      if (!await checkSiteAndConfirm(resultArea, statusDisplay)) {
        return;
      }

      statusDisplay.textContent = 'ページ内容を取得中...';
      statusDisplay.style.display = 'block';
      statusDisplay.style.color = 'var(--text-muted)';

      try {
        const data = await getActivePageData();
        if (!data || !data.text || data.text.trim().length < 20) {
          throw new Error('ページのテキスト内容が不足しているか、取得できませんでした。');
        }

        const mdText = `# ${data.title}\nURL: ${data.url}\n\n---\n\n${data.text}`;

        // テキストエリアに表示
        resultArea.value = mdText;
        updateMarkdownPreview();

        // クリップボードにもコピー
        await navigator.clipboard.writeText(mdText);

        showToast('MD形式で取得・コピーしました');
        statusDisplay.textContent = '取得完了';
        statusDisplay.style.color = 'var(--text-primary)';
        setTimeout(() => {
          if (statusDisplay.textContent === '取得完了') {
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

  // HTML形式で取得
  const copyHtmlBtn = document.getElementById('copyHtmlBtn');
  if (copyHtmlBtn) {
    copyHtmlBtn.addEventListener('click', async () => {
      // サイト別の確認・制限チェック
      if (!await checkSiteAndConfirm(resultArea, statusDisplay)) {
        return;
      }

      statusDisplay.textContent = 'ページ内容を取得中...';
      statusDisplay.style.display = 'block';
      statusDisplay.style.color = 'var(--text-muted)';

      try {
        const data = await getActivePageData();
        if (!data || !data.html) {
          throw new Error('ページのHTML内容を取得できませんでした。');
        }

        // HTML形式のテキストを作成 (タイトルとURLをコメントとして含める)
        const htmlText = `<!-- Title: ${data.title} -->\n<!-- URL: ${data.url} -->\n\n${data.html}`;

        // テキストエリアに表示
        resultArea.value = htmlText;
        updateMarkdownPreview();

        // クリップボードにもコピー
        await navigator.clipboard.writeText(htmlText);

        showToast('HTML形式で取得・コピーしました');
        statusDisplay.textContent = '取得完了';
        statusDisplay.style.color = 'var(--text-primary)';
        setTimeout(() => {
          if (statusDisplay.textContent === '取得完了') {
            statusDisplay.style.display = 'none';
          }
        }, 3000);
      } catch (e) {
        console.error('HTML Export Error:', e);
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
        text: document.body.innerText,
        html: document.body.innerHTML
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

// ===========================
// マークダウン・ビューアー共有ロジック
// ===========================

/**
 * プレビューの更新
 */
function updateMarkdownPreview() {
  const resultArea = document.getElementById('summaryResultArea');
  const previewArea = document.getElementById('summaryPreviewArea');

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
      const group = tab.dataset.group; // 'summary'

      // 同じグループのタブのアクティブ状態を更新
      document.querySelectorAll(`.output-tab[data-group="${group}"]`).forEach(t => {
        t.classList.toggle('active', t === tab);
      });

      // テキストエリアとプレビューの表示切替
      const resultArea = document.getElementById(`${group}ResultArea`);
      const previewArea = document.getElementById(`${group}PreviewArea`);

      if (!resultArea || !previewArea) return;

      if (mode === 'edit') {
        resultArea.classList.remove('hidden');
        previewArea.classList.add('hidden');
      } else {
        updateMarkdownPreview();
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

  // 要約のテキストエリアが変更されたらプレビューも更新するようにイベントバインド
  const summaryEl = document.getElementById('summaryResultArea');
  if (summaryEl) {
    summaryEl.addEventListener('input', () => {
      updateMarkdownPreview();
    });
  }
});
