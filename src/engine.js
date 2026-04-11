// @ts-check

/**
 * @fileoverview Reusable game engine. Wraps WebGPU init, buffers, pipelines,
 * renderer, and frame loop. Used by both main.js (game) and editor.js (preview).
 */

import { createBuffers, copyGameStateToStaging, resetBuffersFromLevel, createTerrainTextures, GAME_STATE_SIZE, PHASE_PLAYING } from './buffers.js';
import { createInput, writeInputBuffer } from './input.js';
import { createGame, writeGameState, requestScoreReadback, updateUI } from './game.js';
import { createComputePipelines, dispatchCompute, rebuildAriBindGroup, preprocessTerrain } from './compute.js';
import { createRenderer, render, rebuildRenderBindGroup } from './renderer.js';
import { spawnFirefliesFromZones } from './levels.js';

/**
 * @typedef {import('./buffers.js').Buffers} Buffers
 * @typedef {import('./compute.js').ComputePipelines} ComputePipelines
 * @typedef {import('./renderer.js').Renderer} Renderer
 * @typedef {import('./input.js').InputState} InputState
 * @typedef {import('./game.js').GameSession} GameSession
 * @typedef {import('./levels.js').LevelConfig} LevelConfig
 * @typedef {import('./levels.js').LevelData} LevelData
 */

/**
 * @typedef {Object} Engine
 * @property {GPUDevice} device
 * @property {GPUCanvasContext} context
 * @property {HTMLCanvasElement} canvas
 * @property {GPUTextureFormat} format
 * @property {Buffers} buffers
 * @property {ComputePipelines} computePipelines
 * @property {Renderer} renderer
 * @property {InputState} inputState
 * @property {GameSession|null} gameSession
 * @property {number} animFrameId
 * @property {boolean} running
 * @property {number} lastTime
 * @property {number} totalTime
 * @property {number} frameCount
 * @property {number} renderScale
 * @property {(() => void)|null} _resizeHandler
 */

/**
 * Initialize the WebGPU engine on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Engine|null>} null if WebGPU is unavailable
 */
export async function createEngine(canvas) {
  if (!navigator.gpu) {
    console.error('WebGPU not supported');
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error('No GPU adapter');
    return null;
  }

  /** @type {GPUDeviceDescriptor} */
  const deviceDesc = {};
  if (adapter.features.has('float32-filterable')) {
    deviceDesc.requiredFeatures = ['float32-filterable'];
  }
  const device = await adapter.requestDevice(deviceDesc);
  const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  if (!context) {
    console.error('No WebGPU context');
    return null;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  device.addEventListener('uncapturederror', (event) => {
    console.error('WebGPU error:', event.error);
  });

  // Create GPU buffers and pipelines
  const buffers = createBuffers(device);
  const inputState = createInput(canvas);

  const [computePipelines, renderer] = await Promise.all([
    createComputePipelines(device, buffers),
    createRenderer(device, format, buffers),
  ]);

  /** @type {Engine} */
  const engine = {
    device,
    context,
    canvas,
    format,
    buffers,
    computePipelines,
    renderer,
    inputState,
    gameSession: null,
    animFrameId: 0,
    running: false,
    lastTime: 0,
    totalTime: 0,
    frameCount: 0,
    renderScale: 1.0,
    _resizeHandler: null,
  };

  return engine;
}

/**
 * Load level data into the engine, resetting all buffer state.
 * Does not recreate pipelines or buffers — just writes new initial values.
 * @param {Engine} engine
 * @param {LevelData} levelData
 */
export function loadLevel(engine, levelData) {
  const homes = spawnFirefliesFromZones(levelData.config.fireflyZones);
  const terrainSize = levelData.terrainImageData.width;

  // Recreate terrain textures if size changed
  if (terrainSize !== engine.buffers.terrainSize) {
    const terrain = createTerrainTextures(engine.device, terrainSize);
    engine.buffers.terrainTexture = terrain.terrainTexture;
    engine.buffers.slopeTexture = terrain.slopeTexture;
    engine.buffers.terrainSampler = terrain.terrainSampler;
    engine.buffers.terrainSize = terrain.terrainSize;

    // Rebuild bind groups that reference terrain textures
    rebuildAriBindGroup(engine.device, engine.computePipelines, engine.buffers);
    rebuildRenderBindGroup(engine.device, engine.renderer, engine.buffers);
  }

  resetBuffersFromLevel(engine.device, engine.buffers, levelData.config, homes, levelData.terrainImageData);

  // Preprocess terrain: compute max-slope texture for ray marcher
  preprocessTerrain(
    engine.device, engine.computePipelines, engine.buffers,
    levelData.config.world.radius, levelData.config.world.maxHeight,
  );

  // Reset game session if one exists
  if (engine.gameSession) {
    engine.gameSession.phase = PHASE_PLAYING;
    engine.gameSession.timeRemaining = levelData.config.game.duration;
    engine.gameSession.score = 0;
  }

  // Reset timing
  engine.lastTime = 0;
  engine.totalTime = 0;
  engine.frameCount = 0;
}

/**
 * Attach a game session with DOM UI to the engine.
 * @param {Engine} engine
 * @param {{ duration?: number }} [options]
 */
export function attachGameSession(engine, options) {
  engine.gameSession = createGame(engine.buffers, options);
}

/**
 * Start the frame loop.
 * @param {Engine} engine
 */
export function startFrameLoop(engine) {
  if (engine.running) return;
  engine.running = true;
  engine.lastTime = performance.now();

  // Set up canvas resize handling
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    engine.canvas.width = Math.floor(engine.canvas.clientWidth * dpr);
    engine.canvas.height = Math.floor(engine.canvas.clientHeight * dpr);
  };
  engine._resizeHandler = resize;
  window.addEventListener('resize', resize);
  resize();

  function frame() {
    if (!engine.running) return;
    runOneFrame(engine);
    engine.animFrameId = requestAnimationFrame(frame);
  }

  engine.animFrameId = requestAnimationFrame(frame);
}

