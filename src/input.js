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
 * @property {number} analogX - touch virtual trackpad X (-1 to 1)
 * @property {number} analogZ - touch virtual trackpad Z (-1 to 1)
 * @property {number | null} touchId - primary touch identifier
 * @property {number} touchStartX
 * @property {number} touchStartY
 * @property {number} touchStartTime
 * @property {number | null} secondTouchId - second finger for camera
 * @property {number} secondTouchLastX
 * @property {number} secondTouchLastY
 * @property {boolean} pendingTap - tap detected, inject space next frame
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
    analogX: 0,
    analogZ: 0,
    touchId: null,
    touchStartX: 0,
    touchStartY: 0,
    touchStartTime: 0,
    secondTouchId: null,
    secondTouchLastX: 0,
    secondTouchLastY: 0,
    pendingTap: false,
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

  // ── Touch input (mobile / tablet) ──────────────────────────────────────
  const TAP_MAX_TIME = 300;   // ms
  const TAP_MAX_DIST = 15;    // px
  const ANALOG_RADIUS = 80;   // px drag distance for full speed

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (state.touchId === null) {
        // First finger: movement trackpad
        state.touchId = t.identifier;
        state.touchStartX = t.clientX;
        state.touchStartY = t.clientY;
        state.touchStartTime = performance.now();
      } else if (state.secondTouchId === null && t.identifier !== state.touchId) {
        // Second finger: camera orbit
        state.secondTouchId = t.identifier;
        state.secondTouchLastX = t.clientX;
        state.secondTouchLastY = t.clientY;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === state.touchId) {
        // First finger → analog movement (virtual trackpad)
        const dx = t.clientX - state.touchStartX;
        const dy = t.clientY - state.touchStartY;
        // Map screen Y (down=positive) to world forward (negative Z in screen space = forward)
        // Screen drag up → move forward (+Z in game input)
        // Screen drag right → move right (+X in game input)
        state.analogX = Math.max(-1, Math.min(1, dx / ANALOG_RADIUS));
        state.analogZ = Math.max(-1, Math.min(1, -dy / ANALOG_RADIUS));
      } else if (t.identifier === state.secondTouchId) {
        // Second finger → camera orbit (feed into mouseDelta)
        state.mouseDeltaX += t.clientX - state.secondTouchLastX;
        state.mouseDeltaY += t.clientY - state.secondTouchLastY;
        state.secondTouchLastX = t.clientX;
        state.secondTouchLastY = t.clientY;
      }
    }
  }, { passive: false });

  /** @param {TouchEvent} e */
  const handleTouchEnd = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === state.touchId) {
        // Check for tap (short + small movement)
        const elapsed = performance.now() - state.touchStartTime;
        const dx = t.clientX - state.touchStartX;
        const dy = t.clientY - state.touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (elapsed < TAP_MAX_TIME && dist < TAP_MAX_DIST) {
          state.pendingTap = true;
        }
        state.touchId = null;
        state.analogX = 0;
        state.analogZ = 0;
      } else if (t.identifier === state.secondTouchId) {
        state.secondTouchId = null;
      }
    }
  };

  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

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

  // analogX, analogZ: f32 (touch virtual trackpad)
  f[9] = state.analogX;
  f[10] = state.analogZ;

  // Handle tap → inject space key for one frame
  if (state.pendingTap) {
    u[0] |= KEY_SPACE;
    state.pendingTap = false;
  }

  // Reset accumulated deltas
  state.mouseDeltaX = 0;
  state.mouseDeltaY = 0;
  state.mouseButtons = 0;

  device.queue.writeBuffer(buffer, 0, data);
}
