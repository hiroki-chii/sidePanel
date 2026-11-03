/**
 * サイドパネル - タブ&ブックマーク管理
 * ブラウザのタブ操作、ブックマーク管理、および各種ブラウジング補助ツールを提供します。
 */

// サイドパネルの有効期間中、バックグラウンドとの接続を維持して状態を同期
const _sidePanelPort = chrome.runtime.connect({ name: 'sidepanel' });

// ===========================
// 状態管理
// ===========================
/**
 * アプリケーションのグローバルステート
 * コンポーネント間でのデータ共有と、ストレージへの永続化に使用します。
 */
/** システムページ判定用パターン（chrome://, about:, edge:// 等のスクリプト実行不可ページ） */
const SYSTEM_PAGE_PATTERN = /^(chrome|edge|about|chrome-extension):/i;

const state = {
  activeTab: 'tabs', // 'tabs' | 'bookmarks' | 'tools' | 'summary' | 'presenter'
  tabs: [],
  bookmarks: [],
  openFolderIds: new Set(), // ユーザーが展開したブックマークフォルダのID
  isSplitView: true,        // タブとブックマークを同時に表示するモード
  splitRatio: 50,           // 分割表示時の左右の比率 (0-100)
  theme: 'system',          // 'light' | 'dark' | 'system'
};

// ===========================
// DOM参照
// ===========================
/**
 * 頻繁にアクセスするDOM要素のキャッシュ
 * パフォーマンス向上とコードの簡潔化のために一箇所で定義します。
 */
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
  addressBarContainer: document.getElementById('addressBarContainer'),
  navFullscreen: document.getElementById('navFullscreen'),
  navPresenter: document.getElementById('navPresenter'),
  presenterPanel: document.getElementById('presenterPanel'),
  navSummary: document.getElementById('navSummary'),
  summaryPanel: document.getElementById('summaryPanel'),
};

// ===========================
// 初期化
// ===========================
document.addEventListener('DOMContentLoaded', async () => {
  // 各種機能のセットアップ
  setupNavigation();
  setupAddressBar();
  setupBookmarkAction();
  setupContextMenu();
  setupTabListeners();
  updateNavButtonsStatus(); // 初回の戻る・進むボタン状態反映
  setupResizer();
  setupGlobalDragAndDrop();
  setupBookmarkListeners();
  setupBookmarkFolderActions();
  loadToolsSettings();
  setupFeatures();
  setupSummaryTool();
  setupCustomModal();
  setupTheme();
  setupFullscreen();

  // 永続化された状態の復元
  await loadAppState();
  loadTabs();
  loadBookmarks();
  
  // 初期表示の調整
  switchTab(state.activeTab);
});

/** ブラウザの全画面表示を切り替え、F11などの外部操作にも追従します。 */
function setupFullscreen() {
  const button = dom.navFullscreen;
  if (!button) return;
  let previousWindowState = 'maximized';
  const render = win => {
    const fullscreen = win.state === 'fullscreen';
    if (['normal', 'maximized'].includes(win.state)) previousWindowState = win.state;
    button.classList.toggle('active', fullscreen);
    button.setAttribute('aria-pressed', String(fullscreen));
    button.title = fullscreen ? '全画面表示を終了' : '全画面表示';
    button.setAttribute('aria-label', button.title);
  };
  const refresh = async () => {
    try { render(await chrome.windows.getCurrent()); }
    catch (error) { console.error('Fullscreen status error:', error); }
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const win = await chrome.windows.getCurrent();
      render(win);
      const targetState = win.state === 'fullscreen' ? previousWindowState : 'fullscreen';
      render(await chrome.windows.update(win.id, { state: targetState }));
    } catch (error) {
      console.error('Fullscreen error:', error);
      showToast('全画面表示を切り替えられませんでした');
    } finally { button.disabled = false; }
  });
  chrome.windows.onBoundsChanged.addListener(refresh);
  refresh();
}

// ===========================
// レイアウト管理 (分割表示)
// ===========================

/**
 * 分割表示の有効/無効を切り替え、UIを再描画します。
 */
function applySplitView() {
  const content = document.querySelector('.content');
  if (!content) return;

  content.classList.toggle('split-mode', state.isSplitView);

  if (state.isSplitView) {
    if (dom.addressBarContainer) dom.addressBarContainer.style.display = 'flex';

    renderTabs();
    renderBookmarks();
    applySplitRatio();
  }
}

/**
 * 分割表示のリサイザー（ドラッグバー）の動作を定義します。
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
    const totalWidth = rect.width;
    if (totalWidth <= 0) return;

    const offsetX = e.clientX - rect.left;
    let ratio = (offsetX / totalWidth) * 100;

    // 極端なリサイズを防ぐための制約（最小幅の確保）
    const minTabWidth = 50;
    const minBookmarkWidth = 60;
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

  window.addEventListener('resize', () => {
    if (state.isSplitView) applySplitRatio();
  });
}

/**
 * 分割比率をCSS変数に反映し、パネルの表示モード（詳細/アイコンのみ等）を更新します。
 */
function applySplitRatio() {
  const content = document.querySelector('.content');
  if (!content || !state.isSplitView) return;

  const ratio = state.splitRatio || 50;
  content.style.setProperty('--tabs-width', `${ratio}%`);
  content.style.setProperty('--bookmarks-width', `${100 - ratio}%`);

  const contentWidth = content.getBoundingClientRect().width;
  if (contentWidth <= 0) return;

  const tabWidth = contentWidth * (ratio / 100);
  const bookmarkWidth = contentWidth * ((100 - ratio) / 100);

  // 幅に応じた表示モードの決定
  let currentMode = 'large';
  if (tabWidth > 165) currentMode = 'large';
  else if (tabWidth > 130) currentMode = 'normal';
  else if (tabWidth > 95) currentMode = 'compact';
  else currentMode = 'minimal';

  // タブパネルのウィンドウセパレーターのラベルを幅に合わせて短縮
  const windowLabels = dom.tabsPanel.querySelectorAll('.window-separator-label');
  windowLabels.forEach(label => {
    const index = label.dataset.index;
    const prefixes = { large: 'WINDOW', normal: 'WINDOW', compact: 'WIN', minimal: 'W' };
    label.textContent = `${prefixes[currentMode]} ${index}`;
  });

  // クラスの付け替え
  if (dom.tabsPanel) {
    const modes = ['mode-large', 'mode-normal', 'mode-compact', 'mode-minimal', 'favicon-only'];
    dom.tabsPanel.classList.remove(...modes);
    dom.tabsPanel.classList.add(`mode-${currentMode}`);
    if (currentMode === 'minimal') dom.tabsPanel.classList.add('favicon-only');
  }

  // ブックマークパネルの表示切替
  if (dom.bookmarksPanel) {
    const isFaviconOnly = bookmarkWidth < 95;
    dom.bookmarksPanel.classList.toggle('favicon-only', isFaviconOnly);
    const bookmarkLabel = dom.bookmarksPanel.querySelector('.window-separator-label');
    if (bookmarkLabel) bookmarkLabel.textContent = isFaviconOnly ? 'FLD' : 'FOLDER';
  }
}

