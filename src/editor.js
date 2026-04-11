// @ts-check

/**
 * @fileoverview Level editor: terrain canvas painting, JSON editing, file I/O.
 * Three panels: terrain editor (2D top-down), JSON textarea, preview (Phase 2).
 */

import {
  TERRAIN_SIZE, MAX_FIREFLIES,
  MAT_GRASS, MAT_PUDDLE, MAT_WOOD, MAT_CONCRETE,
  defaultLevel, defaultLevelConfig, defaultTerrainImageData,
  parseLevelConfig, spawnFirefliesFromZones,
  loadLevel, terrainToBlob,
  worldToPixel, pixelToWorld,
} from './levels.js';
import { createEngine, loadLevel as loadEngineLevel, startFrameLoop, stopFrameLoop } from './engine.js';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * @typedef {import('./levels.js').LevelConfig} LevelConfig
 * @typedef {import('./levels.js').LevelData} LevelData
 * @typedef {import('./engine.js').Engine} Engine
 */

/**
 * @typedef {'heightUp' | 'heightDown' | 'material'} BrushMode
 */

/**
 * @typedef {Object} EditorState
 * @property {ImageData} terrainData        — the 256×256 RGBA terrain
 * @property {LevelConfig} config           — current level config
 * @property {BrushMode} brushMode
 * @property {number} brushSize             — radius in pixels
 * @property {number} brushStrength         — height change per stroke (1–50)
 * @property {number} materialId            — selected material for painting
 * @property {boolean} isPainting           — mouse held down on terrain
 * @property {string} levelId               — current level name (for saving)
 * @property {boolean} jsonDirty            — JSON textarea was edited but not yet parsed
 * @property {Engine|null} engine           — WebGPU engine for live preview (null until init)
 * @property {number} previewDebounceTimer  — debounce timer for preview updates
 */

// ── Color palette for terrain visualization ─────────────────────────────────

/** Map material IDs to display colors [r, g, b] @type {Record<number, number[]>} */
const MATERIAL_COLORS = {
  [MAT_GRASS]:    [40, 120, 30],
  [MAT_PUDDLE]:   [30, 80, 150],
  [MAT_WOOD]:     [140, 90, 50],
  [MAT_CONCRETE]: [130, 130, 130],
};

/**
 * Get the display color for a terrain pixel based on height and material.
 * @param {number} height - 0–255
 * @param {number} material - material ID
 * @returns {[number, number, number]}
 */
function terrainPixelColor(height, material) {
  // Find closest material
  const matKeys = [MAT_GRASS, MAT_PUDDLE, MAT_WOOD, MAT_CONCRETE];
  let closest = MAT_GRASS;
  let closestDist = 256;
  for (const mk of matKeys) {
    const d = Math.abs(material - mk);
    if (d < closestDist) { closestDist = d; closest = mk; }
  }

  const base = MATERIAL_COLORS[closest] || MATERIAL_COLORS[MAT_GRASS];
  // Modulate brightness by height (0 = base color, 255 = bright)
  const brightness = 0.4 + (height / 255) * 0.6;
  return [
    Math.min(255, Math.round(base[0] * brightness)),
    Math.min(255, Math.round(base[1] * brightness)),
    Math.min(255, Math.round(base[2] * brightness)),
  ];
}

// ── Init ────────────────────────────────────────────────────────────────────

const state = initEditor();

async function initEditorAsync() {
  const params = new URLSearchParams(window.location.search);
  const levelId = params.get('level');
  if (levelId) {
    state.levelId = levelId;
    try {
      const level = await loadLevel(levelId);
      state.terrainData = level.terrainImageData;
      state.config = level.config;
      setJsonText(JSON.stringify(state.config, null, 2));
      setStatus(`Loaded level: ${levelId}`);
    } catch (e) {
      console.warn('Failed to load level from URL:', e);
      setStatus(`Failed to load ${levelId}, using defaults`);
    }
  }
  renderTerrain();
  updateStatusLevel();
  // Preview will be initialized separately by initPreview(state)
}

