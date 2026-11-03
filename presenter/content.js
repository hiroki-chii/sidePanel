(() => {
  'use strict';
  if (globalThis.__presenterCursorLoaded) return;
  globalThis.__presenterCursorLoaded = true;
  const C = PresenterCore;
  let config = C.normalize(), disposed = false;
  const isTop = window === window.top;
  // WindowProxy indices identify the embedding element without reading a foreign DOM.
  function relay(input) {
    const path = [];
    for (let frame = window; frame !== frame.top; frame = frame.parent) {
      const parent = frame.parent;
      let index = 0;
      while (index < parent.length && parent[index] !== frame) index++;
      if (index === parent.length || path.length === 32) return;
      path.unshift(index);
    }
    chrome.runtime.sendMessage({ type: 'PC_FRAME_POINTER', path, ...input }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type !== 'PC_FRAME_POINTER' || !config.enabled) return;
    const { path, kind, button } = message;
    let parent = window.top;
    for (const index of path.slice(0, -1)) {
      parent = parent[index];
      if (!parent) return;
    }
    if (parent !== window) return;
    const child = window[path.at(-1)];
    const frame = [...document.querySelectorAll('iframe,frame')].find(node => node.contentWindow === child);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const sx = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
    const sy = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
    const input = { kind, button, x: rect.left + (frame.clientLeft + message.x) * sx, y: rect.top + (frame.clientTop + message.y) * sy };
    if (isTop) acceptFrame(input); else relay(input);
  });
  if (!isTop) {
    let lastMove = 0;
    window.addEventListener('pointermove', event => {
      if (!config.enabled || !event.isTrusted || performance.now() - lastMove < 16) return;
      lastMove = performance.now(); relay({ kind: 'move', x: event.clientX, y: event.clientY });
    }, true);
    window.addEventListener('pointerdown', event => {
      if (config.enabled && event.isTrusted) relay({ kind: 'down', x: event.clientX, y: event.clientY, button: event.button });
    }, true);
    window.addEventListener('keydown', event => {
      if (!config.enabled || !event.isTrusted) return;
      const action = shortcutAction(event);
      if (config.enabled && action) { event.preventDefault(); event.stopImmediatePropagation(); }
      chrome.runtime.sendMessage({ type: 'PC_FRAME_KEY', action: config.enabled ? action : null, escape: event.key === 'Escape', label: keyLabel(event) }).catch(() => {});
    }, true);
    chrome.storage.local.get('config').then(result => { config = C.normalize(result.config); });
    chrome.storage.onChanged.addListener(changes => { if (changes.config) config = C.normalize(changes.config.newValue); });
    return;
  }

  const modes = { spotlight: false, area: false, laser: false, pen: false, zoom: false };
  let point = { x: innerWidth / 2, y: innerHeight / 2 }, pointerInside = false;
  let areaRect = null, areaStart = null, selecting = false;
  let strokes = [], redo = [], stroke = null, triggerHeld = false, triggerStart = null, gesture = null;
  let pointerOverUI = false;
  let trail = [], ripples = [], animation = 0, zoomImage = null, zoomScale = 2, zoomBusy = false, zoomToken = 0;
  let keyUntil = 0, toastTimer, width = innerWidth, height = innerHeight, dpr = devicePixelRatio;
  let suppressClickUntil = 0, penDirty = true;
  const host = document.createElement('div');
  host.id = 'presenter-cursor-overlay';
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147483647!important;pointer-events:none!important;isolation:isolate!important;';
  // Keep captured pixels and the key display inaccessible to page scripts.
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host { color-scheme: dark; }
    * { box-sizing:border-box; }
    canvas { position:absolute;inset:0;width:100%;height:100%;pointer-events:none; }
    .surface { position:absolute;inset:0;pointer-events:none;touch-action:none; }
    .surface.interactive { pointer-events:auto;cursor:crosshair; }
    .surface.zoom { cursor:zoom-out; }
    .hud { position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 10px 8px 16px;border:1px solid #ffffff24;border-radius:100px;background:#141c23f5;box-shadow:0 6px 30px #0004;font:12px/1.5 system-ui,sans-serif;color:#f2f6f7;pointer-events:auto;white-space:nowrap; }
    button { border:0;background:#ffffff13;color:#f2f6f7;border-radius:100px;padding:7px 11px;font:inherit;cursor:pointer; }
    button:hover { background:#ffffff27; } button:focus-visible { outline:2px solid #67e8c5;outline-offset:2px; }
    button:disabled { opacity:.3;cursor:default; }
    .hint { color:#a5b5bc; } .dot { width:6px;height:6px;border-radius:50%;background:#67e8c5; }
    .keycast { position:absolute;left:50%;bottom:84px;transform:translateX(-50%);padding:10px 18px;border:1px solid #ffffff30;background:#101820ed;border-radius:12px;font:600 20px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 20px #0003; }
    .toast { position:absolute;top:24px;left:50%;transform:translateX(-50%);max-width:calc(100% - 40px);padding:12px 18px;background:#141c23f5;color:#f2f6f7;border:1px solid #ffffff24;border-radius:12px;font:13px/1.6 system-ui,sans-serif;text-align:center; }
    [hidden] { display:none!important; }
    @media (max-width:600px) { .hint { display:none; } .hud { gap:4px;padding-left:10px;max-width:96%; } }
    @media print { :host { display:none!important; } }
  </style><div class="surface"><canvas></canvas></div>
  <div class="hud" hidden><span class="dot"></span><span class="mode-label"></span><span class="hint"></span><button data-action="undoDrawing" title="元に戻す">↶</button><button data-action="redoDrawing" title="やり直す">↷</button><button data-action="clearDrawing">消去</button><button data-action="clearEffects" title="表示を終了（Esc）">終了 ×</button></div>
  <div class="keycast" hidden></div><div class="toast" role="status" hidden></div>`;
  const canvas = shadow.querySelector('canvas'), ctx = canvas.getContext('2d');
  const surface = shadow.querySelector('.surface'), hud = shadow.querySelector('.hud');
  const label = shadow.querySelector('.mode-label'), hint = shadow.querySelector('.hint');
  const keycast = shadow.querySelector('.keycast'), toast = shadow.querySelector('.toast');
  const penCanvas = document.createElement('canvas'), penCtx = penCanvas.getContext('2d');
  const strokeCanvas = document.createElement('canvas'), strokeCtx = strokeCanvas.getContext('2d');

  function resize() {
    if (!config.enabled) return;
    const oldWidth = width, oldHeight = height;
    width = innerWidth; height = innerHeight; dpr = Math.min(3, devicePixelRatio || 1);
    if (oldWidth && oldHeight && (oldWidth !== width || oldHeight !== height)) {
      for (const line of [...strokes, ...redo, ...(stroke ? [stroke] : [])]) for (const p of line.points) { p.x *= width / oldWidth; p.y *= height / oldHeight; }
      if (areaRect) { areaRect.x *= width / oldWidth; areaRect.y *= height / oldHeight; areaRect.width *= width / oldWidth; areaRect.height *= height / oldHeight; }
      if (modes.zoom || zoomBusy) { exitZoom(); showToast('表示サイズが変わったためズームを終了しました。'); }
    }
    for (const c of [canvas, penCanvas, strokeCanvas]) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
    penDirty = true; requestDraw();
  }
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, config.keycast.duration);
  }
  function state() { return { ...modes, selecting, zoomBusy, strokeCount: strokes.length, redoCount: redo.length, enabled: config.enabled, scale: zoomScale }; }
  const panels = new Set();
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'presenter-status') return;
    panels.add(port);
    port.onDisconnect.addListener(() => panels.delete(port));
    port.postMessage(state());
  });
  function updateUI() {
    const interactive = config.enabled && (modes.pen || selecting || modes.zoom || triggerHeld || !!gesture);
    surface.classList.toggle('interactive', interactive);
    surface.classList.toggle('zoom', modes.zoom && !modes.pen);
    const visible = config.enabled && (modes.pen || modes.zoom || selecting || modes.area || strokes.length > 0);
    hud.hidden = !visible;
    label.textContent = selecting ? '範囲をドラッグ' : modes.zoom ? `ズーム ${zoomScale.toFixed(1)}×` : modes.pen ? '手書きペン' : modes.area ? 'エリアスポットライト' : '手書きメモ';
    hint.textContent = modes.zoom ? 'ホイールで倍率調整 · Escで終了' : modes.pen ? 'ドラッグで描画 · Escで終了' : 'Escで終了';
    for (const action of ['undoDrawing', 'redoDrawing', 'clearDrawing']) {
      const button = shadow.querySelector(`[data-action="${action}"]`);
      button.hidden = selecting || modes.zoom;
      button.disabled = action === 'redoDrawing' ? !redo.length : !strokes.length;
    }
    for (const port of panels) {
      try { port.postMessage(state()); } catch { panels.delete(port); }
    }
    requestDraw();
  }
  function finishStroke() {
    triggerStart = null;
    if (!stroke) return;
    strokes.push(stroke); if (strokes.length > 200) strokes.shift();
    stroke = null; redo = []; penDirty = true; updateUI();
  }
  function startStroke(p) { if (stroke) return; stroke = { points: [{ ...p }], color: config.pen.color, width: config.pen.width, opacity: config.pen.opacity }; requestDraw(); }
  function moveStroke(p) {
    if (!stroke) return;
    const prev = stroke.points.at(-1);
    if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1) return;
    if (stroke.points.length >= 10000) { finishStroke(); startStroke(p); }
    else stroke.points.push({ ...p });
    requestDraw();
  }
  function clearDrawing() { stroke = null; strokes = []; redo = []; penDirty = true; }
  function exitPen() {
    modes.pen = false; triggerHeld = false; triggerStart = null;
    clearDrawing();
  }
  function exitZoom() { zoomToken++; zoomBusy = false; modes.zoom = false; zoomImage = null; host.style.removeProperty('visibility'); updateUI(); }
  async function toggleZoom() {
    if (modes.zoom || zoomBusy) { exitZoom(); return; }
    exitPen(); selecting = false;
    const token = ++zoomToken;
    zoomBusy = true; host.style.setProperty('visibility', 'hidden', 'important');
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await chrome.runtime.sendMessage({ type: 'PC_CAPTURE' });
      if (!result?.ok) throw new Error(result?.error || '画面を取得できませんでした。');
      const img = new Image(); img.src = result.image; await img.decode();
      if (token !== zoomToken || !config.enabled) return;
      zoomImage = img; zoomScale = config.zoom.scale; modes.zoom = true;
    } catch (error) { if (token === zoomToken) showToast(error.message); }
    finally { if (token === zoomToken) { zoomBusy = false; host.style.removeProperty('visibility'); } updateUI(); }
  }
  async function action(name) {
    if (!config.enabled) return state();
    if (name !== 'toggleZoom' && (name === 'togglePen' || name === 'toggleAreaSpotlight')) exitZoom();
    if (name === 'toggleSpotlight') { modes.spotlight = !modes.spotlight; modes.area = false; selecting = false; areaRect = null; }
    else if (name === 'toggleAreaSpotlight') {
      exitPen(); modes.spotlight = false;
      if (modes.area) { modes.area = false; selecting = false; areaRect = null; }
      else { modes.area = true; selecting = true; areaRect = null; showToast('明るくする範囲をドラッグしてください。Escで解除。'); }
    } else if (name === 'toggleLaser') { modes.laser = !modes.laser; trail = []; }
    else if (name === 'togglePen') {
      if (modes.pen) exitPen();
      else modes.pen = true;
      selecting = false; if (!areaRect) modes.area = false;
    }
    else if (name === 'toggleZoom') await toggleZoom();
    else if (name === 'undoDrawing') { finishStroke(); if (strokes.length) redo.push(strokes.pop()); penDirty = true; }
    else if (name === 'redoDrawing') { finishStroke(); if (redo.length) strokes.push(redo.pop()); penDirty = true; }
    else if (name === 'clearDrawing') clearDrawing();
    else if (name === 'clearEffects') clearEffects();
    updateUI(); return state();
  }
  function clearEffects() {
    exitPen(); for (const name in modes) modes[name] = false;
    selecting = false; areaRect = null; areaStart = null; gesture = null;
    trail = []; ripples = []; exitZoom(); keycast.hidden = true; keyUntil = 0; toast.hidden = true;
  }
  function setConfig(value) {
    const wasEnabled = config.enabled;
    config = C.normalize(value);
    if (config.enabled && !wasEnabled) {
      (document.fullscreenElement || document.documentElement).append(host);
      resize();
    } else if (!config.enabled && wasEnabled) {
      clearEffects();
      host.remove();
      for (const c of [canvas, penCanvas, strokeCanvas]) c.width = 0;
    }
    if (!config.keycast.enabled) { keycast.hidden = true; keyUntil = 0; }
    if (!config.gesture.enabled) gesture = null;
    if (!config.ripple.enabled) ripples = [];
    finishStroke(); triggerHeld = false; updateUI();
  }
  chrome.storage.local.get('config').then(result => setConfig(result.config));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.config) setConfig(changes.config.newValue); });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'PC_STATUS') { reply(state()); return; }
    if (message.type === 'PC_ACTION') { action(message.action).then(reply); return true; }
    if (message.type === 'PC_FRAME_KEY') { acceptFrame({ ...message, kind: 'key' }); reply({ ok: true }); }
  });
  shadow.addEventListener('pointerdown', event => { if (event.target.closest('button')) event.stopPropagation(); });
  shadow.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) { event.preventDefault(); event.stopPropagation(); action(button.dataset.action); } });

  function onInput(type, handler, options = true) {
    // Outside a closed shadow root, composedPath hides the HUD and surface.
    // Handle overlay input inside its root, where isUI can identify buttons;
    // window listeners keep handling page input without processing it twice.
    window.addEventListener(type, event => {
      if (!event.composedPath().includes(host)) handler(event);
    }, options);
    shadow.addEventListener(type, handler, options);
  }
  function isUI(event) {
    if (event.composedPath().some(node => node === hud || node === toast)) return true;
    // Pointer capture can keep the surface as the target over the menu.
    if (!hud.hidden && 'clientX' in event) {
      const rect = hud.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }
    return false;
  }
  function swallow(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function addRipple(p, button) {
    if (!config.enabled || !config.ripple.enabled || ![0, 2].includes(button)) return;
    ripples.push({ ...p, button, time: performance.now() }); if (ripples.length > 30) ripples.shift(); requestDraw();
  }
  function movePointer(p) {
    point = p; pointerInside = true;
    if (config.enabled && modes.laser) { trail.push({ ...p, time: performance.now() }); if (trail.length > config.laser.trailLength) trail.shift(); }
    requestDraw();
  }
  function acceptFrame(input) {
    if (!config.enabled) return;
    if (input.kind === 'move') movePointer({ x: input.x, y: input.y });
    else if (input.kind === 'down') { movePointer({ x: input.x, y: input.y }); addRipple(point, input.button); }
    else if (input.kind === 'key') {
      if (input.escape) { clearEffects(); updateUI(); }
      else if (Object.hasOwn(C.labels, input.action)) action(input.action);
      if (typeof input.label === 'string') displayKey(input.label.slice(0, 60));
    }
  }
  onInput('pointermove', event => {
    pointerOverUI = isUI(event);
    if (!config.enabled) return;
    if (pointerOverUI && !gesture) { finishStroke(); return; }
    movePointer({ x: event.clientX, y: event.clientY });
    if (gesture) { swallow(event); if (gesture.length < 3000) gesture.push({ ...point }); }
    else if (areaStart) { swallow(event); areaRect = C.rectBetween(areaStart, point); }
    else if (stroke) { swallow(event); moveStroke(point); }
    else if (triggerHeld && modes.pen) {
      const origin = triggerStart;
      triggerStart = { ...point };
      if (origin && Math.hypot(point.x - origin.x, point.y - origin.y) >= 1) {
        swallow(event); startStroke(origin); moveStroke(point);
      }
    }
  }, true);
  onInput('pointerdown', event => {
    pointerOverUI = isUI(event);
    if (!config.enabled || pointerOverUI) return;
    movePointer({ x: event.clientX, y: event.clientY }); addRipple(point, event.button);
    if (event.button === 1 && config.gesture.enabled && !isEditable(event)) {
      swallow(event); finishStroke(); gesture = [{ ...point }]; suppressClickUntil = performance.now() + 1000; updateUI();
    } else if (event.button === 0 && selecting) {
      swallow(event); areaStart = { ...point }; areaRect = null;
    } else if (event.button === 0 && modes.pen) { swallow(event); startStroke(point); }
    else if (modes.zoom) swallow(event);
  }, true);
  onInput('pointerup', event => {
    if (!config.enabled) return;
    if (event.button === 1 && gesture) {
      swallow(event);
      gesture.push({ x: event.clientX, y: event.clientY });
      const result = C.recognizeGesture(gesture); gesture = null; suppressClickUntil = performance.now() + 300;
      if (result) { action(result); showToast(C.labels[result]); } updateUI();
      return;
    }
    if (isUI(event)) return;
    if (event.button === 0 && areaStart) {
      swallow(event); areaRect = C.rectBetween(areaStart, { x: event.clientX, y: event.clientY }); areaStart = null;
      if (areaRect.width >= 8 && areaRect.height >= 8) selecting = false; else areaRect = null;
      updateUI();
    } else if (event.button === 0 && stroke && !triggerHeld) { swallow(event); finishStroke(); }
    else if (modes.zoom) swallow(event);
  }, true);
  for (const name of ['click', 'dblclick', 'auxclick', 'contextmenu']) onInput(name, event => {
    if (config.enabled && !isUI(event) && (modes.pen || selecting || modes.zoom || gesture || (name === 'auxclick' && performance.now() < suppressClickUntil))) swallow(event);
  }, true);
  onInput('wheel', event => {
    if (!config.enabled || !modes.zoom || isUI(event)) return;
    swallow(event);
    zoomScale = Math.max(config.zoom.minScale, Math.min(config.zoom.maxScale, zoomScale * Math.exp(-event.deltaY * 0.0015)));
    updateUI();
  }, { capture: true, passive: false });
  onInput('keydown', event => {
    if (!event.isTrusted || !config.enabled) return;
    const name = shortcutAction(event);
    if (event.key === 'Escape') { clearEffects(); updateUI(); return; }
    if (isUI(event) && !name) return;
    if (name) { swallow(event); if (!event.repeat) action(name); }
    else if (modes.pen && !event.repeat && !event.isComposing && !isEditable(event) && triggerMatches(event, config.pen.triggerKey)) {
      swallow(event); triggerHeld = true;
      // A key press alone is not a stroke. Wait for real movement outside UI.
      triggerStart = pointerInside && !pointerOverUI ? { ...point } : null;
      updateUI();
    }
    displayKey(keyLabel(event));
  }, true);
  onInput('keyup', event => {
    if (triggerHeld && triggerMatches(event, config.pen.triggerKey)) { swallow(event); triggerHeld = false; finishStroke(); updateUI(); }
  }, true);
  function displayKey(text) { if (config.enabled && config.keycast.enabled && text) { keycast.textContent = text; keycast.hidden = false; keyUntil = performance.now() + config.keycast.duration; requestDraw(); } }
  function releaseInput() { triggerHeld = false; gesture = null; areaStart = null; finishStroke(); trail = []; pointerInside = false; updateUI(); }
  window.addEventListener('blur', releaseInput);
  window.addEventListener('pointercancel', releaseInput, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseInput(); keycast.hidden = true; keyUntil = 0; if (modes.zoom || zoomBusy) exitZoom(); } });
  document.addEventListener('pointerleave', () => { pointerInside = false; if (!triggerHeld) finishStroke(); requestDraw(); });
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', () => {
    if (!config.enabled) return;
    const target = document.fullscreenElement || document.documentElement;
    if (target !== host.parentNode) target.append(host);
    resize();
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { disposed = true; cancelAnimationFrame(animation); } else releaseInput(); });

  function drawLine(context, line) {
    const points = line.points; if (!points.length) return;
    context.strokeStyle = line.color; context.fillStyle = line.color;
    context.lineWidth = line.width; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); context.moveTo(points[0].x, points[0].y);
    if (points.length === 1) { context.arc(points[0].x, points[0].y, line.width / 2, 0, Math.PI * 2); context.fill(); }
    else { for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y); context.stroke(); }
  }
  function compositeStroke(target, line) {
    strokeCtx.setTransform(dpr, 0, 0, dpr, 0, 0); strokeCtx.clearRect(0, 0, width, height);
    drawLine(strokeCtx, line);
    target.save(); target.globalAlpha = line.opacity; target.drawImage(strokeCanvas, 0, 0, width, height); target.restore();
  }
  function requestDraw() { if (config.enabled && !animation && !disposed) animation = requestAnimationFrame(render); }
  function render(now) {
    animation = 0; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!config.enabled) return;
    if (modes.zoom && zoomImage) {
      const r = C.zoomRect(point.x, point.y, zoomScale, width, height);
      const sx = zoomImage.naturalWidth / width, sy = zoomImage.naturalHeight / height;
      ctx.drawImage(zoomImage, r.x * sx, r.y * sy, r.width * sx, r.height * sy, 0, 0, width, height);
    }
    if (modes.spotlight || modes.area) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height);
      if (modes.spotlight) { ctx.moveTo(point.x + config.spotlight.radius, point.y); ctx.arc(point.x, point.y, config.spotlight.radius, 0, Math.PI * 2, true); }
      else if (areaRect) ctx.rect(areaRect.x, areaRect.y, areaRect.width, areaRect.height);
      ctx.fillStyle = `rgba(0,0,0,${modes.spotlight ? config.spotlight.opacity : config.area.opacity})`; ctx.fill('evenodd'); ctx.restore();
      if (modes.area && areaRect && config.area.borderWidth) { ctx.strokeStyle = config.area.borderColor; ctx.lineWidth = config.area.borderWidth; ctx.strokeRect(areaRect.x, areaRect.y, areaRect.width, areaRect.height); }
    }
    if (penDirty) { penCtx.setTransform(dpr, 0, 0, dpr, 0, 0); penCtx.clearRect(0, 0, width, height); for (const line of strokes) compositeStroke(penCtx, line); penDirty = false; }
    ctx.drawImage(penCanvas, 0, 0, width, height); if (stroke) compositeStroke(ctx, stroke);
    trail = trail.filter(p => now - p.time < 280);
    if (modes.laser && trail.length) {
      ctx.save(); ctx.strokeStyle = config.laser.color; ctx.lineCap = 'round'; ctx.shadowColor = config.laser.color; ctx.shadowBlur = 10;
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = (i / trail.length) * Math.max(0, 1 - (now - trail[i].time) / 280); ctx.lineWidth = config.laser.radius * 2 * i / trail.length;
        ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
      }
      ctx.restore();
    }
    if (modes.laser && pointerInside) { ctx.save(); ctx.shadowColor = config.laser.color; ctx.shadowBlur = 14; ctx.fillStyle = config.laser.color; ctx.beginPath(); ctx.arc(point.x, point.y, config.laser.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ripples = ripples.filter(r => now - r.time < config.ripple.duration);
    for (const r of ripples) {
      const progress = (now - r.time) / config.ripple.duration;
      ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = r.button === 2 ? config.ripple.rightColor : config.ripple.leftColor; ctx.lineWidth = 3 * (1 - progress) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, config.ripple.radius * (0.15 + progress), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (gesture?.length > 1) drawLine(ctx, { points: gesture, color: '#67e8c5', width: 3 });
    if (keyUntil && now >= keyUntil) { keycast.hidden = true; keyUntil = 0; }
    if (trail.length || ripples.length || keyUntil) requestDraw();
  }
  resize();

  function triggerMatches(event, key) { return key === 'Space' ? event.code === 'Space' : event.key === key; }
  function isEditable(event) { return event.composedPath().some(node => node instanceof Element && (node.matches('input,textarea,select,[role="textbox"]') || node.isContentEditable)); }
  function shortcutAction(event) {
    if (event.isComposing || event.repeat || !event.shiftKey || !(event.ctrlKey || event.metaKey) || event.altKey) return null;
    const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : event.key.toUpperCase();
    return Object.keys(config.shortcuts).find(name => config.shortcuts[name] === key) || null;
  }
  function keyLabel(event) {
    // Never show text entry, passwords, composition or ordinary character keys.
    if (event.isComposing || isEditable(event) || event.composedPath().some(node => node instanceof Element && node.closest('[data-presenter-private]'))) return '';
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl'); if (event.metaKey) parts.push('Win'); if (event.altKey) parts.push('Alt'); if (event.shiftKey) parts.push('Shift');
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return '';
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return '';
    const safeKey = event.key.length === 1 ? event.key.toUpperCase() : event.key.replace('Arrow', '');
    parts.push(safeKey === ' ' ? 'Space' : safeKey);
    return parts.join(' + ');
  }
})();
