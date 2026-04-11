// @ts-check

/**
 * @fileoverview GPU buffer creation, struct layouts, and staging readback.
 * All game state lives on the GPU. CPU only writes input and reads back score.
 */

/** Default number of fireflies in the simulation */
export const FIREFLY_COUNT = 50;

/** Maximum number of fireflies the buffer can hold */
export const MAX_FIREFLIES = 200;

// ── Struct byte sizes (must match WGSL struct layouts) ──────────────────────

/** InputUniforms: keys(u32) + mouseButtons(u32) + mouseDelta(vec2f) + dt(f32) + time(f32) + resolution(vec2f) + renderScale(f32) + _pad(f32) */
export const INPUT_UNIFORMS_SIZE = 48;

/** CameraState: eye(vec3f) + _pad + target(vec3f) + _pad + orbitYaw(f32) + orbitPitch(f32) + distance(f32) + fov(f32) */
export const CAMERA_STATE_SIZE = 48;

/** AriState: position(vec3f) + facing(f32) + velocity(vec3f) + speed(f32) + groundY(f32) + poseState(u32) + jumpT(f32) + animPhase(f32) + tailPhase(f32) + _pad(3×f32) */
export const ARI_STATE_SIZE = 64;

/** Single firefly: position(vec3f) + phase(f32) + velocity(vec3f) + brightness(f32) + homePosition(vec3f) + alive(u32) = 48 bytes */
export const FIREFLY_STRIDE = 48;
export const FIREFLY_ARRAY_SIZE = FIREFLY_STRIDE * MAX_FIREFLIES;

/** GameState: score(u32) + catchThisFrame(u32) + gamePhase(u32) + timeRemaining(f32) */
export const GAME_STATE_SIZE = 16;

/** SceneParams: moonDir(vec3f) + _pad + moonColor(vec3f) + _pad + houseLightPos(vec3f) + _pad + houseLightColor(vec3f) + fogDensity(f32) + ambientColor(vec3f) + _pad + worldRadius(f32) + maxHeight(f32) + _pad(2) */
export const SCENE_PARAMS_SIZE = 96;

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

/** Default terrain texture resolution */
export const DEFAULT_TERRAIN_SIZE = 256;

/**
 * @typedef {Object} Buffers
 * @property {GPUBuffer} input
 * @property {GPUBuffer} camera
 * @property {GPUBuffer} ari
 * @property {GPUBuffer} fireflies
 * @property {GPUBuffer} game
 * @property {GPUBuffer} scene
 * @property {GPUBuffer} gameStaging
 * @property {GPUTexture} terrainTexture
 * @property {GPUTexture} slopeTexture
 * @property {GPUSampler} terrainSampler
 * @property {number} terrainSize
 */

/**
 * Create terrain GPU textures at the given resolution.
 * @param {GPUDevice} device
 * @param {number} size - Terrain texture width/height (must be square)
 * @returns {{ terrainTexture: GPUTexture, slopeTexture: GPUTexture, terrainSampler: GPUSampler, terrainSize: number }}
 */
