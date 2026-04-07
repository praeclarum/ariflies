// @ts-check

/**
 * @fileoverview GPU buffer creation, struct layouts, and staging readback.
 * All game state lives on the GPU. CPU only writes input and reads back score.
 */

/** Number of fireflies in the simulation */
export const FIREFLY_COUNT = 50;

// ── Struct byte sizes (must match WGSL struct layouts) ──────────────────────

/** InputUniforms: keys(u32) + mouseButtons(u32) + mouseDelta(vec2f) + dt(f32) + time(f32) + resolution(vec2f) + renderScale(f32) + _pad(f32) */
export const INPUT_UNIFORMS_SIZE = 48;

/** CameraState: eye(vec3f) + _pad + target(vec3f) + _pad + orbitYaw(f32) + orbitPitch(f32) + distance(f32) + fov(f32) */
export const CAMERA_STATE_SIZE = 48;

/** AriState: position(vec3f) + facing(f32) + velocity(vec3f) + speed(f32) + groundY(f32) + poseState(u32) + jumpT(f32) + animPhase(f32) + tailPhase(f32) + _pad(3×f32) */
export const ARI_STATE_SIZE = 64;

/** Single firefly: position(vec3f) + phase(f32) + velocity(vec3f) + brightness(f32) + homePosition(vec3f) + alive(u32) = 48 bytes */
export const FIREFLY_STRIDE = 48;
export const FIREFLY_ARRAY_SIZE = FIREFLY_STRIDE * FIREFLY_COUNT;

/** GameState: score(u32) + catchThisFrame(u32) + gamePhase(u32) + timeRemaining(f32) */
export const GAME_STATE_SIZE = 16;

/** SceneParams: moonDir(vec3f) + _pad + moonColor(vec3f) + _pad + houseLightPos(vec3f) + _pad + houseLightColor(vec3f) + fogDensity(f32) + ambientColor(vec3f) + _pad */
export const SCENE_PARAMS_SIZE = 80;

// ── Key bitmask constants (shared with WGSL) ───────────────────────────────

export const KEY_W     = 0x01;
export const KEY_A     = 0x02;
export const KEY_S     = 0x04;
export const KEY_D     = 0x08;
export const KEY_SPACE = 0x10;
export const KEY_SHIFT = 0x20;

// ── Pose state constants ────────────────────────────────────────────────────

export const POSE_IDLE   = 0;
export const POSE_WALK   = 1;
export const POSE_RUN    = 2;
export const POSE_CROUCH = 3;
export const POSE_JUMP   = 4;
export const POSE_LAND   = 5;

// ── Game phase constants ────────────────────────────────────────────────────

export const PHASE_WAITING = 0;
export const PHASE_PLAYING = 1;
export const PHASE_ENDED   = 2;

/**
 * @typedef {Object} Buffers
 * @property {GPUBuffer} input
 * @property {GPUBuffer} camera
 * @property {GPUBuffer} ari
 * @property {GPUBuffer} fireflies
 * @property {GPUBuffer} game
 * @property {GPUBuffer} scene
 * @property {GPUBuffer} gameStaging
 */

/**
 * Create all GPU buffers with initial state.
 * @param {GPUDevice} device
 * @returns {Buffers}
 */