// ===========================
// ブラウザ操作 (ナビゲーション)
// ===========================

function setupNavigation() {
  /** ブラウザのナビゲーション操作をAPIにディスパッチ */
  const navActions = { back: 'goBack', forward: 'goForward', reload: 'reload' };
  const navigate = async (direction) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    await chrome.tabs[navActions[direction]](tab.id);
    setTimeout(updateNavButtonsStatus, 150);
  };

  dom.navBack?.addEventListener('click', () => navigate('back'));
  dom.navForward?.addEventListener('click', () => navigate('forward'));
  document.getElementById('navReload')?.addEventListener('click', () => navigate('reload'));

  dom.navPresenter.addEventListener('click', () => switchTab('presenter'));
  dom.navTools?.addEventListener('click', () => switchTab('tools'));
  dom.navMain?.addEventListener('click', () => switchTab('tabs'));
  dom.navSummary?.addEventListener('click', () => switchTab('summary'));
}

/**
 * Navigation APIを使用して「戻る」「進む」が可能かどうかを判定し、ボタンの活性状態を更新します。
 */
async function updateNavButtonsStatus() {
  if (!dom.navBack || !dom.navForward) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // システムページ等、スクリプト実行不可なページでは一律無効化
    if (!tab?.url || SYSTEM_PAGE_PATTERN.test(tab.url)) {
      dom.navBack.disabled = dom.navForward.disabled = true;
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        canGoBack: window.navigation?.canGoBack ?? false,
        canGoForward: window.navigation?.canGoForward ?? false,
        hasNavigation: !!window.navigation
      })
    });

    if (result) {
      dom.navBack.disabled = !result.canGoBack;
      dom.navForward.disabled = !result.canGoForward;
    }
  } catch (error) {
    dom.navBack.disabled = dom.navForward.disabled = true;
  }
}

// ===========================
// 外観 (テーマ管理)
// ===========================

function setupTheme() {
  const btn = document.getElementById('navTheme');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const themes = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(state.theme);
    state.theme = themes[(currentIndex + 1) % themes.length];
    applyTheme();
    saveAppState();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) {
      state.theme = changes.theme.newValue;
      applyTheme();
    }
  });

  applyTheme();
}

/**
 * 選択中のテーマに応じたCSSクラスとアイコンを適用します。
 */
function applyTheme() {
  const html = document.documentElement;
  const icon = document.getElementById('navThemeIcon');
  const btn = document.getElementById('navTheme');
  if (!html || !icon || !btn) return;

  html.classList.remove('light-theme', 'dark-theme');

  const themeConfigs = {
    light: {
      class: 'light-theme',
      title: 'テーマ: ライト (クリックでダークに切り替え)',
      svg: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    },
    dark: {
      class: 'dark-theme',
      title: 'テーマ: ダーク (クリックでシステムに切り替え)',
      svg: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
    },
    system: {
      class: '',
      title: 'テーマ: システム (クリックでライトに切り替え)',
      svg: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />'
    }
  };

  const config = themeConfigs[state.theme];
  if (config.class) html.classList.add(config.class);
  btn.title = config.title;
  icon.innerHTML = config.svg;
}

// ===========================
// タブナビゲーション (パネル切替)
// ===========================

function switchTab(tab) {
  if (!['tabs', 'bookmarks', 'tools', 'summary', 'presenter'].includes(tab)) tab = 'tabs';
  state.activeTab = tab;
  state.isSplitView = !['tools', 'summary', 'presenter'].includes(tab);

  applySplitView();

  // ナビゲーションボタンのアクティブ表示更新
  dom.navMain?.classList.toggle('active', state.isSplitView);
  dom.navTools?.classList.toggle('active', tab === 'tools');
  dom.navPresenter.classList.toggle('active', tab === 'presenter');
  dom.navSummary?.classList.toggle('active', tab === 'summary');

  // パネルの表示制御
  dom.tabsPanel.classList.toggle('active', state.isSplitView);
  dom.bookmarksPanel.classList.toggle('active', state.isSplitView);
  dom.toolsPanel?.classList.toggle('active', tab === 'tools');
  dom.summaryPanel?.classList.toggle('active', tab === 'summary');
  dom.presenterPanel.classList.toggle('active', tab === 'presenter');
  if (tab === 'presenter' && !dom.presenterPanel.firstElementChild) {
    const frame = document.createElement('iframe');
    frame.title = 'プレゼンカーソルの操作';
    frame.src = 'presenter/popup.html';
    dom.presenterPanel.append(frame);
  } else if (tab !== 'presenter') {
    dom.presenterPanel.replaceChildren();
  }

  if (dom.addressBarContainer) {
    dom.addressBarContainer.style.display = state.isSplitView ? 'flex' : 'none';
  }

  saveAppState();
}

// ===========================
// アドレスバー & サジェスト
// ===========================

