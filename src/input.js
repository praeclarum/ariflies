// @ts-check

/**
 * @fileoverview DOM event capture → GPU input uniform buffer writes.
 * The CPU's only per-frame contribution: gather raw input and write it to the GPU.
 */

import { INPUT_UNIFORMS_SIZE, KEY_W, KEY_A, KEY_S, KEY_D, KEY_SPACE, KEY_SHIFT } from './buffers.js';

/**
 * @typedef {Object} InputState
 * @property {Set<string>} keysDown
 * @property {number} mouseDeltaX
 * @property {number} mouseDeltaY
 * @property {number} mouseButtons
 * @property {boolean} isDragging
 */

/** @type {Map<string, number>} */
const KEY_MAP = new Map([
  ['KeyW', KEY_W], ['ArrowUp', KEY_W],
  ['KeyA', KEY_A], ['ArrowLeft', KEY_A],
  ['KeyS', KEY_S], ['ArrowDown', KEY_S],
  ['KeyD', KEY_D], ['ArrowRight', KEY_D],
  ['Space', KEY_SPACE],
  ['ShiftLeft', KEY_SHIFT], ['ShiftRight', KEY_SHIFT],
]);

/**
 * Set up input event listeners on the canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {InputState}
 */
export function createInput(canvas) {
  /** @type {InputState} */
  const state = {
    keysDown: new Set(),
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    mouseButtons: 0,
    isDragging: false,
  };

  window.addEventListener('keydown', (e) => {
    state.keysDown.add(e.code);
    // Prevent spacebar from scrolling the page
    if (e.code === 'Space') e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    state.keysDown.delete(e.code);
  });

  // Camera rotation via right-click drag or middle-click drag
  canvas.addEventListener('mousemove', (e) => {
    if (state.isDragging) {
      state.mouseDeltaX += e.movementX;
      state.mouseDeltaY += e.movementY;
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    state.mouseButtons |= (1 << e.button);
    // Right-click (button 2) or middle-click (button 1) starts camera drag
    if (e.button === 2 || e.button === 1) {
      state.isDragging = true;
      e.preventDefault();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    state.mouseButtons &= ~(1 << e.button);
    if (e.button === 2 || e.button === 1) {
      state.isDragging = false;
    }
  });

  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Trackpad / scroll-wheel camera rotation
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.mouseDeltaX += e.deltaX * 0.5;
    state.mouseDeltaY += e.deltaY * 0.5;
  }, { passive: false });

  return state;
}

/**
 * Pack current input state into the GPU uniform buffer and reset deltas.
 * Layout must match WGSL InputUniforms struct.
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {InputState} state
 * @param {number} dt - frame delta time in seconds
 * @param {number} time - total elapsed time in seconds
 * @param {HTMLCanvasElement} canvas
 * @param {number} renderScale
 */
export function writeInputBuffer(device, buffer, state, dt, time, canvas, renderScale) {
  const data = new ArrayBuffer(INPUT_UNIFORMS_SIZE);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);

  // keys: u32 bitmask
  let keys = 0;
  for (const [code, bit] of KEY_MAP) {
    if (state.keysDown.has(code)) keys |= bit;
  }
  u[0] = keys;

  // mouseButtons: u32
  u[1] = state.mouseButtons;

  // mouseDelta: vec2f
  f[2] = state.mouseDeltaX;
  f[3] = state.mouseDeltaY;

  // dt, time: f32
  f[4] = dt;
  f[5] = time;

  // resolution: vec2f
  f[6] = canvas.width;
  f[7] = canvas.height;

  // renderScale: f32
  f[8] = renderScale;

  // _pad: f32 (leave as 0)

  // Reset accumulated deltas
  state.mouseDeltaX = 0;
  state.mouseDeltaY = 0;
  state.mouseButtons = 0;

  device.queue.writeBuffer(buffer, 0, data);
}