initEditorAsync();

/**
 * @returns {EditorState}
 */
function initEditor() {
  const level = defaultLevel();

  /** @type {EditorState} */
  const s = {
    terrainData: level.terrainImageData,
    config: level.config,
    brushMode: 'heightUp',
    brushSize: 5,
    brushStrength: 10,
    materialId: MAT_GRASS,
    isPainting: false,
    levelId: 'level0',
    jsonDirty: false,
    engine: null,
    previewDebounceTimer: 0,
  };

  // Init JSON editor with default config text
  const jsonEditor = getJsonEditor();
  jsonEditor.value = JSON.stringify(s.config, null, 2);

  // Wire up all event handlers
  setupToolbar(s);
  setupTerrainCanvas(s);
  setupJsonEditor(s);
  setupFileIO(s);

  return s;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

/**
 * @param {EditorState} s
 */
function setupToolbar(s) {
  // Brush buttons
  const brushBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.brush-btn')
  );
  for (const btn of brushBtns) {
    btn.addEventListener('click', () => {
      for (const b of brushBtns) b.classList.remove('active');
      btn.classList.add('active');
      s.brushMode = /** @type {BrushMode} */ (btn.dataset['brush']);
    });
  }

  // Material select
  const matSelect = /** @type {HTMLSelectElement} */ (document.getElementById('material-select'));
  matSelect.addEventListener('change', () => {
    s.materialId = parseInt(matSelect.value, 10);
  });

  // Brush size slider
  const sizeSlider = /** @type {HTMLInputElement} */ (document.getElementById('brush-size'));
  const sizeLabel = /** @type {HTMLElement} */ (document.getElementById('brush-size-label'));
  sizeSlider.addEventListener('input', () => {
    s.brushSize = parseInt(sizeSlider.value, 10);
    sizeLabel.textContent = sizeSlider.value;
  });

  // Brush strength slider
  const strengthSlider = /** @type {HTMLInputElement} */ (document.getElementById('brush-strength'));
  const strengthLabel = /** @type {HTMLElement} */ (document.getElementById('brush-strength-label'));
  strengthSlider.addEventListener('input', () => {
    s.brushStrength = parseInt(strengthSlider.value, 10);
    strengthLabel.textContent = strengthSlider.value;
  });

  // Clear button
  const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('btn-clear-terrain'));
  clearBtn.addEventListener('click', () => {
    s.terrainData = defaultTerrainImageData();
    renderTerrain();
    schedulePreviewUpdate(s);
    setStatus('Terrain cleared');
  });
}

// ── Terrain Canvas ──────────────────────────────────────────────────────────

/**
 * @param {EditorState} s
 */
function setupTerrainCanvas(s) {
  const canvas = getTerrainCanvas();
  const cursorInfo = /** @type {HTMLElement} */ (document.getElementById('terrain-cursor-info'));

  /**
   * Get terrain pixel coords from mouse event on the scaled canvas.
   * @param {MouseEvent} e
   * @returns {[number, number]}
   */
  function canvasToPixel(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = TERRAIN_SIZE / rect.width;
    const scaleY = TERRAIN_SIZE / rect.height;
    const px = Math.floor((e.clientX - rect.left) * scaleX);
    const py = Math.floor((e.clientY - rect.top) * scaleY);
    return [
      Math.max(0, Math.min(TERRAIN_SIZE - 1, px)),
      Math.max(0, Math.min(TERRAIN_SIZE - 1, py)),
    ];
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    s.isPainting = true;
    const [px, py] = canvasToPixel(e);
    paintBrush(s, px, py);
    renderTerrain();
    schedulePreviewUpdate(s);
  });

  canvas.addEventListener('mousemove', (e) => {
    const [px, py] = canvasToPixel(e);

    // Update cursor info
    const idx = (py * TERRAIN_SIZE + px) * 4;
    const h = s.terrainData.data[idx];
    const m = s.terrainData.data[idx + 1];
    const matName = materialName(m);
    const [wx, wz] = pixelToWorld(px, py, s.config.world.radius);
    cursorInfo.textContent = `(${px}, ${py}) H:${h} M:${matName} | World:(${wx.toFixed(1)}, ${wz.toFixed(1)})`;

    if (s.isPainting) {
      paintBrush(s, px, py);
      renderTerrain();
      schedulePreviewUpdate(s);
    }
  });

  window.addEventListener('mouseup', () => {
    s.isPainting = false;
  });
}