function setupAddressBar() {
  if (!dom.addressInput) return;

  updateAddressBar();
  setupAddressSuggestions();

  dom.addressInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    
    // サジェストが選択されている場合はそちらのEnter処理を優先
    const selected = dom.addressSuggestions.querySelector('.suggestion-item.selected');
    if (selected && !dom.addressSuggestions.classList.contains('hidden')) return;

    const query = dom.addressInput.value.trim();
    if (!query) return;

    // URL判定または検索
    let targetUrl = query;
    if (!/^(https?|chrome|edge|about|file|view-source):/i.test(query)) {
      if (query.includes('.') && !query.includes(' ')) targetUrl = 'https://' + query;
      else targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.update(tab.id, { url: targetUrl });
      else await chrome.tabs.create({ url: targetUrl });
      
      dom.addressInput.blur();
      dom.addressSuggestions.classList.add('hidden');
    } catch (error) {
      const isChromePage = targetUrl.startsWith('chrome://');
      showToast(isChromePage ? 'セキュリティ制限により移動できません' : 'ページを開けませんでした');
    }
  });

  dom.addressInput.addEventListener('focus', () => dom.addressInput.select());
  dom.addressInput.addEventListener('blur', () => setTimeout(() => dom.addressSuggestions.classList.add('hidden'), 200));
}

function canSendSearchQuery(query) {
  // A single word may be an intranet host. Only send unambiguous search phrases.
  return /^[\p{L}\p{M}\p{N}]+(?: +[\p{L}\p{M}\p{N}]+)+$/u.test(query);
}

function setupAddressSuggestions() {
  if (!dom.addressInput || !dom.addressSuggestions) return;

  let selectedIndex = -1;
  let currentSuggestions = [];
  let debounceTimeout = null;
  let pending = null;
  const externalToggle = document.getElementById('externalSearchSuggestions');

  function cancelSuggestions() {
    clearTimeout(debounceTimeout);
    pending?.abort();
    currentSuggestions = [];
    selectedIndex = -1;
    dom.addressSuggestions.classList.add('hidden');
  }
  externalToggle.addEventListener('change', cancelSuggestions);
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.externalSearchSuggestions) {
      externalToggle.checked = changes.externalSearchSuggestions.newValue === true;
      cancelSuggestions();
    }
  });

  const updateSelection = () => {
    const items = dom.addressSuggestions.querySelectorAll('.suggestion-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === selectedIndex);
      if (index === selectedIndex) item.scrollIntoView({ block: 'nearest' });
    });
  };

  dom.addressInput.addEventListener('input', () => {
    cancelSuggestions();
    const query = dom.addressInput.value.trim();
    if (!query) return;
    const queryLower = query.toLowerCase();

    pending = new AbortController();
    const { signal } = pending;
    debounceTimeout = setTimeout(async () => {
      // 1. Google検索サジェストをフェッチ
      let searchSuggestions = [];
      if (externalToggle.checked && canSendSearchQuery(query)) {
        try {
          const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data?.[1])) {
              searchSuggestions = data[1].filter(keyword => typeof keyword === 'string').slice(0, 5).map(keyword => ({
                type: 'search',
                title: keyword,
                url: `https://www.google.com/search?q=${encodeURIComponent(keyword)}`
              }));
            }
          }
        } catch {
          // Local matches remain available when the suggestion service is offline.
        }
      }
      if (signal.aborted) return;

      // 2. タブ、履歴、ブックマークから候補を取得
      const [tabs, history, bookmarks] = await Promise.all([
        chrome.tabs.query({}),
        chrome.history?.search({ text: query, maxResults: 5 }) ?? Promise.resolve([]),
        chrome.bookmarks.search(query)
      ]);

      const seenUrls = new Set();
      // 現在のタブは除外
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (signal.aborted) return;
      if (activeTab) seenUrls.add(activeTab.url);

      const match = (text) => text?.toLowerCase().includes(queryLower);

      const results = [
        ...searchSuggestions,
        ...tabs.filter(t => match(t.title) || match(t.url)).map(t => ({ type: 'tab', title: t.title, url: t.url, tabId: t.id, windowId: t.windowId })),
        ...bookmarks.filter(b => b.url && (match(b.title) || match(b.url))).map(b => ({ type: 'bookmark', title: b.title, url: b.url })),
        ...history.filter(h => h.url && (match(h.title) || match(h.url))).map(h => ({ type: 'history', title: h.title || h.url, url: h.url }))
      ];

      currentSuggestions = results
        .filter(item => item.type === 'search' || (!seenUrls.has(item.url) && seenUrls.add(item.url)))
        .slice(0, 10);

      renderSuggestions(currentSuggestions);
      selectedIndex = -1;
    }, 150);
  });

  dom.addressInput.addEventListener('keydown', (e) => {
    if (dom.addressSuggestions.classList.contains('hidden')) return;

    const len = currentSuggestions.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % len;
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + len) % len;
      updateSelection();
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSuggestionSelect(currentSuggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      dom.addressSuggestions.classList.add('hidden');
    }
  });

  const renderSuggestions = (suggestions) => {
    if (suggestions.length === 0) {
      dom.addressSuggestions.classList.add('hidden');
      return;
    }

    const typeIcons = {
      search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      tab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',
      bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
      history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };

    const typeLabels = { search: 'Google 検索', tab: 'タブ', bookmark: 'ブックマーク', history: '履歴' };

    dom.addressSuggestions.innerHTML = suggestions.map((s, i) => `
      <div class="suggestion-item ${s.type}" data-index="${i}">
        <div class="suggestion-icon">${typeIcons[s.type]}</div>
        <div class="suggestion-info">
          <div class="suggestion-title">${escapeHTML(s.title || '無題')}</div>
          <div class="suggestion-url">${escapeHTML(s.url)}</div>
        </div>
        <div class="suggestion-type">${typeLabels[s.type]}</div>
      </div>
    `).join('');

    dom.addressSuggestions.classList.remove('hidden');
    dom.addressSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => handleSuggestionSelect(suggestions[item.dataset.index]));
    });
  };

  const handleSuggestionSelect = async (s) => {
    dom.addressSuggestions.classList.add('hidden');
    dom.addressInput.blur();

    if (s.type === 'tab') {
      await chrome.tabs.update(s.tabId, { active: true });
      await chrome.windows.update(s.windowId, { focused: true });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.update(tab.id, { url: s.url });
      else await chrome.tabs.create({ url: s.url });
    }
    updateAddressBar();
  };
}