/**
 * Stop the frame loop.
 * @param {Engine} engine
 */
export function stopFrameLoop(engine) {
  engine.running = false;
  if (engine.animFrameId) {
    cancelAnimationFrame(engine.animFrameId);
    engine.animFrameId = 0;
  }
  if (engine._resizeHandler) {
    window.removeEventListener('resize', engine._resizeHandler);
    engine._resizeHandler = null;
  }
}

/**
 * Execute a single frame: input → game state → compute → render → readback.
 * @param {Engine} engine
 */
export function runOneFrame(engine) {
  const now = performance.now();
  const dt = engine.lastTime === 0
    ? 0.016
    : Math.max(0.001, Math.min((now - engine.lastTime) / 1000, 0.05));
  engine.lastTime = now;
  engine.totalTime += dt;
  engine.frameCount++;

  const { device, context, buffers, computePipelines, renderer, inputState, gameSession, canvas } = engine;

  // 1. CPU → GPU: write input uniforms
  writeInputBuffer(device, buffers.input, inputState, dt, engine.totalTime, canvas, engine.renderScale);

  // 2. CPU → GPU: write game state
  if (gameSession) {
    writeGameState(device, buffers, gameSession, dt);
  } else {
    // Editor mode: static game state (always playing, no timer)
    const data = new ArrayBuffer(GAME_STATE_SIZE);
    const u = new Uint32Array(data);
    const f = new Float32Array(data);
    u[0] = 0; u[1] = 0; u[2] = PHASE_PLAYING; f[3] = 9999.0;
    device.queue.writeBuffer(buffers.game, 0, data);
  }

  // 3–6. GPU work: compute + render
  const encoder = device.createCommandEncoder();
  dispatchCompute(encoder, computePipelines);
  render(encoder, context, renderer);

  // 7. Staging copy for score readback
  if (gameSession && !gameSession.readbackPending) {
    copyGameStateToStaging(encoder, buffers);
  }

  // 8. Submit
  device.queue.submit([encoder.finish()]);

  // 9. Readback + UI update
  if (gameSession) {
    if (!gameSession.readbackPending) {
      requestScoreReadback(buffers, gameSession);
    }
    updateUI(gameSession);
  }
}

/**
 * Clean up engine resources.
 * @param {Engine} engine
 */
export function destroyEngine(engine) {
  stopFrameLoop(engine);
  engine.device.destroy();
}
