(() => {
  'use strict';

  const positions = ['top', 'bottom', 'left', 'right'];
  let position = 'off';
  let delayMs = 700;
  let lastEditTime = 0;
  let listeners;
  let field;
  let mode = '';
  let composing = false;
  let timer;
  let badge;

  // Only the inferred label survives the event. Paste and drop are not mode evidence.
  function inferMode(text) {
    const last = text?.slice(-1) || '';
    if (/[ぁ-ゖ]/.test(last)) return 'あ';
    if (/[ァ-ヺ]/.test(last)) return 'カ';
    if (/[ｦ-ﾟ]/.test(last)) return 'ｶ';
    if (/[Ａ-Ｚａ-ｚ０-９]/.test(last)) return '全A';
    if (/[A-Za-z0-9]/.test(last)) return 'A';
    return '';
  }

  function isEditable(el) {
    if (!(el instanceof HTMLElement) || el.matches(':disabled, [readonly], [aria-readonly="true"]')) return false;
    if (el instanceof HTMLInputElement) return ['text', 'search', 'url', 'tel', 'email'].includes(el.type);
    return el instanceof HTMLTextAreaElement || el.isContentEditable;
  }

  function hide() {
    badge?.remove();
    badge = null;
  }

  const attributes = new MutationObserver(() => {
    if (!isEditable(field)) reset();
  });

  function reset() {
    clearTimeout(timer);
    timer = null;
    hide();
    attributes.disconnect();
    field = null;
    mode = '';
    composing = false;
  }

  function caretRect(bounds) {
    if (field.isContentEditable) {
      const selection = field.getRootNode().getSelection?.() || window.getSelection();
      if (!selection?.isCollapsed || !selection.rangeCount || !field.contains(selection.focusNode)) return null;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.height) return rect;
    } else {
      const offset = field.selectionEnd;
      if (field.selectionStart !== offset) return null;
      if (offset !== null && field.createValueRange) {
        const range = field.createValueRange(offset, offset);
        const rect = range.getBoundingClientRect();
        range.disconnect?.();
        if (rect.height) return rect;
      }
    }
    // Some controls / Chrome versions don't expose caret geometry.
    const x = getComputedStyle(field).direction === 'rtl' ? bounds.right - 4 : bounds.left + 4;
    return { left: x, right: x, top: bounds.top, bottom: bounds.bottom };
  }

  function render() {
    if (!field || !mode || timer || composing || !document.hasFocus() ||
        field.getRootNode().activeElement !== field || !isEditable(field)) return hide();
    const bounds = field.getBoundingClientRect();
    const rect = caretRect(bounds);
    if (!rect || !bounds.height || rect.right < Math.max(0, bounds.left - 1) ||
        rect.left > Math.min(innerWidth, bounds.right + 1) ||
        rect.bottom <= Math.max(0, bounds.top) || rect.top >= Math.min(innerHeight, bounds.bottom)) return hide();

    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute('aria-hidden', 'true');
      badge.style.cssText = 'all:initial;position:fixed;z-index:2147483647;pointer-events:none;user-select:none;' +
        'box-sizing:border-box;min-width:26px;height:26px;padding:0 5px;border-radius:5px;' +
        'background:#222;color:white;text-align:center;font:600 15px/26px system-ui,sans-serif;';
      document.documentElement.append(badge);
    }
    badge.textContent = mode;
    const { width, height } = badge.getBoundingClientRect();
    const gap = 6;
    let x = (rect.left + rect.right - width) / 2;
    let y = (rect.top + rect.bottom - height) / 2;
    if (position === 'top') y = rect.top - height - gap;
    if (position === 'bottom') y = rect.bottom + gap;
    if (position === 'left') x = rect.left - width - gap;
    if (position === 'right') x = rect.right + gap;
    badge.style.left = Math.max(0, Math.min(innerWidth - width, x)) + 'px';
    badge.style.top = Math.max(0, Math.min(innerHeight - height, y)) + 'px';
  }

  function onEdit(event) {
    const target = event.composedPath()[0];
    if (!isEditable(target) || target !== target.getRootNode().activeElement) return;
    if (field !== target) {
      reset();
      field = target;
      attributes.observe(field, { attributes: true, attributeFilter: ['type', 'readonly', 'aria-readonly', 'disabled', 'contenteditable'] });
    }
    lastEditTime = performance.now();
    if (event.type === 'compositionstart') {
      composing = true;
      mode = '';
    } else if (event.type === 'compositionend') {
      composing = false;
      mode = inferMode(event.data);
    } else if (!composing && !event.isComposing) {
      if (event.inputType === 'insertText' || event.inputType === 'insertFromComposition') mode = inferMode(event.data);
      else if (!event.inputType?.startsWith('delete')) mode = '';
    }
    scheduleDisplay(event.isComposing);
  }

  function scheduleDisplay(isComposing = false) {
    clearTimeout(timer);
    timer = null;
    hide();
    if (!field || !mode || composing || isComposing) return;
    const remaining = Math.max(0, delayMs - (performance.now() - lastEditTime));
    timer = setTimeout(() => {
      timer = null;
      render();
    }, remaining);
  }

  function configureDelay(value) {
    const number = Number(value);
    delayMs = Number.isInteger(number) && number >= 100 && number <= 5000 && number % 100 === 0 ? number : 700;
    scheduleDisplay();
  }

  function configure(value) {
    position = positions.includes(value) ? value : 'off';
    if (position === 'off') {
      listeners?.abort();
      listeners = null;
      reset();
      return;
    }
    if (listeners) return render();
    listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    for (const type of ['input', 'compositionstart', 'compositionend']) {
      document.addEventListener(type, onEdit, options);
    }
    document.addEventListener('focusout', reset, options);
    window.addEventListener('blur', reset, { signal: listeners.signal });
    window.addEventListener('pagehide', reset, options);
    document.addEventListener('selectionchange', render, options);
    document.addEventListener('scroll', render, options);
    window.addEventListener('resize', render, options);
  }

  let settingsChanged = false;
  let delaySettingsChanged = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.caretModeDelay) {
      delaySettingsChanged = true;
      configureDelay(changes.caretModeDelay.newValue);
    }
    if (area === 'local' && changes.caretModePosition) {
      settingsChanged = true;
      configure(changes.caretModePosition.newValue);
    }
  });
  chrome.storage.local.get({ caretModePosition: 'off', caretModeDelay: 700 }, settings => {
    if (!delaySettingsChanged) configureDelay(settings.caretModeDelay);
    if (!settingsChanged) configure(settings.caretModePosition);
  });
})();