// ===========================
// ブックマーク操作
// ===========================

function setupBookmarkAction() {
  dom.bookmarkPageBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    try {
      const bookmarks = await chrome.bookmarks.search({ url: tab.url });
      if (bookmarks.length > 0) {
        await chrome.bookmarks.remove(bookmarks[0].id);
        showToast('ブックマークから削除しました');
      } else {
        await chrome.bookmarks.create({ parentId: '1', title: tab.title, url: tab.url });
        showToast('ブックマークに追加しました');
      }
      updateBookmarkButton(tab.url);
      loadBookmarks();
    } catch (error) {
      console.error('Bookmark toggle error:', error);
    }
  });
}

function setupBookmarkFolderActions() {
  dom.newFolderBtn?.addEventListener('click', () => createBookmarkFolder());
}

async function createBookmarkFolder(parentId = '1') {
  const name = prompt('新しいフォルダの名前を入力してください:', '新規フォルダ');
  if (name === null) return;

  try {
    await chrome.bookmarks.create({ parentId, title: name || '新規フォルダ' });
    showToast('フォルダを作成しました');
  } catch (error) {
    showToast('フォルダの作成に失敗しました');
  }
}

async function updateBookmarkButton(url) {
  if (!dom.bookmarkPageBtn) return;

  const isRestricted = !url || SYSTEM_PAGE_PATTERN.test(url);
  dom.bookmarkPageBtn.disabled = isRestricted;
  
  if (isRestricted) {
    dom.bookmarkPageBtn.classList.remove('is-bookmarked');
    dom.bookmarkPageBtn.title = 'ブックマーク不可';
    return;
  }

  const bookmarks = await chrome.bookmarks.search({ url });
  const isBookmarked = bookmarks.length > 0;
  dom.bookmarkPageBtn.classList.toggle('is-bookmarked', isBookmarked);
  dom.bookmarkPageBtn.title = isBookmarked ? 'ブックマークを削除' : 'ブックマークに追加';
}

function updateAddressBar() {
  if (!dom.addressInput || document.activeElement === dom.addressInput) return;

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url) {
      dom.addressInput.value = tab.url;
      updateBookmarkButton(tab.url);
    }
  });
}

// ===========================
// タブ管理 (描画 & イベント)
// ===========================

async function loadTabs() {
  state.tabs = await chrome.tabs.query({});
  renderTabs();
}

function setupTabListeners() {
  const events = ['onCreated', 'onRemoved', 'onMoved', 'onDetached', 'onAttached'];
  events.forEach(event => chrome.tabs[event].addListener(() => loadTabs()));

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    await loadTabs();
    if (tab.active) {
      updateAddressBar();
      updateNavButtonsStatus();
    }
  });

  chrome.tabs.onActivated.addListener(async () => {
    await loadTabs();
    updateAddressBar();
    updateNavButtonsStatus();
  });

}

function renderTabs() {
  if (state.tabs.length === 0) {
    dom.tabsList.innerHTML = '';
    dom.tabsEmpty.classList.remove('hidden');
    return;
  }
  dom.tabsEmpty.classList.add('hidden');

  // ウィンドウ別にグループ化して描画
  const grouped = state.tabs.reduce((acc, tab) => {
    (acc[tab.windowId] = acc[tab.windowId] || []).push(tab);
    return acc;
  }, {});

  dom.tabsList.innerHTML = Object.entries(grouped).map(([windowId, tabs], index) => `
    <div class="window-separator">
      <span class="window-separator-label" data-index="${index + 1}">WINDOW ${index + 1}</span>
      <button class="window-new-tab-btn" data-window-id="${windowId}" title="新規タブ">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
    ${tabs.map(tab => createTabItemHTML(tab)).join('')}
  `).join('');

  bindFaviconErrorHandlers(dom.tabsList);
  bindTabEvents();
  bindTabDragAndDrop();
}

function bindTabEvents() {
  dom.tabsList.querySelectorAll('.tab-item').forEach(el => {
    const tabId = parseInt(el.dataset.tabId);

    el.addEventListener('click', (e) => {
      if (!e.target.closest('button')) activateTab(tabId);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e, tabId);
    });

    el.querySelector('.close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tabId);
    });

    el.querySelector('.pin-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) await chrome.tabs.update(tabId, { pinned: !tab.pinned });
    });

    el.querySelector('.mute-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) await chrome.tabs.update(tabId, { muted: !tab.mutedInfo?.muted });
    });
  });

  dom.tabsList.querySelectorAll('.window-new-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ windowId: parseInt(btn.dataset.windowId) });
    });
  });
}