export function createBuffers(device) {
  const input = device.createBuffer({
    label: 'InputUniforms',
    size: INPUT_UNIFORMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const camera = device.createBuffer({
    label: 'CameraState',
    size: CAMERA_STATE_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const ari = device.createBuffer({
    label: 'AriState',
    size: ARI_STATE_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const fireflies = device.createBuffer({
    label: 'FireflyArray',
    size: FIREFLY_ARRAY_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const game = device.createBuffer({
    label: 'GameState',
    size: GAME_STATE_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const scene = device.createBuffer({
    label: 'SceneParams',
    size: SCENE_PARAMS_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const gameStaging = device.createBuffer({
    label: 'GameState-Staging',
    size: GAME_STATE_SIZE,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // ── Write initial values ────────────────────────────────────────────────

  // Camera: behind and above Ari, looking toward origin
  {
    const data = new ArrayBuffer(CAMERA_STATE_SIZE);
    const f = new Float32Array(data);
    // eye (vec3f + pad)
    f[0] = 0.0; f[1] = 5.0; f[2] = -8.0; f[3] = 0.0;
    // target (vec3f + pad)
    f[4] = 0.0; f[5] = 0.0; f[6] = 0.0; f[7] = 0.0;
    // orbitYaw, orbitPitch, distance, fov
    f[8] = 0.0; f[9] = 0.4; f[10] = 10.0; f[11] = 1.0;
    device.queue.writeBuffer(camera, 0, data);
  }

  // Ari: at world center, facing +Z
  {
    const data = new ArrayBuffer(ARI_STATE_SIZE);
    const f = new Float32Array(data);
    // position(vec3f) + forwardX
    f[0] = 0.0; f[1] = 0.0; f[2] = 0.0; f[3] = 0.0;  // forwardX = 0
    // velocity(vec3f) + forwardZ
    f[4] = 0.0; f[5] = 0.0; f[6] = 0.0; f[7] = 1.0;  // forwardZ = 1 (facing +Z)
    // groundY, poseState, jumpT, animPhase
    f[8] = 0.0;
    new Uint32Array(data, 36, 1)[0] = POSE_IDLE;
    f[10] = 0.0; f[11] = 0.0;
    // tailPhase + padding
    f[12] = 0.0;
    device.queue.writeBuffer(ari, 0, data);
  }

  // Fireflies: random home positions scattered around yard
  {
    const data = new ArrayBuffer(FIREFLY_ARRAY_SIZE);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const yardRadius = 12.0;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const base = (i * FIREFLY_STRIDE) / 4; // f32 offset
      // random position in yard
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * yardRadius;
      const px = Math.cos(angle) * dist;
      const pz = Math.sin(angle) * dist;
      const py = 0.5 + Math.random() * 2.0;
      // position(vec3f) + phase
      f[base + 0] = px;
      f[base + 1] = py;
      f[base + 2] = pz;
      f[base + 3] = Math.random() * Math.PI * 2; // phase
      // velocity(vec3f) + brightness
      f[base + 4] = 0.0;
      f[base + 5] = 0.0;
      f[base + 6] = 0.0;
      f[base + 7] = 0.5 + Math.random() * 0.5; // brightness
      // homePosition(vec3f) + alive(u32)
      f[base + 8] = px;
      f[base + 9] = py;
      f[base + 10] = pz;
      u[base + 11] = 1; // alive
    }
    device.queue.writeBuffer(fireflies, 0, data);
  }

  // GameState: waiting phase, 120 seconds
  {
    const data = new ArrayBuffer(GAME_STATE_SIZE);
    const u = new Uint32Array(data);
    const f = new Float32Array(data);
    u[0] = 0;              // score
    u[1] = 0;              // catchThisFrame
    u[2] = PHASE_PLAYING;  // gamePhase — start playing immediately for now
    f[3] = 120.0;          // timeRemaining
    device.queue.writeBuffer(game, 0, data);
  }

  // SceneParams: moonlight + house light + fog
  {
    const data = new ArrayBuffer(SCENE_PARAMS_SIZE);
    const f = new Float32Array(data);
    // moonDir (normalized, lower in sky so it's visible during gameplay)
    const mx = 0.4, my = 0.35, mz = 0.6;
    const ml = Math.sqrt(mx * mx + my * my + mz * mz);
    f[0] = mx / ml; f[1] = my / ml; f[2] = mz / ml; f[3] = 0.0;
    // moonColor (cool blue-white, slightly brighter for drama)
    f[4] = 0.7; f[5] = 0.8; f[6] = 1.0; f[7] = 0.0;
    // houseLightPos
    f[8] = -8.0; f[9] = 3.0; f[10] = 8.0; f[11] = 0.0;
    // houseLightColor (warm amber) + fogDensity (lower for better god rays)
    f[12] = 1.0; f[13] = 0.7; f[14] = 0.3; f[15] = 0.03;
    // ambientColor (very dim blue, slightly stronger for shadow readability)
    f[16] = 0.025; f[17] = 0.035; f[18] = 0.07; f[19] = 0.0;
    device.queue.writeBuffer(scene, 0, data);
  }

  return { input, camera, ari, fireflies, game, scene, gameStaging };
}

/**
 * Schedule a copy of GameState → staging buffer within an encoder.
 * Call this after compute passes, before encoder.finish().
 * @param {GPUCommandEncoder} encoder
 * @param {Buffers} buffers
 */
export function copyGameStateToStaging(encoder, buffers) {
  encoder.copyBufferToBuffer(buffers.game, 0, buffers.gameStaging, 0, GAME_STATE_SIZE);
}

/**
 * Async readback of the staging buffer. Returns score and game state.
 * Must be called after the command buffer containing the copy has been submitted.
 * @param {Buffers} buffers
 * @returns {Promise<{score: number, catchThisFrame: number, gamePhase: number, timeRemaining: number}>}
 */
export async function readbackGameState(buffers) {
  await buffers.gameStaging.mapAsync(GPUMapMode.READ);
  const data = new Uint32Array(buffers.gameStaging.getMappedRange().slice(0));
  const fdata = new Float32Array(data.buffer);
  buffers.gameStaging.unmap();
  return {
    score: data[0],
    catchThisFrame: data[1],
    gamePhase: data[2],
    timeRemaining: fdata[3],
  };
}