/**
 * Apply the current brush at terrain pixel coordinates.
 * @param {EditorState} s
 * @param {number} cx - center pixel X
 * @param {number} cy - center pixel Y
 */
function paintBrush(s, cx, cy) {
  const r = s.brushSize;
  const data = s.terrainData.data;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      // Circular brush
      if (dx * dx + dy * dy > r * r) continue;

      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || px >= TERRAIN_SIZE || py < 0 || py >= TERRAIN_SIZE) continue;

      const idx = (py * TERRAIN_SIZE + px) * 4;

      // Falloff: stronger at center
      const dist = Math.sqrt(dx * dx + dy * dy);
      const falloff = 1.0 - (dist / (r + 1));

      switch (s.brushMode) {
        case 'heightUp': {
          const delta = Math.round(s.brushStrength * falloff);
          data[idx] = Math.min(255, data[idx] + delta);
          break;
        }
        case 'heightDown': {
          const delta = Math.round(s.brushStrength * falloff);
          data[idx] = Math.max(0, data[idx] - delta);
          break;
        }
        case 'material': {
          data[idx + 1] = s.materialId;
          break;
        }
      }
    }
  }
}

// ── Terrain Rendering ───────────────────────────────────────────────────────

/**
 * Render the terrain data to the terrain canvas as a colored top-down view,
 * then draw entity overlays from the JSON config.
 */
function renderTerrain() {
  const canvas = getTerrainCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw terrain pixels
  const display = ctx.createImageData(TERRAIN_SIZE, TERRAIN_SIZE);
  const src = state.terrainData.data;
  const dst = display.data;

  for (let i = 0; i < TERRAIN_SIZE * TERRAIN_SIZE; i++) {
    const si = i * 4;
    const height = src[si];
    const material = src[si + 1];
    const [r, g, b] = terrainPixelColor(height, material);
    dst[si] = r;
    dst[si + 1] = g;
    dst[si + 2] = b;
    dst[si + 3] = 255;
  }

  ctx.putImageData(display, 0, 0);

  // Draw entity overlays
  drawOverlays(ctx);
}

/**
 * Draw entity markers on the terrain canvas.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawOverlays(ctx) {
  const cfg = state.config;
  const wr = cfg.world.radius;

  // Ari start position
  {
    const [px, py] = worldToPixel(cfg.ari.startPosition[0], cfg.ari.startPosition[2], wr);
    ctx.save();
    ctx.strokeStyle = '#ff44ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.stroke();
    // Small cross
    ctx.beginPath();
    ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
    ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
    ctx.stroke();
    ctx.restore();
  }

  // Firefly zones
  for (const zone of cfg.fireflyZones) {
    const [px, py] = worldToPixel(zone.center[0], zone.center[2], wr);
    const radiusPx = (zone.radius / (2 * wr)) * TERRAIN_SIZE;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 100, 0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(px, py, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    // Label count
    ctx.fillStyle = 'rgba(255, 255, 100, 0.9)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${zone.count}`, px, py + 3);
    ctx.restore();
  }

  // House light position
  {
    const pos = cfg.lights.houseLight.position;
    const [px, py] = worldToPixel(pos[0], pos[2], wr);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 180, 80, 0.9)';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 180, 80, 0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('💡', px, py - 6);
    ctx.restore();
  }

  // World boundary circle
  {
    const centerPx = TERRAIN_SIZE / 2;
    const radiusPx = (TERRAIN_SIZE - 1) / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(centerPx, centerPx, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── JSON Editor ──────────────────────────────────────────────────────────────

/**
 * @param {EditorState} s
 */
