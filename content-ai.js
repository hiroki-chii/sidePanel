// --- AIチャット誤送信防止 (Enterで改行、Ctrl+Enterで送信) ---
(() => {
  function isEnterKey(event) {
    return event.code === "Enter" || event.code === "NumpadEnter";
  }

  function dispatchEnter(target, options) {
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      ...options,
    }));
  }

  function findFormButton(target, selector) {
    const form = target.closest("form");
    if (form) {
      return form.querySelector(selector);
    }
    return null;
  }

  function insertTextareaNewline(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + "\n" + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function isCursorAgentsPath(url) {
    try {
      const { pathname } = new URL(url);
      return /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?agents(?:\/|$)/.test(pathname);
    } catch (e) {
      return false;
    }
  }

  const SITE_BEHAVIORS = {
    "chatgpt.com": {
      shouldHandle(event) {
        return event.target.id === "prompt-textarea" || event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        if (event.target.id === "prompt-textarea") {
          event.preventDefault();
          dispatchEnter(event.target, { shiftKey: true });
        }
      },
      onCtrlEnter(event) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        dispatchEnter(event.target, { metaKey: true });
      },
    },

    "claude.ai": {
      shouldHandle(event) {
        return (event.target.tagName === "DIV" && event.target.contentEditable === "true") ||
               event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
        if (event.target.tagName === "TEXTAREA") {
          insertTextareaNewline(event.target);
        }
      },
      onCtrlEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
        if (event.target.tagName === "TEXTAREA") {
          const saveButton = document.querySelector('button[type="submit"]');
          if (saveButton) saveButton.click();
        }
      },
    },

    "gemini.google.com": {
      shouldHandle(event) {
        const isQlEditor = event.target.tagName === "DIV" &&
          event.target.classList.contains("ql-editor") &&
          event.target.contentEditable === "true";
        const isTextarea = event.target.tagName === "TEXTAREA";
        const isShiftEnter = event.shiftKey && isEnterKey(event);
        return (isQlEditor || isTextarea) && !isShiftEnter;
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
      },
    },

    "copilot.microsoft.com": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.stopPropagation();
      },
    },

    "m365.cloud.microsoft": {
      shouldHandle(event) {
        const url = window.location.href;
        return url.startsWith("https://m365.cloud.microsoft/chat") &&
               event.target.id === "m365-chat-editor-target-element";
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { keyCode: 13 });
      },
    },

    "chat.deepseek.com": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true, keyCode: 13, composed: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { keyCode: 13, composed: true });
      },
    },

    "grok.com": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA" ||
               (event.target.tagName === "DIV" && event.target.contentEditable === "true");
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
      },
    },

    "www.perplexity.ai": {
      shouldHandle(event) {
        return event.target.tagName === "DIV" && event.target.contentEditable === "true";
      },
      onEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
      },
    },

    "chat.mistral.ai": {
      shouldHandle(event) {
        return (event.target.tagName === "DIV" &&
                event.target.classList.contains("ProseMirror") &&
                event.target.contentEditable === "true") ||
               event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
      },
    },

    "notebooklm.google.com": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA" && event.target.classList.contains("query-box-input");
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
        const submitButton = document.querySelector('query-box form button[type="submit"]');
        if (submitButton) submitButton.click();
      },
    },

    "github.com": {
      shouldHandle(event) {
        const url = window.location.href;
        return (url.startsWith("https://github.com/copilot") || url.startsWith("https://github.com/spark")) &&
               event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        event.stopImmediatePropagation();
        dispatchEnter(event.target, {});
      },
    },

    "poe.com": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA";
      },
      onEnter(event) {
        event.stopPropagation();
      },
    },

    "v0.app": {
      shouldHandle(event) {
        return event.target.tagName === "TEXTAREA" ||
               (event.target.tagName === "DIV" &&
                event.target.classList.contains("ProseMirror") &&
                event.target.contentEditable === "true");
      },
      onEnter(event) {
        if (event.target.tagName === "TEXTAREA") {
          event.stopPropagation();
        } else {
          event.preventDefault();
          event.stopImmediatePropagation();
          dispatchEnter(event.target, { shiftKey: true });
        }
      },
      onCtrlEnter(event) {
        if (event.target.tagName === "DIV") {
          event.preventDefault();
          event.stopImmediatePropagation();
          dispatchEnter(event.target, {});
        }
      },
    },

    "cursor.com": {
      shouldHandle(event) {
        const url = window.location.href;
        return isCursorAgentsPath(url) &&
               event.target.tagName === "DIV" &&
               event.target.contentEditable === "true" &&
               event.target.getAttribute("data-lexical-editor") === "true" &&
               event.target.getAttribute("role") === "textbox";
      },
      onEnter(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchEnter(event.target, { shiftKey: true });
      },
      onCtrlEnter(event) {
        const button = findFormButton(event.target, 'button[type="submit"]:not([disabled])');
        if (button) {
          event.preventDefault();
          event.stopImmediatePropagation();
          button.click();
        }
      },
    },
  };

  function handleCtrlEnter(event) {
    if (event.isComposing || !event.isTrusted) return;
    if (!isEnterKey(event)) return;

    const hostname = window.location.hostname;
    const behavior = SITE_BEHAVIORS[hostname];
    if (!behavior || !behavior.shouldHandle(event)) return;

    const isOnlyEnter = !event.ctrlKey && !event.metaKey;
    const isCtrlEnter = event.ctrlKey || event.metaKey;

    if (isOnlyEnter && behavior.onEnter) {
      behavior.onEnter(event);
    } else if (isCtrlEnter && behavior.onCtrlEnter) {
      behavior.onCtrlEnter(event);
    }
  }
  // chrome.storage の設定に応じてリスナーを登録/解除
  let isEnabled = false;

  function enable() {
    if (!isEnabled) {
      document.addEventListener("keydown", handleCtrlEnter, { capture: true });
      isEnabled = true;
    }
  }

  function disable() {
    if (isEnabled) {
      document.removeEventListener("keydown", handleCtrlEnter, { capture: true });
      isEnabled = false;
    }
  }

  // 初期値の読み込み（デフォルトON）
  chrome.storage.local.get({ aiEnterGuard: true }, (result) => {
    if (result.aiEnterGuard) {
      enable();
    }
  });

  // 設定変更を監視
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.aiEnterGuard) {
      if (changes.aiEnterGuard.newValue) {
        enable();
      } else {
        disable();
      }
    }
  });

  // --- Gemini Canvas Fullscreen ---
  function setupGeminiCanvasFullscreen() {
    if (window.location.hostname !== "gemini.google.com") return;
    
    // 読み込み確認ログ（早期に出力）
    console.log("[GeminiCanvasFullscreen] スクリプトが開始されました。URL:", window.location.href);

    // スタイルを注入
    const CSS_ID = "gemini-canvas-fullscreen-styles";
    const injectStyles = () => {
      if (document.getElementById(CSS_ID)) return;
      const style = document.createElement("style");
      style.id = CSS_ID;
      style.textContent = `
        body.g-canvas-full .g-canvas-hidden { display: none !important; }
        body.g-canvas-full .g-canvas-expanded { 
          width: 100vw !important; 
          max-width: 100vw !important; 
          flex: 1 1 100% !important; 
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          height: 100vh !important;
          z-index: 999999 !important;
          background: #fff !important;
        }
        @media (prefers-color-scheme: dark) {
          body.g-canvas-full .g-canvas-expanded { background: #1e1e1e !important; }
        }
        .g-full-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          color: currentColor;
          opacity: 0.7;
          transition: all 0.2s;
          margin: 0 4px;
        }
        .g-full-btn:hover {
          opacity: 1;
          background-color: rgba(128, 128, 128, 0.15);
        }
        .g-full-btn svg { width: 20px; height: 20px; }
        body.g-canvas-full .g-full-btn { color: #1a73e8; opacity: 1; background: rgba(26, 115, 232, 0.1); }
      `;
      (document.head || document.documentElement).appendChild(style);
    };

    function findAnchor() {
      // プレビュー、コード、共有、または X ボタンを探す
      const targets = ["プレビュー", "Preview", "コード", "Code", "共有", "Share"];
      const elements = document.querySelectorAll("button, [role='button'], [role='tab'], span, div");
      for (const el of elements) {
        const text = (el.innerText || el.textContent || "").trim();
        if (targets.includes(text)) {
          console.log("[GeminiCanvasFullscreen] アンカー要素を発見:", text);
          return el;
        }
      }
      return null;
    }

    function injectButton() {
      injectStyles();
      const anchor = findAnchor();
      if (!anchor) return;

      const header = anchor.closest('[role="toolbar"]') || 
                     anchor.closest('div[class*="toolbar"]') || 
                     anchor.closest('div[class*="header"]') ||
                     anchor.parentElement;
      
      if (!header || header.querySelector(".g-full-btn")) return;

      console.log("[GeminiCanvasFullscreen] ボタンを注入します。");

      const btn = document.createElement("button");
      btn.className = "g-full-btn";
      btn.title = "全画面表示切り替え (Tab & Bookmark Panel)";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
        </svg>
      `;

      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isFull = document.body.classList.toggle("g-canvas-full");
        
        // コンテナの特定
        const currentAnchor = findAnchor();
        if (!currentAnchor) return;
        
        const header = currentAnchor.closest('[role="toolbar"]') || 
                       currentAnchor.closest('div[class*="toolbar"]') || 
                       currentAnchor.closest('div[class*="header"]') ||
                       currentAnchor.parentElement;

        // ヘッダーから上に辿り、Canvas全体を包むコンテナ（高さがある要素）を探す
        let container = header;
        while (container && container.parentElement && container.tagName !== "BODY") {
          // ヘッダーより明らかに高く、画面の半分以上の高さがあるものをコンテナとみなす
          if (container.offsetHeight > window.innerHeight * 0.5) {
            break;
          }
          container = container.parentElement;
        }
        
        if (container) {
          console.log("[GeminiCanvasFullscreen] コンテナを全画面化:", container);
          container.classList.toggle("g-canvas-expanded", isFull);
          // 兄弟要素（チャット等）を隠す
          let parent = container.parentElement;
          if (parent) {
            Array.from(parent.children).forEach(child => {
              if (child !== container) {
                child.classList.toggle("g-canvas-hidden", isFull);
              }
            });
          }
        }
      };

      header.insertBefore(btn, header.firstChild);
    }

    // 監視設定 (document_start に対応するため documentElement から開始)
    const observer = new MutationObserver(injectButton);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    
    // 定期的なフォールバック
    setInterval(injectButton, 3000);
  }

  setupGeminiCanvasFullscreen();

})();
