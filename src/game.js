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
 * @property {number} health
 * @property {'time'|'health'} endReason
 * @property {boolean} readbackPending
 * @property {HTMLElement|null} scoreEl
 * @property {HTMLElement|null} healthEl
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
  const healthEl = document.getElementById('health');
  const timerEl = document.getElementById('timer');
  const messageEl = document.getElementById('message');
  const duration = options?.duration ?? 120.0;

  // Suppress unused variable warning — buffers stored implicitly via closure in future use
  void buffers;

  return {
    phase: PHASE_PLAYING,
    timeRemaining: duration,
    score: 0,
    health: 100,
    endReason: 'time',
    readbackPending: false,
    scoreEl,
    healthEl,
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
  if (session.phase === PHASE_PLAYING && session.health <= 0) {
    session.phase = PHASE_ENDED;
    session.endReason = 'health';
  }

  if (session.phase === PHASE_PLAYING) {
    session.timeRemaining = Math.max(0, session.timeRemaining - dt);
    if (session.timeRemaining <= 0) {
      session.phase = PHASE_ENDED;
      session.endReason = 'time';
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
  f[4] = session.health;
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
    session.health = Math.max(0, state.health);

    if (state.gamePhase === PHASE_ENDED && session.phase === PHASE_PLAYING) {
      session.phase = PHASE_ENDED;
      session.endReason = session.health <= 0 ? 'health' : 'time';
    }

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

  if (session.healthEl) {
    const healthInt = Math.max(0, Math.round(session.health));
    session.healthEl.textContent = `Health: ${healthInt}`;
  }

  if (session.timerEl) {
    const mins = Math.floor(session.timeRemaining / 60);
    const secs = Math.floor(session.timeRemaining % 60);
    session.timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  if (session.messageEl) {
    if (session.phase === PHASE_ENDED) {
      session.messageEl.style.display = 'block';
      if (session.endReason === 'health') {
        session.messageEl.textContent = `Health depleted!\nFinal score: ${session.score}`;
      } else {
        session.messageEl.textContent = `Time's up!\nFinal score: ${session.score}`;
      }
    } else {
      session.messageEl.style.display = 'none';
    }
  }
}