function createTabItemHTML(tab) {
  const faviconHTML = tab.favIconUrl
    ? `<img class="favicon" src="${escapeHTML(tab.favIconUrl)}" alt="">`
    : getFaviconPlaceholderHTML();

  const isMuted = tab.mutedInfo?.muted;
  const classes = [
    'tab-item',
    tab.active ? 'current' : '',
    (tab.audible || isMuted) ? 'show-mute' : '',
    (isMuted && tab.audible) ? 'muted-playing' : ''
  ].filter(Boolean).join(' ');

  const muteIcon = isMuted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

  return `
    <div class="${classes}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-index="${tab.index}" draggable="true" title="${escapeHTML(tab.title || '新しいタブ')}">
      ${faviconHTML}
      <div class="tab-item-info">
        <div class="tab-item-title">${escapeHTML(tab.title || '新しいタブ')}</div>
        <div class="tab-item-url">${escapeHTML(getDisplayUrl(tab.url))}</div>
      </div>
      <div class="mute-control" title="${isMuted ? 'ミュート中' : '音声再生中'}">
        <button class="mute-btn${isMuted ? ' is-muted' : ''}">${muteIcon}</button>
      </div>
      <button class="pin-btn${tab.pinned ? ' is-pinned' : ''}" title="ピン留め">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
      </button>
      <button class="close-btn" title="閉じる">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

// ===========================
// ブックマーク管理 (描画 & イベント)
// ===========================

async function loadBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  state.bookmarks = tree;
  renderBookmarks();
}

function setupBookmarkListeners() {
  const events = ['onCreated', 'onRemoved', 'onMoved', 'onChanged'];
  events.forEach(event => chrome.bookmarks[event].addListener(refreshBookmarkUI));
}

async function refreshBookmarkUI() {
  await loadBookmarks();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) updateBookmarkButton(tab.url);
}

function renderBookmarks() {
  if (state.bookmarks.length === 0) {
    dom.bookmarksList.innerHTML = '';
    dom.bookmarksEmpty.classList.remove('hidden');
    return;
  }
  dom.bookmarksEmpty.classList.add('hidden');

  const root = state.bookmarks[0];
  dom.bookmarksList.innerHTML = root?.children?.map(child => renderBookmarkNode(child)).join('') || '';

  bindFaviconErrorHandlers(dom.bookmarksList);
  bindBookmarkEvents();
}

function renderBookmarkNode(node) {
  if (node.children) {
    const childCount = countBookmarks(node);
    const isOpen = state.openFolderIds.has(node.id);
    
    return `
      <div class="bookmark-folder${isOpen ? ' open' : ''}" data-bookmark-id="${node.id}" draggable="true" title="${escapeHTML(node.title || 'フォルダ')}">
        <div class="bookmark-folder-header">
          <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          <svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
          <span class="bookmark-folder-name">${escapeHTML(node.title || 'フォルダ')}</span>
          <span class="bookmark-folder-count">${childCount}</span>
          ${node.parentId === '0' ? '' : `
            <button class="bookmark-delete-btn" title="削除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          `}
        </div>
        <div class="bookmark-folder-children">${node.children.map(c => renderBookmarkNode(c)).join('')}</div>
      </div>
    `;
  }
  
  return node.url ? createBookmarkItemHTML(node) : '';
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
      <button class="bookmark-delete-btn" title="削除">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

function bindBookmarkEvents() {
  dom.bookmarksList.querySelectorAll('.bookmark-folder-header').forEach(header => {
    const folder = header.closest('.bookmark-folder');
    const id = folder.dataset.bookmarkId;

    header.addEventListener('click', () => {
      const isOpen = folder.classList.toggle('open');
      if (isOpen) state.openFolderIds.add(id);
      else state.openFolderIds.delete(id);
      saveAppState();
    });

    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBookmarkContextMenu(e, id, null);
    });

    header.querySelector('.bookmark-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleBookmarkDelete(id, null);
    });
  });

  dom.bookmarksList.querySelectorAll('.bookmark-item').forEach(item => {
    const { bookmarkId: id, url } = item.dataset;

    item.addEventListener('click', () => {
      if (!url) return;
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab) chrome.tabs.update(tab.id, { url });
        else chrome.tabs.create({ url });
      });
    });

    item.addEventListener('mousedown', (e) => {
      if (e.button === 1 && url) {
        e.preventDefault();
        chrome.tabs.create({ url, active: false });
      }
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBookmarkContextMenu(e, id, url);
    });

    item.querySelector('.bookmark-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleBookmarkDelete(id, url);
    });
  });

  bindBookmarkDragAndDrop();
}

// ===========================
// ドラッグ＆ドロップ管理
// ===========================

let draggedTabId = null;
let draggedBookmarkId = null;

function bindTabDragAndDrop() {
  const tabItems = dom.tabsList.querySelectorAll('.tab-item');

  tabItems.forEach(item => {
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
      const isTop = e.clientY < (rect.top + rect.height / 2);
      item.classList.toggle('drag-over-top', isTop);
      item.classList.toggle('drag-over-bottom', !isTop);
    });

    item.addEventListener('dragleave', () => item.classList.remove('drag-over-top', 'drag-over-bottom'));

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over-top', 'drag-over-bottom');

      if (!draggedTabId && !draggedBookmarkId) return;
      
      const windowId = parseInt(item.dataset.windowId);
      let index = parseInt(item.dataset.index);
      if (e.clientY >= (item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2)) index++;

      try {
        if (draggedTabId) {
          if (draggedTabId === parseInt(item.dataset.tabId)) return;
          await chrome.tabs.move(draggedTabId, { windowId, index });
        } else if (draggedBookmarkId) {
          const [b] = await chrome.bookmarks.get(draggedBookmarkId);
          if (b?.url) await chrome.tabs.create({ windowId, index, url: b.url, active: false });
        }
      } catch (err) { console.error('Tab Drop Error:', err); }
    });
  });
}

function bindBookmarkDragAndDrop() {
  const items = dom.bookmarksList.querySelectorAll('.bookmark-item, .bookmark-folder');

  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggedBookmarkId = item.dataset.bookmarkId;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', draggedBookmarkId);
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-into');
      draggedBookmarkId = null;
    });

    item.addEventListener('dragover', (e) => {
      if (!draggedBookmarkId) return;
      e.preventDefault();
      e.stopPropagation();

      item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
      const rect = item.getBoundingClientRect();
      
      if (item.classList.contains('bookmark-folder')) {
        const q = rect.height / 4;
        if (e.clientY < rect.top + q) item.classList.add('drag-over-top');
        else if (e.clientY > rect.bottom - q) item.classList.add('drag-over-bottom');
        else item.classList.add('drag-over-into');
      } else {
        const isTop = e.clientY < (rect.top + rect.height / 2);
        item.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');
      }
      e.dataTransfer.dropEffect = 'move';
    });

    item.addEventListener('dragleave', () => item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into'));

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const id = e.dataTransfer.getData('text/plain') || draggedBookmarkId;
      const targetId = item.dataset.bookmarkId;
      if (!id || !targetId || id === targetId) return;

      try {
        const [targetNode] = await chrome.bookmarks.get(targetId);
        if (!targetNode) return;

        if (item.classList.contains('drag-over-into') && item.classList.contains('bookmark-folder')) {
          await chrome.bookmarks.move(id, { parentId: targetId });
        } else {
          let index = targetNode.index;
          if (item.classList.contains('drag-over-bottom')) index++;
          await chrome.bookmarks.move(id, { parentId: targetNode.parentId, index });
        }
      } catch (err) {
        console.error('Bookmark Drop Error:', err);
        refreshBookmarkUI();
      }
    });
  });
}

function setupGlobalDragAndDrop() {
  const handleDragOver = (e) => {
    const isOverTabItem = e.target.closest('.tab-item');
    const isOverTabsPanel = e.target.closest('#tabsPanel');

    if ((draggedBookmarkId && isOverTabsPanel && !isOverTabItem) || draggedTabId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = draggedTabId ? 'move' : 'copy';
    }
  };

  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('dragenter', handleDragOver);

  document.addEventListener('drop', async (e) => {
    const isOverTabsPanel = e.target.closest('#tabsPanel');
    const isOverTabItem = e.target.closest('.tab-item');
    
    if (draggedTabId && !isOverTabsPanel) {
      // ウィンドウ外へのドロップで切り離し
      chrome.windows.create({ tabId: draggedTabId }).catch(console.error);
    } else if (draggedBookmarkId && isOverTabsPanel && !isOverTabItem) {
      // タブパネル背景へのドロップで新規タブ
      const [b] = await chrome.bookmarks.get(draggedBookmarkId);
      if (b?.url) chrome.tabs.create({ url: b.url, active: false });
    }
  });
}

// ===========================
// コンテキストメニュー管理
// ===========================

let contextMenu = null;

function setupContextMenu() {
  document.addEventListener('click', () => {
    contextMenu?.remove();
    contextMenu = null;
  });
}

function renderContextMenu(e, items) {
  contextMenu?.remove();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  items.forEach(item => {
    if (item.divider) {
      const d = document.createElement('div');
      d.className = 'context-menu-divider';
      menu.appendChild(d);
    } else {
      const btn = document.createElement('button');
      btn.className = `context-menu-item ${item.className || ''}`;
      btn.innerHTML = `${item.icon}<span>${item.label}</span>`;
      btn.onclick = (ev) => { ev.stopPropagation(); item.action(); menu.remove(); };
      menu.appendChild(btn);
    }
  });

  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);
  contextMenu = menu;

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
}

function showTabContextMenu(e, tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  renderContextMenu(e, [
    { label: tab.pinned ? '解除' : 'ピン留め', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>', action: () => chrome.tabs.update(tabId, { pinned: !tab.pinned }) },
    { label: tab.mutedInfo?.muted ? '解除' : 'ミュート', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>', action: () => chrome.tabs.update(tabId, { muted: !tab.mutedInfo?.muted }) },
    { label: 'URLコピー', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', action: () => { navigator.clipboard.writeText(tab.url); showToast('URLコピー完了'); } },
    { divider: true },
    { label: '閉じる', className: 'danger', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>', action: () => closeTab(tabId) }
  ]);
}

function showBookmarkContextMenu(e, id, url) {
  const items = [];
  if (url) {
    items.push(
      { label: '新しいタブ', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>', action: () => chrome.tabs.create({ url }) },
      { label: 'URLコピー', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', action: () => { navigator.clipboard.writeText(url); showToast('URLコピー完了'); } },
      { divider: true }
    );
  } else {
    items.push({ label: '新規フォルダ', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>', action: () => createBookmarkFolder(id) });
  }

  items.push({ label: '削除', className: 'danger', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', action: () => handleBookmarkDelete(id, url) });
  
  renderContextMenu(e, items);
}

// ===========================
// ストレージ & 永続化
// ===========================

async function saveAppState() {
  try {
    await chrome.storage.local.set({
      openFolderIds: [...state.openFolderIds],
      activeTab: state.activeTab,
      isSplitView: state.isSplitView,
      splitRatio: state.splitRatio,
      theme: state.theme
    });
  } catch (e) { console.error('State save error:', e); }
}

async function loadAppState() {
  try {
    const res = await chrome.storage.local.get(['openFolderIds', 'activeTab', 'isSplitView', 'splitRatio', 'theme']);
    if (res.openFolderIds) state.openFolderIds = new Set(res.openFolderIds);
    if (res.activeTab) state.activeTab = res.activeTab;
    if (res.isSplitView !== undefined) state.isSplitView = res.isSplitView;
    if (res.splitRatio !== undefined) state.splitRatio = res.splitRatio;
    if (res.theme) { state.theme = res.theme; applyTheme(); }
    
    if (state.isSplitView) applySplitView();
  } catch (e) { console.error('State load error:', e); }
}

// ===========================
// ユーティリティ
// ===========================

function countBookmarks(node) {
  if (node.url) return 1;
  return node.children?.reduce((acc, child) => acc + countBookmarks(child), 0) || 0;
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'chrome-extension:') return null;
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
  } catch { return null; }
}

function showToast(message) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2000);
}

function showAlert(message, title = '通知') {
  const modal = document.getElementById('customModal');
  const titleEl = document.getElementById('modalTitle');
  const messageEl = document.getElementById('modalMessage');
  if (!modal || !titleEl || !messageEl) return alert(message);

  titleEl.textContent = title;
  messageEl.textContent = message;
  modal.classList.remove('hidden');
}

function setupCustomModal() {
  const modal = document.getElementById('customModal');
  const close = () => modal?.classList.add('hidden');
  document.getElementById('modalCloseBtn')?.addEventListener('click', close);
  document.getElementById('modalOkBtn')?.addEventListener('click', close);
  modal?.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
}

function escapeHTML(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return str.replace(/[&<>"']/g, m => map[m]);
}

function getDisplayUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:') return url;
    if (u.protocol === 'chrome-extension:') return 'Extension';
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch { return url; }
}

function bindFaviconErrorHandlers(container) {
  container.querySelectorAll('img.favicon').forEach(img => {
    img.onerror = () => {
      const p = document.createElement('div');
      p.className = 'favicon-placeholder';
      p.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>';
      img.replaceWith(p);
    };
  });
}

function getFaviconPlaceholderHTML() {
  return '<div class="favicon-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg></div>';
}

async function activateTab(tabId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (tab) {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

async function closeTab(tabId) { await chrome.tabs.remove(tabId).catch(console.error); }

async function handleBookmarkDelete(id, url) {
  if (!confirm(url ? 'ブックマークを削除しますか？' : 'フォルダを削除しますか？')) return;
  try {
    if (url) await chrome.bookmarks.remove(id);
    else await chrome.bookmarks.removeTree(id);
    showToast('削除完了');
  } catch (e) { showToast('失敗しました'); }
}

// ===========================
// ツール設定
// ===========================

function loadToolsSettings() {
  const configs = [
    { id: 'toggleXSidebar', key: 'hideXSidebar', default: false },
    { id: 'toggleYtShortsAutoScroll', key: 'autoScrollYtShorts', default: false },
    { id: 'toggleAiEnterGuard', key: 'aiEnterGuard', default: true },
    { id: 'toggleMiniPlayer', key: 'miniPlayerEnabled', default: true },
    { id: 'miniPlayerSize', key: 'miniPlayerSize', default: 'small' },
    { id: 'caretModePosition', key: 'caretModePosition', default: 'off' },
    { id: 'caretModeDelay', key: 'caretModeDelay', default: 700 },
    { id: 'externalSearchSuggestions', key: 'externalSearchSuggestions', default: false },
    { id: 'toggleYtSidebarBreakpoint', key: 'ytSidebarBreakpointEnabled', default: false }
  ];

  const sizeSelect = document.getElementById('miniPlayerSize');
  const caretPositionSelect = document.getElementById('caretModePosition');
  const caretDelayInput = document.getElementById('caretModeDelay');
  const updateCaretDelayState = () => {
    caretDelayInput.disabled = caretPositionSelect.value === 'off';
  };
  caretPositionSelect.addEventListener('change', updateCaretDelayState);

  chrome.storage.local.get(configs.reduce((acc, c) => ({ ...acc, [c.key]: c.default }), {}), (res) => {
    configs.forEach(c => {
      const el = document.getElementById(c.id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = res[c.key];
      else el.value = res[c.key];
      el.onchange = (e) => {
        if (!el.checkValidity()) {
          el.reportValidity();
          return;
        }
        const value = el.type === 'number' ? el.valueAsNumber : el.value;
        chrome.storage.local.set({ [c.key]: el.type === 'checkbox' ? e.target.checked : value });
      };
    });

    // トグルOFF時はサイズセレクトを無効化
    if (sizeSelect) sizeSelect.disabled = !res.miniPlayerEnabled;
    updateCaretDelayState();

    const toggle = document.getElementById('toggleMiniPlayer');
    if (toggle && sizeSelect) {
      toggle.addEventListener('change', () => {
        sizeSelect.disabled = !toggle.checked;
      });
    }
  });

  // ストレージ変更を監視し、設定UIにリアルタイム反映する（ミニプレイヤーからのサイズ変更対応）
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    if (changes.caretModePosition) {
      caretPositionSelect.value = changes.caretModePosition.newValue || 'off';
      updateCaretDelayState();
    }

    if (changes.caretModeDelay) {
      document.getElementById('caretModeDelay').value = changes.caretModeDelay.newValue ?? 700;
    }

    if (changes.miniPlayerSize !== undefined) {
      const el = document.getElementById('miniPlayerSize');
      if (el) el.value = changes.miniPlayerSize.newValue || 'medium';
    }

    if (changes.miniPlayerEnabled !== undefined) {
      const toggle = document.getElementById('toggleMiniPlayer');
      const el = document.getElementById('miniPlayerSize');
      if (toggle) toggle.checked = changes.miniPlayerEnabled.newValue;
      if (el) el.disabled = !changes.miniPlayerEnabled.newValue;
    }
  });
}

function setupFeatures() {
  dom.navFeatures?.addEventListener('click', () => {
    const list = [
      "・タブ管理＆検索：タブの切り替え、検索、ピン留め、ミュート操作、ドラッグ＆ドロップによる並べ替え",
      "・ブックマーク：ツリー形式での表示、フォルダ管理、D&D並べ替え",
      "・分割表示：タブとブックマークの同時表示、リサイザーによる比率調整",
      "・アドレスバー：URL入力、タブ/ブックマーク/履歴からのサジェスト検索",
      "・全画面表示：ブラウザウィンドウの全画面表示を切り替え",
      "・プレゼンカーソル：スポットライト、レーザー、手書き、ズーム、クリック波紋、入力キー表示",
      "・テーマ切替：ライト / ダーク / システム連動",
      "・誤送信防止：AIチャット等でのEnter送信をガード",
      "・YouTubeミニプレイヤー：スクロール連動のフローティング再生",
      "・YouTubeサイドバー配置：右サイドバーを常に動画下に固定表示",
      "・Gemini Canvas拡張：プレビューの全画面表示",
      "・ページテキスト取得：Markdown/HTML形式での抽出とコピー",
      "・入力モード表示：直前の入力から推定したモードをキャレットの上下左右に表示"
    ];
    showAlert(list.join("\n\n"), "機能一覧");
  });
}

// ===========================
// ページテキスト取得 (Markdown/HTML)
// ===========================

function setupSummaryTool() {
  const resultArea = document.getElementById('summaryResultArea');
  const statusDisplay = document.getElementById('summaryStatus');
  if (!resultArea) return;

  // コピー・クリア
  document.getElementById('copySummaryBtn')?.addEventListener('click', () => {
    if (resultArea.value) { navigator.clipboard.writeText(resultArea.value); showToast('コピー完了'); }
  });

  document.getElementById('clearSummaryBtn')?.addEventListener('click', () => {
    resultArea.value = '';
    resultArea.dataset.format = 'md';
    const preview = document.getElementById('summaryPreviewArea');
    if (preview) preview.innerHTML = '';
    if (statusDisplay) statusDisplay.style.display = 'none';

    // プレビュータブを再表示して編集タブへ切り替え
    const previewTab = document.querySelector('.output-tab[data-group="summary"][data-mode="preview"]');
    if (previewTab) previewTab.style.display = 'inline-block';
    const editTab = document.querySelector('.output-tab[data-group="summary"][data-mode="edit"]');
    editTab?.click();
  });

  // 取得ボタン (MD/HTML共通化)
  const exportContent = async (format) => {
    if (!await checkSiteAndConfirm(resultArea, statusDisplay)) return;

    statusDisplay.textContent = '取得中...';
    statusDisplay.style.display = 'block';
    statusDisplay.style.color = 'var(--text-muted)';

    try {
      const data = await getActivePageData();
      if (!data) throw new Error('取得失敗');

      let output = '';
      if (format === 'md') {
        if (!data.text || data.text.length < 20) throw new Error('内容不足');
        output = `# ${data.title}\nURL: ${data.url}\n\n---\n\n${data.text}`;
      } else {
        if (!data.html) throw new Error('HTML取得失敗');
        output = `<!-- Title: ${data.title} -->\n<!-- URL: ${data.url} -->\n\n${data.html}`;
      }

      resultArea.value = output;
      resultArea.dataset.format = format;
      
      // HTML形式の時はプレビュー（表示）タブを非表示にし、編集タブへ切り替える
      const previewTab = document.querySelector('.output-tab[data-group="summary"][data-mode="preview"]');
      const editTab = document.querySelector('.output-tab[data-group="summary"][data-mode="edit"]');
      if (previewTab) {
        if (format === 'html') {
          document.getElementById('summaryPreviewArea').replaceChildren();
          previewTab.style.display = 'none';
          editTab?.click();
        } else {
          previewTab.style.display = 'inline-block';
          updateMarkdownPreview();
        }
      }

      await navigator.clipboard.writeText(output);
      showToast(`${format.toUpperCase()}形式で取得・コピー完了`);
      statusDisplay.textContent = '完了';
      statusDisplay.style.color = 'var(--text-primary)';
      setTimeout(() => { if (statusDisplay.textContent === '完了') statusDisplay.style.display = 'none'; }, 3000);
    } catch (e) {
      statusDisplay.textContent = 'エラー';
      statusDisplay.style.color = 'var(--danger)';
      resultArea.value = getFriendlyErrorMessage(e);
    }
  };

  document.getElementById('copyMdBtn')?.addEventListener('click', () => exportContent('md'));
  document.getElementById('copyHtmlBtn')?.addEventListener('click', () => exportContent('html'));
}