function setupJsonEditor(s) {
  const editor = getJsonEditor();
  const errorEl = /** @type {HTMLElement} */ (document.getElementById('json-error'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('json-status'));

  /** Debounce timer for JSON parsing */
  let parseTimer = 0;

  editor.addEventListener('input', () => {
    s.jsonDirty = true;
    clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => {
      tryParseJson(s, editor, errorEl, statusEl);
    }, 400);
  });

  // Handle Tab key for indentation
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      editor.dispatchEvent(new Event('input'));
    }
  });
}

/**
 * Try to parse the JSON editor content and update config.
 * @param {EditorState} s
 * @param {HTMLTextAreaElement} editor
 * @param {HTMLElement} errorEl
 * @param {HTMLElement} statusEl
 */
function tryParseJson(s, editor, errorEl, statusEl) {
  try {
    const json = JSON.parse(editor.value);
    s.config = parseLevelConfig(json);
    s.jsonDirty = false;
    errorEl.style.display = 'none';
    statusEl.textContent = '✓ valid';
    statusEl.style.color = '#4ecca3';
    renderTerrain(); // Re-draw overlays
    updateStatusLevel();
    schedulePreviewUpdate(s);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorEl.textContent = `Parse error: ${msg}`;
    errorEl.style.display = 'block';
    statusEl.textContent = '✗ error';
    statusEl.style.color = '#e94560';
  }
}

// ── File I/O ────────────────────────────────────────────────────────────────

/**
 * @param {EditorState} s
 */
function setupFileIO(s) {
  // Load terrain
  const fileTerrainInput = /** @type {HTMLInputElement} */ (document.getElementById('file-terrain'));
  /** @type {HTMLButtonElement} */ (document.getElementById('btn-load-terrain'))
    .addEventListener('click', () => fileTerrainInput.click());
  fileTerrainInput.addEventListener('change', () => {
    const file = fileTerrainInput.files?.[0];
    if (!file) return;
    loadTerrainFromFile(s, file);
    fileTerrainInput.value = '';
  });

  // Load JSON
  const fileJsonInput = /** @type {HTMLInputElement} */ (document.getElementById('file-json'));
  /** @type {HTMLButtonElement} */ (document.getElementById('btn-load-json'))
    .addEventListener('click', () => fileJsonInput.click());
  fileJsonInput.addEventListener('change', () => {
    const file = fileJsonInput.files?.[0];
    if (!file) return;
    loadJsonFromFile(s, file);
    fileJsonInput.value = '';
  });

  // Save terrain
  /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-terrain'))
    .addEventListener('click', () => saveTerrain(s));

  // Save JSON
  /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-json'))
    .addEventListener('click', () => saveJson(s));

  // Save both
  /** @type {HTMLButtonElement} */ (document.getElementById('btn-save-both'))
    .addEventListener('click', async () => {
      await saveTerrain(s);
      saveJson(s);
    });
}

/**
 * Load a terrain PNG file into the editor.
 * @param {EditorState} s
 * @param {File} file
 */
async function loadTerrainFromFile(s, file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(TERRAIN_SIZE, TERRAIN_SIZE);
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    if (!ctx) throw new Error('Failed to get 2d context');
    ctx.drawImage(bitmap, 0, 0, TERRAIN_SIZE, TERRAIN_SIZE);
    s.terrainData = ctx.getImageData(0, 0, TERRAIN_SIZE, TERRAIN_SIZE);
    renderTerrain();
    schedulePreviewUpdate(s);
    setStatus(`Loaded terrain from ${file.name}`);
    // Update level ID from filename
    const match = file.name.match(/^(.+)\.png$/i);
    if (match) {
      s.levelId = match[1];
      updateStatusLevel();
    }
  } catch (e) {
    setStatus(`Failed to load terrain: ${e}`);
  }
}

