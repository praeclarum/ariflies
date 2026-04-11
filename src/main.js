// @ts-check

/**
 * @fileoverview App entry point. Creates engine, loads level, starts game.
 */

import { createEngine, loadLevel, attachGameSession, startFrameLoop } from './engine.js';
import { loadLevel as loadLevelData, defaultLevel } from './levels.js';

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
  const messageEl = /** @type {HTMLElement} */ (document.getElementById('message'));

  // ── Load level ──────────────────────────────────────────────────────────

  const params = new URLSearchParams(window.location.search);
  const levelId = params.get('level') || 'level0';

  let levelData;
  try {
    levelData = await loadLevelData(levelId);
  } catch (e) {
    console.warn(`Failed to load level ${levelId}, using defaults:`, e);
    levelData = defaultLevel();
  }

  // ── Create engine ───────────────────────────────────────────────────────

  const engine = await createEngine(canvas);
  if (!engine) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'WebGPU is not supported in this browser.';
    return;
  }

  // Load level data into GPU buffers
  loadLevel(engine, levelData);

  // Attach game session (timer, score, UI)
  attachGameSession(engine, { duration: levelData.config.game.duration });

  console.log(`Level "${levelData.config.name}" loaded (${levelId})`);

  // ── Start ───────────────────────────────────────────────────────────────

  startFrameLoop(engine);
}

main();
