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
  }

  // モードの有効/無効切り替え
  function toggleMode(enabled) {
    isEnabled = enabled;
    if (isEnabled) {
      renderHints();
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
    } else {
      if (hintContainer) {
        hintContainer.remove();
        hintContainer = null;
      }
      hints = [];
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    }
  }

  let scrollTimeout;
  function handleScroll() {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(renderHints, 200);
  }

  // Escキーで解除
  window.addEventListener('keydown', (e) => {
    if (isEnabled && e.key === 'Escape') {
      chrome.storage.local.set({ isNumberingMode: false });
    }
  }, true); // キャプチャリングフェーズで優先的に処理

  // ストレージの変更を監視
  chrome.storage.local.get(['isNumberingMode'], (result) => {
    toggleMode(result.isNumberingMode || false);
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.isNumberingMode !== undefined) {
      toggleMode(changes.isNumberingMode.newValue);
    }
  });

  // サイドパネルからのクリック命令を受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'clickHint') {
      const hint = hints.find(h => h.index === message.index);
      if (hint && hint.element) {
        try { hint.element.focus(); } catch(e){}
        
        const el = hint.element;
        
        // Reactなどのフレームワーク向けに一連のイベントを発火
        const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        events.forEach(eventType => {
          const ev = new MouseEvent(eventType, {
            view: window,
            bubbles: true,
            cancelable: true,
            buttons: 1
          });
          el.dispatchEvent(ev);
        });
        
        // 標準的なクリックも呼ぶ
        if (typeof el.click === 'function') {
          el.click();
        }
      }
    } else if (message.action === 'focusPage') {
      // ページ本体（document.body）にフォーカスを当てる
      window.focus();
      document.body.focus();
    }
  });
})();