/**
 * Load a level JSON file into the editor.
 * @param {EditorState} s
 * @param {File} file
 */
async function loadJsonFromFile(s, file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    s.config = parseLevelConfig(json);
    setJsonText(JSON.stringify(s.config, null, 2));
    renderTerrain();
    schedulePreviewUpdate(s);
    setStatus(`Loaded JSON from ${file.name}`);
    // Update level ID from filename
    const match = file.name.match(/^(.+)\.json$/i);
    if (match) {
      s.levelId = match[1];
      updateStatusLevel();
    }
  } catch (e) {
    setStatus(`Failed to load JSON: ${e}`);
  }
}

/**
 * Save terrain as PNG via download link.
 * @param {EditorState} s
 */
async function saveTerrain(s) {
  try {
    const blob = await terrainToBlob(s.terrainData);
    downloadBlob(blob, `${s.levelId}.png`);
    setStatus(`Saved terrain as ${s.levelId}.png`);
  } catch (e) {
    setStatus(`Failed to save terrain: ${e}`);
  }
}

/**
 * Save level JSON via download link.
 * @param {EditorState} s
 */
function saveJson(s) {
  // If JSON editor has been manually edited, use its text directly
  const jsonText = getJsonEditor().value;
  const blob = new Blob([jsonText], { type: 'application/json' });
  downloadBlob(blob, `${s.levelId}.json`);
  setStatus(`Saved JSON as ${s.levelId}.json`);
}

/**
 * Trigger a file download.
 * @param {Blob} blob
 * @param {string} filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Preview (WebGPU live preview) ───────────────────────────────────────────

/**
 * Initialize the WebGPU engine for the preview canvas.
 * @param {EditorState} s
 */
async function initPreview(s) {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('preview-canvas'));
  if (!canvas) return;

  const engine = await createEngine(canvas);
  if (!engine) {
    // WebGPU unavailable — show fallback text
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('WebGPU not available', canvas.width / 2, canvas.height / 2);
    }
    return;
  }

  s.engine = engine;

  // Load current editor state as level data
  const levelData = editorToLevelData(s);
  loadEngineLevel(engine, levelData);

  startFrameLoop(engine);
}

/**
 * Build a LevelData object from the current editor state.
 * @param {EditorState} s
 * @returns {LevelData}
 */
function editorToLevelData(s) {
  return {
    config: s.config,
    terrainImageData: s.terrainData,
  };
}

/**
 * Schedule a debounced preview update after terrain or JSON changes.
 * @param {EditorState} s
 */
function schedulePreviewUpdate(s) {
  clearTimeout(s.previewDebounceTimer);
  s.previewDebounceTimer = window.setTimeout(() => {
    if (s.engine) {
      loadEngineLevel(s.engine, editorToLevelData(s));
    }
  }, 300);
}

// Preview init runs after the editor state is ready
initPreview(state);

// ── DOM Helpers ──────────────────────────────────────────────────────────────

function getTerrainCanvas() {
  return /** @type {HTMLCanvasElement} */ (document.getElementById('terrain-canvas'));
}

function getJsonEditor() {
  return /** @type {HTMLTextAreaElement} */ (document.getElementById('json-editor'));
}

/**
 * @param {string} text
 */
function setJsonText(text) {
  getJsonEditor().value = text;
}

/**
 * @param {string} msg
 */
function setStatus(msg) {
  const el = document.getElementById('status-info');
  if (el) el.textContent = msg;
}

function updateStatusLevel() {
  const el = document.getElementById('status-level');
  if (el) el.textContent = `Level: ${state.levelId} (${state.config.name})`;
}

/**
 * @param {number} matId
 * @returns {string}
 */
function materialName(matId) {
  if (matId < 32) return 'grass';
  if (matId < 96) return 'puddle';
  if (matId < 160) return 'wood';
  return 'concrete';
}
