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
};

// ===========================
// DOM参照
// ===========================
const dom = {
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabIndicator: document.querySelector('.tab-indicator'),
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
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupTabNavigation();
  setupAddressBar();
  setupBookmarkAction();
  setupContextMenu();
  setupNewTabAction();
  loadTabs();
  loadBookmarks();
  setupTabListeners();
  setupBookmarkListeners();
  loadToolsSettings();
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
  document.getElementById('navBack').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.goBack(tab.id);
  });

  document.getElementById('navForward').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) chrome.tabs.goForward(tab.id);
  });

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
  // タブの作成
  chrome.tabs.onCreated.addListener((tab) => {
    state.tabs.push(tab);
    renderTabs();
  });

  // タブの更新
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const index = state.tabs.findIndex((t) => t.id === tabId);
    if (index !== -1) {
      state.tabs[index] = tab;
      renderTabs();
    }
    
    // 現在のタブのURLが更新されたらアドレスバーも更新
    if (tab.active && changeInfo.url) {
      updateAddressBar();
    }
  });

  // タブの削除
  chrome.tabs.onRemoved.addListener((tabId) => {
    state.tabs = state.tabs.filter((t) => t.id !== tabId);
    renderTabs();
  });

  // タブのアクティブ変更
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    state.tabs.forEach((t) => {
      t.active = t.id === activeInfo.tabId;
    });
    renderTabs();
    updateAddressBar(); // アドレスバーを更新
  });

  // タブの移動
  chrome.tabs.onMoved.addListener(() => {
    loadTabs();
  });

  // タブの着脱
  chrome.tabs.onDetached.addListener(() => loadTabs());
  chrome.tabs.onAttached.addListener(() => loadTabs());
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

  const audioIndicator = tab.audible
    ? `<svg class="audio-indicator" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`
    : '';

  const currentClass = tab.active ? ' current' : '';

  return `
    <div class="tab-item${currentClass}" data-tab-id="${tab.id}" data-window-id="${tab.windowId}" data-index="${tab.index}" draggable="true">
      ${faviconHTML}
      <div class="tab-item-info">
        <div class="tab-item-title">${escapeHTML(tab.title || '新しいタブ')}</div>
        <div class="tab-item-url">${escapeHTML(getDisplayUrl(tab.url))}</div>
      </div>
      ${pinBadge}
      ${audioIndicator}
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
      label: '他のタブを閉じる',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      action: () => {
        const otherTabs = state.tabs.filter((t) => t.id !== tabId && t.windowId === tab.windowId && !t.pinned);
        otherTabs.forEach((t) => chrome.tabs.remove(t.id));
      },
      className: 'danger',
    },
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

  if (!toggleXSidebar) return;

  // 初期値の読み込み（デフォルト：false=表示状態）
  chrome.storage.local.get({ hideXSidebar: false }, (result) => {
    if (toggleXSidebar) toggleXSidebar.checked = result.hideXSidebar;
  });

  // 変更の保存
  if (toggleXSidebar) {
    toggleXSidebar.addEventListener('change', (e) => chrome.storage.local.set({ hideXSidebar: e.target.checked }));
  }
}