export function createTerrainTextures(device, size) {
  const terrainTexture = device.createTexture({
    label: 'TerrainTexture',
    size: [size, size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const slopeTexture = device.createTexture({
    label: 'SlopeTexture',
    size: [size, size],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });

  const terrainSampler = device.createSampler({
    label: 'TerrainSampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  return { terrainTexture, slopeTexture, terrainSampler, terrainSize: size };
}

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

  // Terrain textures (default size, recreated on level load if needed)
  const terrain = createTerrainTextures(device, DEFAULT_TERRAIN_SIZE);

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

  // Fireflies: initialize all slots (unused entries parked underground)
  {
    const data = new ArrayBuffer(FIREFLY_ARRAY_SIZE);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const yardRadius = 12.0;
    for (let i = 0; i < MAX_FIREFLIES; i++) {
      const base = (i * FIREFLY_STRIDE) / 4; // f32 offset
      if (i < FIREFLY_COUNT) {
        // Active firefly — random position in yard
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * yardRadius;
        const px = Math.cos(angle) * dist;
        const pz = Math.sin(angle) * dist;
        const py = 0.5 + Math.random() * 2.0;
        f[base + 0] = px;
        f[base + 1] = py;
        f[base + 2] = pz;
        f[base + 3] = Math.random() * Math.PI * 2;
        f[base + 7] = 0.5 + Math.random() * 0.5;
        f[base + 8] = px;
        f[base + 9] = py;
        f[base + 10] = pz;
        u[base + 11] = 1;
      } else {
        // Inactive firefly — parked underground, invisible
        f[base + 0] = 0; f[base + 1] = -100; f[base + 2] = 0;
        f[base + 8] = 0; f[base + 9] = -100; f[base + 10] = 0;
        u[base + 11] = 0;
      }
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
    // moonColor (bright for contrast against dark)
    f[4] = 0.8; f[5] = 0.9; f[6] = 1.1; f[7] = 0.0;
    // houseLightPos
    f[8] = -8.0; f[9] = 3.0; f[10] = 8.0; f[11] = 0.0;
    // houseLightColor (warm amber) + fogDensity (low for clarity)
    f[12] = 1.0; f[13] = 0.7; f[14] = 0.3; f[15] = 0.02;
    // ambientColor (very minimal - let moonlight do the work)
    f[16] = 0.008; f[17] = 0.01; f[18] = 0.02; f[19] = 0.0;
    // worldRadius, maxHeight (defaults, overwritten by level load)
    f[20] = 15.0; f[21] = 5.0; f[22] = 0.0; f[23] = 0.0;
    device.queue.writeBuffer(scene, 0, data);
  }

  return { input, camera, ari, fireflies, game, scene, gameStaging, ...terrain };
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

// ── Level data reset ────────────────────────────────────────────────────────

/**
 * @typedef {Object} FireflyHome
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

/**
 * @typedef {Object} LevelBufferConfig
 * @property {{ radius: number, maxHeight: number }} world
 * @property {{ startPosition: [number, number, number] }} ari
 * @property {{ moon: { direction: [number, number, number], color: [number, number, number] }, houseLight: { position: [number, number, number], color: [number, number, number] } }} lights
 * @property {{ fogDensity: number, ambientColor: [number, number, number] }} scene
 * @property {{ initialDistance: number, initialPitch: number }} camera
 * @property {{ duration: number }} game
 */

/**
 * Reset all GPU buffer state from level data. Does not recreate buffers or pipelines.
 * @param {GPUDevice} device
 * @param {Buffers} buffers
 * @param {LevelBufferConfig} config
 * @param {FireflyHome[]} fireflyHomes
 * @param {ImageData} [terrainImageData]
 */
export function resetBuffersFromLevel(device, buffers, config, fireflyHomes, terrainImageData) {
  // Camera: behind and above Ari start position
  {
    const sp = config.ari.startPosition;
    const data = new ArrayBuffer(CAMERA_STATE_SIZE);
    const f = new Float32Array(data);
    f[0] = sp[0]; f[1] = sp[1] + 5.0; f[2] = sp[2] - 8.0; f[3] = 0.0;
    f[4] = sp[0]; f[5] = sp[1]; f[6] = sp[2]; f[7] = 0.0;
    f[8] = 0.0; // orbitYaw
    f[9] = config.camera.initialPitch;
    f[10] = config.camera.initialDistance;
    f[11] = 1.0; // fov
    device.queue.writeBuffer(buffers.camera, 0, data);
  }

  // Ari: at start position, facing +Z
  {
    const sp = config.ari.startPosition;
    const data = new ArrayBuffer(ARI_STATE_SIZE);
    const f = new Float32Array(data);
    f[0] = sp[0]; f[1] = sp[1]; f[2] = sp[2]; f[3] = 0.0; // forwardX = 0
    f[4] = 0.0; f[5] = 0.0; f[6] = 0.0; f[7] = 1.0; // forwardZ = 1
    f[8] = 0.0; // groundY
    new Uint32Array(data, 36, 1)[0] = POSE_IDLE;
    device.queue.writeBuffer(buffers.ari, 0, data);
  }

  // Fireflies: from spawn zone homes
  {
    const data = new ArrayBuffer(FIREFLY_ARRAY_SIZE);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const count = Math.min(fireflyHomes.length, MAX_FIREFLIES);
    for (let i = 0; i < MAX_FIREFLIES; i++) {
      const base = (i * FIREFLY_STRIDE) / 4;
      if (i < count) {
        const home = fireflyHomes[i];
        f[base + 0] = home.x;
        f[base + 1] = home.y;
        f[base + 2] = home.z;
        f[base + 3] = Math.random() * Math.PI * 2; // phase
        f[base + 7] = 0.5 + Math.random() * 0.5; // brightness
        f[base + 8] = home.x;
        f[base + 9] = home.y;
        f[base + 10] = home.z;
        u[base + 11] = 1; // alive
      } else {
        f[base + 1] = -100; f[base + 9] = -100; // underground
        u[base + 11] = 0;
      }
    }
    device.queue.writeBuffer(buffers.fireflies, 0, data);
  }

  // GameState: reset score, start playing
  {
    const data = new ArrayBuffer(GAME_STATE_SIZE);
    const u = new Uint32Array(data);
    const f = new Float32Array(data);
    u[0] = 0; // score
    u[1] = 0; // catchThisFrame
    u[2] = PHASE_PLAYING;
    f[3] = config.game.duration;
    device.queue.writeBuffer(buffers.game, 0, data);
  }

  // SceneParams: from level config
  {
    const data = new ArrayBuffer(SCENE_PARAMS_SIZE);
    const f = new Float32Array(data);
    const md = config.lights.moon.direction;
    const ml = Math.sqrt(md[0] * md[0] + md[1] * md[1] + md[2] * md[2]);
    f[0] = md[0] / ml; f[1] = md[1] / ml; f[2] = md[2] / ml; f[3] = 0.0;
    const mc = config.lights.moon.color;
    f[4] = mc[0]; f[5] = mc[1]; f[6] = mc[2]; f[7] = 0.0;
    const hp = config.lights.houseLight.position;
    f[8] = hp[0]; f[9] = hp[1]; f[10] = hp[2]; f[11] = 0.0;
    const hc = config.lights.houseLight.color;
    f[12] = hc[0]; f[13] = hc[1]; f[14] = hc[2];
    f[15] = config.scene.fogDensity;
    const ac = config.scene.ambientColor;
    f[16] = ac[0]; f[17] = ac[1]; f[18] = ac[2]; f[19] = 0.0;
    // World params
    f[20] = config.world.radius;
    f[21] = config.world.maxHeight;
    f[22] = 0.0; f[23] = 0.0;
    device.queue.writeBuffer(buffers.scene, 0, data);
  }

  // Terrain texture: upload from ImageData
  if (terrainImageData) {
    const size = terrainImageData.width;
    device.queue.writeTexture(
      { texture: buffers.terrainTexture },
      terrainImageData.data,
      { bytesPerRow: size * 4 },
      { width: size, height: size },
    );
  }
}
