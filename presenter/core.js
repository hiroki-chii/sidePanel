/* Shared, dependency-free models. This file also runs in the MV3 worker. */
(() => {
  'use strict';
  const defaults = {
    enabled: false,
    theme: 'system',
    spotlight: { radius: 120, opacity: 0.6 },
    area: { opacity: 0.6, borderColor: '#67e8c5', borderWidth: 2 },
    laser: { color: '#ef4444', radius: 6, trailLength: 18 },
    ripple: { enabled: true, leftColor: '#ef4444', rightColor: '#60a5fa', radius: 35, duration: 650 },
    pen: { color: '#facc15', width: 4, opacity: 0.8, triggerKey: 'Shift' },
    zoom: { scale: 2, minScale: 1, maxScale: 5 },
    keycast: { enabled: false, duration: 2000 },
    gesture: { enabled: true },
    shortcuts: { toggleSpotlight: 'S', toggleAreaSpotlight: 'A', toggleLaser: 'L', togglePen: 'P', toggleZoom: 'M', undoDrawing: 'Z', redoDrawing: 'Y', clearDrawing: 'C' }
  };
  const labels = {
    toggleSpotlight: 'スポットライト', toggleAreaSpotlight: 'エリアスポットライト',
    toggleLaser: 'レーザーポインター', togglePen: '手書きペン', toggleZoom: 'ズーム',
    undoDrawing: '元に戻す', redoDrawing: 'やり直す', clearDrawing: '全消去'
  };
  const limits = {
    'spotlight.radius': [30, 400], 'spotlight.opacity': [0.1, 0.95],
    'area.opacity': [0.1, 0.95], 'area.borderWidth': [0, 10],
    'laser.radius': [2, 20], 'laser.trailLength': [4, 60],
    'ripple.radius': [10, 100], 'ripple.duration': [200, 2000],
    'pen.width': [1, 30], 'pen.opacity': [0.1, 1],
    'zoom.scale': [1, 5], 'zoom.minScale': [1, 3], 'zoom.maxScale': [1, 5],
    'keycast.duration': [500, 5000]
  };
  function normalize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const config = structuredClone(defaults);
    if (typeof value.enabled === 'boolean') config.enabled = value.enabled;
    if (['system', 'light', 'dark'].includes(value.theme)) config.theme = value.theme;
    for (const [section, model] of Object.entries(defaults)) {
      if (!model || typeof model !== 'object' || !value[section] || typeof value[section] !== 'object') continue;
      for (const [key, fallback] of Object.entries(model)) {
        const input = value[section][key];
        const bound = limits[`${section}.${key}`];
        if (bound && typeof input === 'number' && Number.isFinite(input)) config[section][key] = Math.max(bound[0], Math.min(bound[1], input));
        else if (typeof fallback === 'boolean' && typeof input === 'boolean') config[section][key] = input;
        else if (/color/i.test(key) && typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input)) config[section][key] = input;
        else if (key === 'triggerKey' && ['Shift', 'Alt', 'Control', 'Space', 'None'].includes(input)) config[section][key] = input;
        else if (section === 'shortcuts' && typeof input === 'string' && /^[A-Z]$/.test(input)) config[section][key] = input;
      }
    }
    config.zoom.maxScale = Math.max(config.zoom.minScale, config.zoom.maxScale);
    config.zoom.scale = Math.max(config.zoom.minScale, Math.min(config.zoom.maxScale, config.zoom.scale));
    // Duplicate page shortcuts revert together, rather than shadowing an action.
    if (new Set(Object.values(config.shortcuts)).size !== Object.keys(config.shortcuts).length) config.shortcuts = { ...defaults.shortcuts };
    return config;
  }
  function recognizeGesture(points) {
    if (points.length < 2) return null;
    const first = points[0], last = points.at(-1);
    let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
    let reversals = 0, direction = 0, travel = 0;
    for (let i = 1; i < points.length; i++) {
      const p = points[i], before = points[i - 1], dx = p.x - before.x;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      travel += Math.hypot(dx, p.y - before.y);
      if (Math.abs(dx) > 4) { const sign = Math.sign(dx); if (direction && direction !== sign) reversals++; direction = sign; }
    }
    const width = maxX - minX, height = maxY - minY;
    if (width > 80 && height < width * 0.5 && reversals >= 3) return 'clearDrawing';
    if (width >= 48 && height < width * 0.35 && reversals <= 1 && Math.abs(last.x - first.x) > width * 0.8) return last.x < first.x ? 'undoDrawing' : 'redoDrawing';
    if (points.length < 5 || width < 45 || height < 40 || last.x - first.x < width * 0.65 || travel > (width + height) * 2) return null;
    const bottomIndex = points.findIndex(p => p.y === maxY);
    if (bottomIndex < 1 || bottomIndex >= points.length - 1) return null;
    const bottom = points[bottomIndex];
    if (bottom.x <= first.x + width * 0.15 || bottom.x >= last.x - width * 0.15 || maxY - first.y < height * 0.65 || maxY - last.y < height * 0.55) return null;
    let wrongTravel = 0;
    for (let i = 1; i < points.length; i++) {
      const dy = points[i].y - points[i - 1].y;
      if ((i <= bottomIndex && dy < 0) || (i > bottomIndex && dy > 0)) wrongTravel += Math.abs(dy);
    }
    return wrongTravel < height * 0.25 ? 'togglePen' : null;
  }
  function rectBetween(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }
  function zoomRect(x, y, scale, width, height) {
    const w = width / scale, h = height / scale;
    return { x: Math.max(0, Math.min(width - w, x - w / 2)), y: Math.max(0, Math.min(height - h, y - h / 2)), width: w, height: h };
  }
  globalThis.PresenterCore = Object.freeze({ defaults, labels, limits, normalize, recognizeGesture, rectBetween, zoomRect });
})();