async function getActivePageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || SYSTEM_PAGE_PATTERN.test(tab.url)) {
    if (tab) throw new Error('SYSTEM_PAGE_RESTRICTED');
    return null;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title,
      url: window.location.href,
      text: document.body.innerText,
      html: document.body.innerHTML
    })
  });
  return result;
}

function getFriendlyErrorMessage(err) {
  const msg = err.message?.toLowerCase() || '';
  if (msg.includes('restricted')) return '【制限】システムページでは実行できません。';
  if (msg.includes('不足') || msg.includes('失敗')) return '【エラー】コンテンツを取得できませんでした。';
  return `【エラー】${err.message}`;
}

async function checkSiteAndConfirm(area, status) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return false;

  if (SYSTEM_PAGE_PATTERN.test(tab.url)) {
    area.value = '【制限】システムページです。';
    status.textContent = 'エラー';
    status.style.display = 'block';
    status.style.color = 'var(--danger)';
    return false;
  }

  const url = tab.url.toLowerCase();
  const isYoutube = url.includes('youtube.com');
  const isComplex = ['x.com', 'twitter.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com'].some(d => url.includes(d));

  let confirmMsg = null;
  if (isYoutube) confirmMsg = "動画の内容ではなく、表示されているテキスト情報を取得します。続行しますか？";
  else if (isComplex) confirmMsg = "動的コンテンツのページです。スクロールして全て読み込ませてから実行することをお勧めします。続行しますか？";

  return !confirmMsg || window.confirm(confirmMsg);
}

