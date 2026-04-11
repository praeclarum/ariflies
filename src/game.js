// @ts-check

/**
 * @fileoverview Game session management: timer, score readback, DOM updates.
 * Thin CPU-side orchestrator — actual game logic runs in GPU compute.
 */

import { GAME_STATE_SIZE, PHASE_WAITING, PHASE_PLAYING, PHASE_ENDED, readbackGameState } from './buffers.js';

/**
 * @typedef {import('./buffers.js').Buffers} Buffers
 */

/**
 * @typedef {Object} GameSession
 * @property {number} phase
 * @property {number} timeRemaining
 * @property {number} score
 * @property {boolean} readbackPending
 * @property {HTMLElement|null} scoreEl
 * @property {HTMLElement|null} timerEl
 * @property {HTMLElement|null} messageEl
 */

/**
 * Create a game session manager.
 * @param {Buffers} buffers
 * @param {{ duration?: number }} [options]
 * @returns {GameSession}
 */
export function createGame(buffers, options) {
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  const messageEl = document.getElementById('message');
  const duration = options?.duration ?? 120.0;

  // Suppress unused variable warning — buffers stored implicitly via closure in future use
  void buffers;

  return {
    phase: PHASE_PLAYING,
    timeRemaining: duration,
    score: 0,
    readbackPending: false,
    scoreEl,
    timerEl,
    messageEl,
  };
}

/**
 * Write the current game time/phase into the GPU GameState buffer.
 * Called each frame before compute passes.
 * @param {GPUDevice} device
 * @param {Buffers} buffers
 * @param {GameSession} session
 * @param {number} dt
 */
export function writeGameState(device, buffers, session, dt) {
  if (session.phase === PHASE_PLAYING) {
    session.timeRemaining = Math.max(0, session.timeRemaining - dt);
    if (session.timeRemaining <= 0) {
      session.phase = PHASE_ENDED;
    }
  }

  const data = new ArrayBuffer(GAME_STATE_SIZE);
  const u = new Uint32Array(data);
  const f = new Float32Array(data);
  // We only write phase and timeRemaining from CPU.
  // Score and catchThisFrame are managed by GPU compute.
  // But we need to write the full struct since writeBuffer replaces all bytes.
  // So we preserve score from last readback.
  u[0] = session.score;
  u[1] = 0; // catchThisFrame reset
  u[2] = session.phase;
  f[3] = session.timeRemaining;
  device.queue.writeBuffer(buffers.game, 0, data);
}

/**
 * Kick off async readback of GPU GameState. Non-blocking.
 * @param {Buffers} buffers
 * @param {GameSession} session
 */
export function requestScoreReadback(buffers, session) {
  if (session.readbackPending) return;
  session.readbackPending = true;

  readbackGameState(buffers).then((state) => {
    session.score = state.score;
    session.readbackPending = false;
  }).catch(() => {
    session.readbackPending = false;
  });
}

/**
 * Update DOM elements with current game state.
 * @param {GameSession} session
 */
export function updateUI(session) {
  if (session.scoreEl) {
    session.scoreEl.textContent = `Score: ${session.score}`;
  }

  if (session.timerEl) {
    const mins = Math.floor(session.timeRemaining / 60);
    const secs = Math.floor(session.timeRemaining % 60);
    session.timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  if (session.messageEl) {
    if (session.phase === PHASE_ENDED) {
      session.messageEl.style.display = 'block';
      session.messageEl.textContent = `Time's up!\nFinal score: ${session.score}`;
    } else {
      session.messageEl.style.display = 'none';
    }
  }
}
