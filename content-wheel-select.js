(() => {
  let isEnabled = false;
  let wheelHandler = null;
  let clickHandler = null;
  let middleClickHandler = null;
  let middleMouseDownHandler = null;
  let activePopup = null;

  console.log('[WheelSelect] Injected: Ultimate Dial Input Mode with Wheel-Click IME!');

  // 英小文字 → 英大文字 → 数字 → ひらがな（ゃゅょっー入り） 巨大ドラム
  const ALL_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよゃゅょらりるれろわをんっー';

  /**
   * 現在の文字から、ホイール回転方向（上・下）に応じた次の文字を取得する
   */
  function getNextChar(char, isUp) {
    if (!char) return 'a';
    const dir = isUp ? 1 : -1;

    const idx = ALL_CHARS.indexOf(char);
    if (idx !== -1) {
      const len = ALL_CHARS.length;
      const nextIdx = (idx + dir + len) % len;
      return ALL_CHARS[nextIdx];
    }

    // ドラムに存在しない文字の場合は文字コードを前後させる
    try {
      const code = char.charCodeAt(0);
      return String.fromCharCode(code + dir);
    } catch (e) {
      return 'a';
    }
  }

  /**
   * テキスト入力可能な input 要素かどうかを判定
   */
  function isTextInput(el) {
    const textTypes = ['text', 'search', 'url', 'tel', 'password', 'email', 'number', ''];
    return textTypes.includes((el.type || '').toLowerCase());
  }

  /**
   * カーソル直前の連続したひらがな（ゃゅょっー含む）を抽出する
   */
  function extractBeforeHiragana(text, caretPos) {
    let hiraganaStr = '';
    let startIdx = caretPos;

    for (let i = caretPos - 1; i >= 0; i--) {
      const char = text[i];
      // [ぁ-んー] 正規表現で「ゃゅょっ」および「ー」を含むひらがな全体をカバー
      if (/[ぁ-んー]/.test(char)) {
        hiraganaStr = char + hiraganaStr;
        startIdx = i;
      } else {
        break;
      }
    }
    return { text: hiraganaStr, start: startIdx, end: caretPos };
  }

  /**
   * Google Transliterate API を叩いて、ひらがなに対する漢字変換候補を取得する
   */
  async function getConversionCandidates(hiragana) {
    const url = `https://www.google.com/transliterate?langpair=ja-Hira|ja&text=${encodeURIComponent(hiragana)}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      // レスポンス形式: [ [ "ひらがな", [ "候補1", "候補2", ... ] ] ]
      if (data && data[0] && data[0][1]) {
        return data[0][1];
      }
    } catch (e) {
      console.error('[WheelSelect] Conversion API error:', e);
    }
    return [];
  }

  /**
   * 既存の変換ポップアップを消去する
   */
  function removePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }

  /**
   * 変換候補ポップアップを美しく描画する
   */
  function showCandidatesPopup(targetEl, hiraganaInfo, candidates) {
    const rect = targetEl.getBoundingClientRect();
    const popup = document.createElement('div');

    // プレミアムなフローティング・ガラスモルフィズム風デザインの適用
    popup.style.position = 'absolute';
    popup.style.zIndex = '10000000';
    popup.style.background = 'rgba(255, 255, 255, 0.98)';
    popup.style.backdropFilter = 'blur(12px)';
    popup.style.border = '1px solid rgba(0, 0, 0, 0.12)';
    popup.style.borderRadius = '10px';
    popup.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.15)';
    popup.style.maxHeight = '240px';
    popup.style.overflowY = 'auto';
    popup.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    popup.style.fontSize = '14px';
    popup.style.color = '#202124';
    popup.style.minWidth = '160px';
    popup.style.padding = '6px 0';
    popup.style.scrollbarWidth = 'thin';

    // ダークモード対応のスタイルを適用
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) {
      popup.style.background = 'rgba(32, 33, 36, 0.98)';
      popup.style.borderColor = 'rgba(255, 255, 255, 0.12)';
      popup.style.color = '#e8eaed';
    }

    candidates.forEach((cand) => {
      const item = document.createElement('div');
      item.textContent = cand;
      item.style.padding = '8px 16px';
      item.style.cursor = 'pointer';
      item.style.transition = 'background 0.15s ease';

      item.addEventListener('mouseenter', () => {
        item.style.background = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });

      // 候補をクリックして確定した時の処理
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // テキストボックスからフォーカスが外れるのを防ぐ
        e.stopPropagation();

        const text = targetEl.value;
        const newText = text.slice(0, hiraganaInfo.start) + cand + text.slice(hiraganaInfo.end);
        targetEl.value = newText;

        // カーソルを変換後の漢字の直後にセット
        const newCaretPos = hiraganaInfo.start + cand.length;
        targetEl.setSelectionRange(newCaretPos, newCaretPos);

        // イベント発火してReactなどのバインディングを同期
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        targetEl.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('[WheelSelect] Replaced with candidate:', cand);
        removePopup();
      });

      popup.appendChild(item);
    });

    // はみ出し防止座標計算
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    popup.style.top = `${rect.bottom + scrollTop + 6}px`;
    popup.style.left = `${rect.left + scrollLeft}px`;

    document.body.appendChild(popup);
    activePopup = popup;
  }

  /**
   * テキストボックスにホバーしている時だけ、マウスホイール単体でダイヤル入力する機能
   */
  function createWheelHandler() {
    return (e) => {
      const targetEl = e.target;
      if (!targetEl) return;

      const tag = targetEl.tagName;
      if (tag !== 'TEXTAREA' && !(tag === 'INPUT' && isTextInput(targetEl))) {
        return;
      }

      // Ctrl, Alt, Metaなどの修飾キーはデフォルト挙動を優先
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // 標準ホイールスクロールをブロック
      e.preventDefault();
      e.stopPropagation();

      // 既存の変換ポップアップが出ていたら消す
      removePopup();

      if (document.activeElement !== targetEl) {
        targetEl.focus();
      }

      const text = targetEl.value;
      const start = targetEl.selectionStart;
      const end = targetEl.selectionEnd;
      const isUp = e.deltaY < 0; // 上ホイールで「次の文字」、下ホイールで「前の文字」

      let newChar = 'a';

      if (start === end) {
        // 1. 新規入力
        const newText = text.slice(0, start) + newChar + text.slice(end);
        targetEl.value = newText;
        targetEl.setSelectionRange(start, start + 1);
      } else if (end - start === 1) {
        // 2. 1文字ダイヤル変更
        const currentChar = text.slice(start, end);
        newChar = getNextChar(currentChar, isUp);

        const newText = text.slice(0, start) + newChar + text.slice(end);
        targetEl.value = newText;
        targetEl.setSelectionRange(start, start + 1);
      } else {
        // 3. 複数選択からの移行
        const currentChar = text.slice(start, start + 1);
        newChar = getNextChar(currentChar, isUp);

        const newText = text.slice(0, start) + newChar + text.slice(end);
        targetEl.value = newText;
        targetEl.setSelectionRange(start, start + 1);
      }

      targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }

  /**
   * 左クリック時にダイヤル選択（ハイライト）を解除して確定する
   */
  function createClickHandler() {
    return (e) => {
      if (e.button !== 0) return; // 左クリックのみ

      const activeEl = document.activeElement;
      if (!activeEl) return;

      const tag = activeEl.tagName;
      if (tag !== 'TEXTAREA' && !(tag === 'INPUT' && isTextInput(activeEl))) {
        return;
      }

      const start = activeEl.selectionStart;
      const end = activeEl.selectionEnd;

      if (end - start === 1) {
        e.preventDefault();
        e.stopPropagation();

        activeEl.setSelectionRange(end, end);
        console.log('[WheelSelect] Confirmed by left click:', activeEl.value.slice(start, end));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
  }

  /**
   * ホイールクリック（中クリック）時に直前のひらがなを漢字変換する機能
   */
  function createMiddleClickHandler() {
    return async (e) => {
      if (e.button !== 1) return; // 中クリックのみ

      const targetEl = e.target;
      if (!targetEl) return;

      const tag = targetEl.tagName;
      if (tag !== 'TEXTAREA' && !(tag === 'INPUT' && isTextInput(targetEl))) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const text = targetEl.value;
      const caretPos = targetEl.selectionStart;

      // カーソル直前のひらがなを取得
      const hiraganaInfo = extractBeforeHiragana(text, caretPos);
      if (!hiraganaInfo.text) {
        console.log('[WheelSelect] No hiragana to convert.');
        return;
      }

      console.log('[WheelSelect] Fetching candidates for:', hiraganaInfo.text);

      const candidates = await getConversionCandidates(hiraganaInfo.text);
      if (candidates.length === 0) {
        console.log('[WheelSelect] No conversion candidates found.');
        return;
      }

      removePopup();
      showCandidatesPopup(targetEl, hiraganaInfo, candidates);
    };
  }

  /**
   * 機能の有効/無効を切り替え
   */
  function setEnabled(enabled) {
    console.log('[WheelSelect] setEnabled:', enabled);
    if (isEnabled === enabled) return;
    isEnabled = enabled;

    const wheelOptions = { passive: false, capture: true };
    const clickOptions = { capture: true };

    if (isEnabled) {
      // 通常ホイール入力
      if (wheelHandler) document.removeEventListener('wheel', wheelHandler, wheelOptions);
      wheelHandler = createWheelHandler();
      document.addEventListener('wheel', wheelHandler, wheelOptions);

      // 左クリック確定
      if (clickHandler) document.removeEventListener('mousedown', clickHandler, clickOptions);
      clickHandler = createClickHandler();
      document.addEventListener('mousedown', clickHandler, clickOptions);

      // 中クリック変換（オートスクロール抑止のためmousedownでもフック）
      if (middleMouseDownHandler) {
        document.removeEventListener('mousedown', middleMouseDownHandler, clickOptions);
      }
      middleMouseDownHandler = (e) => {
        if (e.button === 1) {
          const tag = e.target.tagName;
          if (tag === 'TEXTAREA' || (tag === 'INPUT' && isTextInput(e.target))) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      };
      document.addEventListener('mousedown', middleMouseDownHandler, clickOptions);

      if (middleClickHandler) document.removeEventListener('auxclick', middleClickHandler, clickOptions);
      middleClickHandler = createMiddleClickHandler();
      document.addEventListener('auxclick', middleClickHandler, clickOptions);

      console.log('[WheelSelect] All premium listeners registered.');
    } else {
      // 解除
      if (wheelHandler) {
        document.removeEventListener('wheel', wheelHandler, wheelOptions);
        wheelHandler = null;
      }
      if (clickHandler) {
        document.removeEventListener('mousedown', clickHandler, clickOptions);
        clickHandler = null;
      }
      if (middleMouseDownHandler) {
        document.removeEventListener('mousedown', middleMouseDownHandler, clickOptions);
        middleMouseDownHandler = null;
      }
      if (middleClickHandler) {
        document.removeEventListener('auxclick', middleClickHandler, clickOptions);
        middleClickHandler = null;
      }
      removePopup();
      console.log('[WheelSelect] All premium listeners removed.');
    }
  }

  // ポップアップ外クリックで閉じるグローバルリスナー
  document.addEventListener('mousedown', (e) => {
    if (activePopup && !activePopup.contains(e.target)) {
      removePopup();
    }
  });

  // ストレージから初期状態を取得
  chrome.storage.local.get({ wheelSelectEnabled: false }, (result) => {
    setEnabled(result.wheelSelectEnabled);
  });

  // ストレージ変更を監視してリアルタイムに反映
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.wheelSelectEnabled !== undefined) {
      setEnabled(changes.wheelSelectEnabled.newValue);
    }
  });
})();