const previewElements = new Set('p br hr h1 h2 h3 h4 h5 h6 blockquote ul ol li strong em del pre code table thead tbody tr th td a'.split(' '));

function appendPreviewContent(parent, nodes) {
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(node.data);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.localName;
    if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript'].includes(tag)) continue;
    if (tag === 'img') {
      parent.append(node.getAttribute('alt') || '');
      continue;
    }
    if (!previewElements.has(tag)) {
      appendPreviewContent(parent, node.childNodes);
      continue;
    }
    const element = document.createElement(tag);
    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href && URL.canParse(href)) {
        const url = new URL(href);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          element.href = url.href;
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        }
      }
    }
    appendPreviewContent(element, node.childNodes);
    parent.append(element);
  }
}

function updateMarkdownPreview() {
  const area = document.getElementById('summaryResultArea');
  const preview = document.getElementById('summaryPreviewArea');
  if (!area || !preview || area.dataset.format === 'html') return;
  if (typeof marked === 'undefined') {
    preview.textContent = area.value;
    return;
  }
  // Template contents stay inert. Only newly constructed, allowlisted nodes enter the panel.
  const template = document.createElement('template');
  template.innerHTML = marked.parse(area.value);
  const fragment = document.createDocumentFragment();
  appendPreviewContent(fragment, template.content.childNodes);
  preview.replaceChildren(fragment);
}

function setupOutputTabs() {
  document.querySelectorAll('.output-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const { mode, group } = tab.dataset;
      document.querySelectorAll(`.output-tab[data-group="${group}"]`).forEach(t => t.classList.toggle('active', t === tab));

      const result = document.getElementById(`${group}ResultArea`);
      const preview = document.getElementById(`${group}PreviewArea`);
      if (!result || !preview) return;

      if (mode === 'edit') {
        result.classList.remove('hidden');
        preview.classList.add('hidden');
      } else {
        updateMarkdownPreview();
        // リサイズされたテキストエリアの高さをプレビュー領域に動的同期
        if (result.id === 'summaryResultArea') {
          preview.style.height = `${result.offsetHeight}px`;
        }
        result.classList.add('hidden');
        preview.classList.remove('hidden');
      }
    });
  });
}

// marked初期設定
if (typeof marked !== 'undefined') {
  marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
}

// 共通イベント
document.getElementById('summaryResultArea')?.addEventListener('input', updateMarkdownPreview);
setupOutputTabs();
