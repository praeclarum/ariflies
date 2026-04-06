// @ts-check

/**
 * @fileoverview App entry point. WebGPU init, frame loop orchestration.
 * CPU responsibility: gather input, manage timer, update DOM. Everything else is GPU.
 */

import { createBuffers, copyGameStateToStaging } from './buffers.js';
import { createInput, writeInputBuffer } from './input.js';
import { createGame, writeGameState, requestScoreReadback, updateUI } from './game.js';
import { createComputePipelines, dispatchCompute } from './compute.js';
import { createRenderer, render } from './renderer.js';

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
  const messageEl = /** @type {HTMLElement} */ (document.getElementById('message'));

  // ── WebGPU init ─────────────────────────────────────────────────────────

  if (!navigator.gpu) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'WebGPU is not supported in this browser.';
    console.error('WebGPU not supported');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'Failed to get GPU adapter.';
    console.error('No GPU adapter');
    return;
  }

  const device = await adapter.requestDevice();
  const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  if (!context) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'Failed to get WebGPU context.';
    console.error('No WebGPU context');
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  console.log('WebGPU initialized');
  console.log(`  Adapter: ${adapter.info?.vendor ?? 'unknown'} / ${adapter.info?.architecture ?? 'unknown'}`);
  console.log(`  Format: ${format}`);

  // ── Resize handling ─────────────────────────────────────────────────────

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Create GPU buffers and game systems ─────────────────────────────────

  const buffers = createBuffers(device);
  const inputState = createInput(canvas);
  const gameSession = createGame(buffers);

  // Load shaders and create pipelines (async)
  const [computePipelines, renderer] = await Promise.all([
    createComputePipelines(device, buffers),
    createRenderer(device, format, buffers),
  ]);

  console.log('Pipelines ready');

  // ── Frame loop ──────────────────────────────────────────────────────────

  const renderScale = 1.0;
  let lastTime = performance.now();
  let totalTime = 0;

  function frame() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms to avoid spiral
    lastTime = now;
    totalTime += dt;

    // 1. CPU → GPU: write input uniforms
    writeInputBuffer(device, buffers.input, inputState, dt, totalTime, canvas, renderScale);

    // 2. CPU → GPU: write game time/phase
    writeGameState(device, buffers, gameSession, dt);

    // 3-6. GPU work: compute passes + render pass
    const encoder = device.createCommandEncoder();
    dispatchCompute(encoder, computePipelines);
    render(encoder, context, renderer);

    // 7. Copy GameState → staging for async readback
    copyGameStateToStaging(encoder, buffers);

    // 8. Submit
    device.queue.submit([encoder.finish()]);

    // 9. Async readback + DOM update
    requestScoreReadback(buffers, gameSession);
    updateUI(gameSession);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
