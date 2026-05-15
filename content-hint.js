(() => {
  let isEnabled = false;
  let hints = [];
  let observer = null;
  let hintContainer = null;

  // クリック可能な要素とみなすセレクタ
  const CLICKABLE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="treeitem"]'
  ].join(',');

  // 要素が画面内に表示されているかチェック
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }

  // 画面内のクリック可能要素を収集
  function collectClickableElements() {
    const elements = Array.from(document.querySelectorAll(CLICKABLE_SELECTORS));
    // 重複や非表示要素を除外
    return elements.filter(isVisible);
  }

  // ヒント（番号）を描画
  function renderHints() {
    if (!isEnabled) return;

    if (hintContainer) {
      hintContainer.remove();
    }

    hintContainer = document.createElement('div');
    hintContainer.id = 'chrome-extension-hint-container';
    hintContainer.style.position = 'absolute';
    hintContainer.style.top = '0';
    hintContainer.style.left = '0';
    hintContainer.style.width = '100%';
    hintContainer.style.height = '100%';
    hintContainer.style.pointerEvents = 'none';
    hintContainer.style.zIndex = '2147483647'; // 最大のz-index

    const elements = collectClickableElements();
    hints = [];
    const listForSidePanel = [];

    elements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const num = index + 1;
      
      hints.push({ element: el, index: num });

      // テキスト抽出（サイドパネルのリスト用）
      let text = el.innerText || el.value || el.getAttribute('aria-label') || el.title || '無名要素';
      text = text.trim().replace(/\n/g, ' ');

      listForSidePanel.push({ index: num, text: text });

      const hintEl = document.createElement('div');
      hintEl.textContent = num;
      hintEl.style.position = 'absolute';
      hintEl.style.left = `${window.scrollX + rect.left}px`;
      hintEl.style.top = `${window.scrollY + rect.top}px`;
      hintEl.style.backgroundColor = '#FFeb3b';
      hintEl.style.color = '#000';
      hintEl.style.padding = '1px 4px';
      hintEl.style.fontSize = '12px';
      hintEl.style.fontWeight = 'bold';
      hintEl.style.border = '1px solid #000';
      hintEl.style.borderRadius = '3px';
      hintEl.style.boxShadow = '1px 1px 2px rgba(0,0,0,0.5)';
      hintEl.style.zIndex = '2147483647';

      hintContainer.appendChild(hintEl);
    });

    document.body.appendChild(hintContainer);

    // サイドパネルにリストを送信
    chrome.runtime.sendMessage({ action: 'updateNumberingList', elements: listForSidePanel }).catch(() => {});

    // ページ内入力ボックスのプルダウンを更新
    const datalist = document.getElementById('chrome-extension-numbering-datalist');
    if (datalist) {
      const newListHTML = listForSidePanel.map(item => 
        `<option value="${item.index}">${item.index}: ${item.text.substring(0, 40)}</option>`
      ).join('');
      
      // 内容が変わっていない場合は更新しない（プルダウンが閉じるのを防ぐ）
      if (datalist.innerHTML !== newListHTML) {
        datalist.innerHTML = newListHTML;
      }
    }
  }

  // モードの有効/無効切り替え
  function toggleMode(enabled) {
    isEnabled = enabled;
    if (isEnabled) {
      renderHints();
      // ページ内入力ボックスの表示
      ensurePageInput();
      pageInputContainer.classList.add('active');
      setTimeout(() => {
        if (pageInput) {
          pageInput.value = '';
          pageInput.focus();
        }
      }, 100);

      // DOM変化を監視して再描画
      if (!observer) {
        observer = new MutationObserver((mutations) => {
          // パフォーマンスを考慮し、短いデバウンスを入れる
          clearTimeout(window.hintRenderTimeout);
          window.hintRenderTimeout = setTimeout(renderHints, 300);
        });
      }
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      window.addEventListener('scroll', handleScroll);
      window.addEventListener('resize', handleScroll);
      window.addEventListener('mousedown', handlePageClick, true);
    } else {
      if (hintContainer) {
        hintContainer.remove();
        hintContainer = null;
      }
      // ページ内入力ボックスの非表示
      if (pageInputContainer) {
        pageInputContainer.classList.remove('active');
        pageInput.blur();
      }
      hints = [];
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      window.removeEventListener('mousedown', handlePageClick, true);
    }
  }

  const handlePageClick = (e) => {
    if (isEnabled) {
      // 入力ボックス自体やその中身をクリックした場合は解除しない
      if (pageInputContainer && pageInputContainer.contains(e.target)) {
        return;
      }
      chrome.storage.local.set({ isNumberingMode: false });
    }
  };

  let scrollTimeout;
  function handleScroll() {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(renderHints, 200);
  }

  // ストレージの変更を監視
  chrome.storage.local.get(['isNumberingMode'], (result) => {
    toggleMode(result.isNumberingMode || false);
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.isNumberingMode !== undefined) {
      toggleMode(changes.isNumberingMode.newValue);
    }
  });

  // --- ページ内入力ボックスの実装 ---
  let pageInputContainer = null;
  let pageInput = null;

  function ensurePageInput() {
    if (pageInputContainer) return;

    // スタイルの注入
    const style = document.createElement('style');
    style.textContent = `
      #chrome-extension-numbering-input-container {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        z-index: 2147483647;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        padding: 10px 20px;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        border: 2px solid #3b82f6;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: opacity 0.4s, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.1);
        opacity: 0;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #000;
        cursor: grab;
        user-select: none;
      }
      #chrome-extension-numbering-input-container.active {
        transform: translateX(-50%) translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      #chrome-extension-numbering-input-container.dragging {
        transition: opacity 0.4s;
        cursor: grabbing;
      }
      #chrome-extension-numbering-input-container .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }
      #chrome-extension-numbering-input-container input {
        background: #f3f4f6;
        border: 2px solid transparent;
        color: #000;
        caret-color: #000;
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 18px;
        font-weight: 700;
        width: 80px;
        text-align: center;
        outline: none;
        transition: all 0.2s;
        cursor: text;
      }
      #chrome-extension-numbering-input-container input:focus {
        border-color: #3b82f6;
        background: #fff;
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.2);
      }
      #chrome-extension-numbering-input-container .hint-label {
        font-size: 13px;
        font-weight: 600;
        color: #374151;
        letter-spacing: -0.01em;
        pointer-events: none;
      }
      #chrome-extension-numbering-input-container .close-hint {
        font-size: 11px;
        color: #6b7280;
        margin-left: 4px;
        font-weight: 500;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);

    pageInputContainer = document.createElement('div');
    pageInputContainer.id = 'chrome-extension-numbering-input-container';
    pageInputContainer.innerHTML = `
      <span class="hint-label">番号を選択</span>
      <div class="input-wrapper">
        <input type="tel" placeholder="#" autocomplete="off" inputmode="numeric" list="chrome-extension-numbering-datalist">
        <datalist id="chrome-extension-numbering-datalist"></datalist>
      </div>
      <span class="close-hint">[Esc] で終了</span>
    `;

    pageInput = pageInputContainer.querySelector('input');
    
    // ドラッグ＆ドロップの実装
    pageInputContainer.addEventListener('mousedown', (e) => {
      if (e.target === pageInput) return;
      
      const rect = pageInputContainer.getBoundingClientRect();
      const shiftX = e.clientX - rect.left;
      const shiftY = e.clientY - rect.top;

      pageInputContainer.classList.add('dragging');

      function moveAt(clientX, clientY) {
        pageInputContainer.style.left = (clientX - shiftX) + 'px';
        pageInputContainer.style.top = (clientY - shiftY) + 'px';
        pageInputContainer.style.transform = 'none';
        pageInputContainer.style.margin = '0';
      }

      function onMouseMove(event) {
        moveAt(event.clientX, event.clientY);
      }

      document.addEventListener('mousemove', onMouseMove);

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        pageInputContainer.classList.remove('dragging');
      }

      document.addEventListener('mouseup', onMouseUp);
    });

    // プルダウン等での選択変更時
    pageInput.addEventListener('change', () => {
      const val = parseInt(pageInput.value, 10);
      if (!isNaN(val)) executeClick(val);
    });

    pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(pageInput.value, 10);
        if (!isNaN(val)) executeClick(val);
      } else if (e.key === 'Escape') {
        chrome.storage.local.set({ isNumberingMode: false });
      }
    });

    document.body.appendChild(pageInputContainer);
    renderHints(); // 初期リスト更新
  }

  function executeClick(index) {
    const hint = hints.find(h => h.index === index);
    if (hint && hint.element) {
      const el = hint.element;
      try { el.focus(); } catch(e){}
      const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      events.forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { view: window, bubbles: true, cancelable: true, buttons: 1 }));
      });
      if (typeof el.click === 'function') el.click();
      chrome.storage.local.set({ isNumberingMode: false });
    }
  }

  // サイドパネルからのクリック命令を受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'clickHint') {
      executeClick(message.index);
    } else if (message.action === 'focusPage') {
      // ページ本体（document.body）にフォーカスを当てる
      window.focus();
      document.body.focus();
    }
  });
})();
