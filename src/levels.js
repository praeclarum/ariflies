// @ts-check

/**
 * @fileoverview Level loading, terrain texture management, and spawn zone expansion.
 * Levels are stored as file pairs: levels/{id}.png (terrain) + levels/{id}.json (metadata).
 */

// ── Material ID constants (must match terrain texture G channel encoding) ───

export const MAT_GRASS    = 0;
export const MAT_PUDDLE   = 64;
export const MAT_WOOD     = 128;
export const MAT_CONCRETE = 192;

/** Terrain texture resolution */
export const TERRAIN_SIZE = 256;

/** Maximum number of fireflies supported (buffer pre-allocated to this) */
export const MAX_FIREFLIES = 200;

/** Maximum number of editable house lights supported per level */
export const MAX_HOUSE_LIGHTS = 10;

// ── Level JSON schema types ─────────────────────────────────────────────────

/**
 * @typedef {Object} FireflyZone
 * @property {[number, number, number]} center
 * @property {number} radius
 * @property {number} count
 * @property {number} minHeight
 * @property {number} maxHeight
 */

/**
 * @typedef {Object} WaterConfig
 * @property {number} level
 * @property {[number, number, number]} color
 * @property {[number, number, number]} extinction
 * @property {number} ior
 * @property {number} fresnelPower
 * @property {number} roughness
 * @property {number} reflectionStrength
 * @property {number} refractionStrength
 * @property {number} waveAmplitude
 * @property {number} waveFrequency
 * @property {number} waveSpeed
 * @property {number} waveChoppiness
 * @property {number} normalStrength
 * @property {number} clarity
 */

/**
 * @typedef {Object} HouseLightConfig
 * @property {[number, number, number]} position
 * @property {[number, number, number]} color
 * @property {number} intensity
 * @property {number} attenuation
 * @property {number} shadowK
 * @property {number} shadowMaxDistance
 */

/**
 * @typedef {Object} LevelConfig
 * @property {string} name
 * @property {number} version
 * @property {{ radius: number, maxHeight: number, water: WaterConfig }} world
 * @property {{ startPosition: [number, number, number] }} ari
 * @property {FireflyZone[]} fireflyZones
 * @property {{ moon: { direction: [number, number, number], color: [number, number, number] }, moonShadowK: number, moonShadowMaxDistance: number, houseLights: HouseLightConfig[] }} lights
 * @property {{ fogDensity: number, ambientColor: [number, number, number], terrainFadeWidth: number, ambientStrength: number, fogSkyScale: number, pointLightDiffuseScale: number }} scene
 * @property {{ initialDistance: number, initialPitch: number }} camera
 * @property {{ duration: number }} game
 */

/**
 * @typedef {Object} LevelData
 * @property {LevelConfig} config
 * @property {ImageData} terrainImageData
 */

/**
 * @typedef {Object} FireflyHome
 * @property {number} x
 * @property {number} y
 * @property {number} z
 */

// ── Default level (matches current hardcoded behavior) ──────────────────────

/**
 * Returns a default level configuration matching the original hardcoded values.
 * @returns {LevelConfig}
 */
export function defaultLevelConfig() {
  return {
    name: 'Backyard',
    version: 1,
    world: {
      radius: 15.0,
      maxHeight: 5.0,
      water: {
        level: 0.75,
        color: [0.06, 0.2, 0.28],
        extinction: [0.25, 0.11, 0.05],
        ior: 1.333,
        fresnelPower: 5.0,
        roughness: 0.08,
        reflectionStrength: 1.0,
        refractionStrength: 0.9,
        waveAmplitude: 0.06,
        waveFrequency: 0.95,
        waveSpeed: 0.45,
        waveChoppiness: 0.75,
        normalStrength: 0.8,
        clarity: 0.78,
      },
    },
    ari: { startPosition: [0, 0, 0] },
    fireflyZones: [
      { center: [0, 1.5, 0], radius: 12.0, count: 50, minHeight: 0.5, maxHeight: 2.5 },
    ],
    lights: {
      moon: { direction: [0.4, 0.35, 0.6], color: [0.8, 0.9, 1.1] },
      moonShadowK: 5.5,
      moonShadowMaxDistance: 40.0,
      houseLights: [
        {
          position: [-8, 3, 8],
          color: [1.0, 0.7, 0.3],
          intensity: 1.0,
          attenuation: 0.02,
          shadowK: 3.5,
          shadowMaxDistance: 45.0,
        },
      ],
    },
    scene: {
      fogDensity: 0.02,
      ambientColor: [0.008, 0.01, 0.02],
      terrainFadeWidth: 0.1,
      ambientStrength: 0.15,
      fogSkyScale: 1.2,
      pointLightDiffuseScale: 0.5,
    },
    camera: { initialDistance: 10.0, initialPitch: 0.6 },
    game: { duration: 120 },
  };
}

/**
 * Returns a flat grass terrain (all zeros = height 0, material grass).
 * @returns {ImageData}
 */
export function defaultTerrainImageData() {
  const img = new ImageData(TERRAIN_SIZE, TERRAIN_SIZE);
  // R=0 (height=0), G=0 (grass), B=0 (no detail), A=255
  for (let i = 0; i < TERRAIN_SIZE * TERRAIN_SIZE; i++) {
    img.data[i * 4 + 3] = 255; // alpha
  }
  return img;
}

/**
 * Returns a full default LevelData.
 * @returns {LevelData}
 */
export function defaultLevel() {
  return {
    config: defaultLevelConfig(),
    terrainImageData: defaultTerrainImageData(),
  };
}

// ── Level loading ───────────────────────────────────────────────────────────

/**
 * Load a level from the levels/ directory.
 * @param {string} levelId - e.g. 'level0'
 * @returns {Promise<LevelData>}
 */
export async function loadLevel(levelId) {
  const [config, terrainImageData] = await Promise.all([
    loadLevelJSON(levelId),
    loadTerrainImage(levelId),
  ]);
  return { config, terrainImageData };
}

/**
 * Load and parse a level JSON file.
 * @param {string} levelId
 * @returns {Promise<LevelConfig>}
 */
async function loadLevelJSON(levelId) {
  const resp = await fetch(`levels/${levelId}.json`);
  if (!resp.ok) {
    console.warn(`Failed to load levels/${levelId}.json (${resp.status}), using defaults`);
    return defaultLevelConfig();
  }
  const json = await resp.json();
  return parseLevelConfig(json);
}

/**
 * Load a terrain PNG and extract its ImageData.
 * @param {string} levelId
 * @returns {Promise<ImageData>}
 */
async function loadTerrainImage(levelId) {
  try {
    const resp = await fetch(`levels/${levelId}.png`);
    if (!resp.ok) {
      console.warn(`Failed to load levels/${levelId}.png (${resp.status}), using flat terrain`);
      return defaultTerrainImageData();
    }
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const size = bitmap.width; // terrain textures must be square
    const canvas = new OffscreenCanvas(size, size);
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    if (!ctx) throw new Error('Failed to get 2d context');
    ctx.drawImage(bitmap, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  } catch (e) {
    console.warn(`Error loading terrain image for ${levelId}:`, e);
    return defaultTerrainImageData();
  }
}

// ── Level config parsing / validation ───────────────────────────────────────

/**
 * Parse and validate level JSON, filling in defaults for missing fields.
 * @param {any} json
 * @returns {LevelConfig}
 */
export function parseLevelConfig(json) {
  const defaults = defaultLevelConfig();
  const fallbackLight = defaults.lights.houseLights[0];
  const rawHouseLights = Array.isArray(json.lights?.houseLights)
    ? /** @type {any[]} */ (json.lights.houseLights)
    : null;

  /** @type {HouseLightConfig[]} */
  const parsedHouseLights = rawHouseLights
    ? rawHouseLights
      .slice(0, MAX_HOUSE_LIGHTS)
      .map((light, index) => parseHouseLight(light, defaults.lights.houseLights[index] ?? fallbackLight))
    : defaults.lights.houseLights.map((light) => ({ ...light }));

  return {
    name: typeof json.name === 'string' ? json.name : defaults.name,
    version: typeof json.version === 'number' ? json.version : defaults.version,
    world: {
      radius: json.world?.radius ?? defaults.world.radius,
      maxHeight: json.world?.maxHeight ?? defaults.world.maxHeight,
      water: parseWaterConfig(json.world?.water, defaults.world.water),
    },
    ari: {
      startPosition: Array.isArray(json.ari?.startPosition) && json.ari.startPosition.length === 3
        ? json.ari.startPosition
        : defaults.ari.startPosition,
    },
    fireflyZones: Array.isArray(json.fireflyZones)
      ? json.fireflyZones.map(parseFireflyZone)
      : defaults.fireflyZones,
    lights: {
      moon: {
        direction: parseVec3(json.lights?.moon?.direction, defaults.lights.moon.direction),
        color: parseColor(json.lights?.moon?.color, defaults.lights.moon.color),
      },
      moonShadowK: parseNumber(json.lights?.moonShadowK, defaults.lights.moonShadowK, 0.1, 16.0),
      moonShadowMaxDistance: parseNumber(json.lights?.moonShadowMaxDistance, defaults.lights.moonShadowMaxDistance, 1.0, 200.0),
      houseLights: parsedHouseLights.length > 0
        ? parsedHouseLights
        : defaults.lights.houseLights.map((light) => ({ ...light })),
    },
    scene: {
      fogDensity: parseNumber(json.scene?.fogDensity, defaults.scene.fogDensity, 0.0, 2.0),
      ambientColor: parseColor(json.scene?.ambientColor, defaults.scene.ambientColor),
      terrainFadeWidth: parseNumber(json.scene?.terrainFadeWidth, defaults.scene.terrainFadeWidth, 0.001, 1.0),
      ambientStrength: parseNumber(json.scene?.ambientStrength, defaults.scene.ambientStrength, 0.0, 2.0),
      fogSkyScale: parseNumber(json.scene?.fogSkyScale, defaults.scene.fogSkyScale, 0.0, 4.0),
      pointLightDiffuseScale: parseNumber(
        json.scene?.pointLightDiffuseScale,
        defaults.scene.pointLightDiffuseScale,
        0.0,
        4.0,
      ),
    },
    camera: {
      initialDistance: json.camera?.initialDistance ?? defaults.camera.initialDistance,
      initialPitch: json.camera?.initialPitch ?? defaults.camera.initialPitch,
    },
    game: {
      duration: json.game?.duration ?? defaults.game.duration,
    },
  };
}

/**
 * @param {any} water
 * @param {WaterConfig} fallback
 * @returns {WaterConfig}
 */
function parseWaterConfig(water, fallback) {
  return {
    level: parseNumber(water?.level, fallback.level, 0.0001, 100.0),
    color: parseColor(water?.color, fallback.color),
    extinction: parseColor(water?.extinction, fallback.extinction),
    ior: parseNumber(water?.ior, fallback.ior, 1.0, 2.0),
    fresnelPower: parseNumber(water?.fresnelPower, fallback.fresnelPower, 0.5, 16.0),
    roughness: parseNumber(water?.roughness, fallback.roughness, 0.0, 1.0),
    reflectionStrength: parseNumber(water?.reflectionStrength, fallback.reflectionStrength, 0.0, 2.0),
    refractionStrength: parseNumber(water?.refractionStrength, fallback.refractionStrength, 0.0, 2.0),
    waveAmplitude: parseNumber(water?.waveAmplitude, fallback.waveAmplitude, 0.0, 2.0),
    waveFrequency: parseNumber(water?.waveFrequency, fallback.waveFrequency, 0.0, 32.0),
    waveSpeed: parseNumber(water?.waveSpeed, fallback.waveSpeed, 0.0, 16.0),
    waveChoppiness: parseNumber(water?.waveChoppiness, fallback.waveChoppiness, 0.0, 4.0),
    normalStrength: parseNumber(water?.normalStrength, fallback.normalStrength, 0.0, 4.0),
    clarity: parseNumber(water?.clarity, fallback.clarity, 0.0, 1.0),
  };
}

/**
 * @param {unknown} value
 * @param {[number, number, number]} fallback
 * @returns {[number, number, number]}
 */
function parseVec3(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  return [x, y, z];
}

/**
 * @param {unknown} value
 * @param {[number, number, number]} fallback
 * @returns {[number, number, number]}
 */
function parseColor(value, fallback) {
  const v = parseVec3(value, fallback);
  return [Math.max(0.0, v[0]), Math.max(0.0, v[1]), Math.max(0.0, v[2])];
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function parseNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {any} light
 * @param {HouseLightConfig} fallback
 * @returns {HouseLightConfig}
 */
function parseHouseLight(light, fallback) {
  return {
    position: parseVec3(light?.position, fallback.position),
    color: parseColor(light?.color, fallback.color),
    intensity: parseNumber(light?.intensity, fallback.intensity, 0.0, 32.0),
    attenuation: parseNumber(light?.attenuation, fallback.attenuation, 0.0001, 4.0),
    shadowK: parseNumber(light?.shadowK, fallback.shadowK, 0.1, 16.0),
    shadowMaxDistance: parseNumber(light?.shadowMaxDistance, fallback.shadowMaxDistance, 1.0, 200.0),
  };
}

/**
 * Parse a single firefly zone entry.
 * @param {any} z
 * @returns {FireflyZone}
 */
function parseFireflyZone(z) {
  return {
    center: Array.isArray(z.center) && z.center.length === 3 ? z.center : [0, 1.5, 0],
    radius: typeof z.radius === 'number' ? z.radius : 5.0,
    count: typeof z.count === 'number' ? Math.min(z.count, MAX_FIREFLIES) : 10,
    minHeight: typeof z.minHeight === 'number' ? z.minHeight : 0.5,
    maxHeight: typeof z.maxHeight === 'number' ? z.maxHeight : 2.5,
  };
}

// ── Firefly spawn zone expansion ────────────────────────────────────────────

/**
 * Expand firefly zones into individual home positions.
 * @param {FireflyZone[]} zones
 * @returns {FireflyHome[]}
 */
export function spawnFirefliesFromZones(zones) {
  /** @type {FireflyHome[]} */
  const homes = [];

  for (const zone of zones) {
    for (let i = 0; i < zone.count && homes.length < MAX_FIREFLIES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * zone.radius;
      homes.push({
        x: zone.center[0] + Math.cos(angle) * dist,
        y: zone.minHeight + Math.random() * (zone.maxHeight - zone.minHeight),
        z: zone.center[2] + Math.sin(angle) * dist,
      });
    }
  }

  return homes;
}

// ── Terrain data helpers ────────────────────────────────────────────────────

/**
 * Get the terrain height at a pixel coordinate.
 * @param {ImageData} terrain
 * @param {number} px - pixel X (0–255)
 * @param {number} py - pixel Y (0–255)
 * @returns {number} raw height value 0–255
 */
export function getTerrainHeight(terrain, px, py) {
  const x = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.round(px)));
  const y = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.round(py)));
  return terrain.data[(y * TERRAIN_SIZE + x) * 4];
}

/**
 * Get the material ID at a pixel coordinate.
 * @param {ImageData} terrain
 * @param {number} px
 * @param {number} py
 * @returns {number} material ID (0, 64, 128, or 192)
 */
export function getTerrainMaterial(terrain, px, py) {
  const x = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.round(px)));
  const y = Math.max(0, Math.min(TERRAIN_SIZE - 1, Math.round(py)));
  return terrain.data[(y * TERRAIN_SIZE + x) * 4 + 1];
}

/**
 * Convert world XZ coordinates to terrain pixel coordinates.
 * @param {number} worldX
 * @param {number} worldZ
 * @param {number} worldRadius
 * @returns {[number, number]} pixel [x, y]
 */
export function worldToPixel(worldX, worldZ, worldRadius) {
  const px = ((worldX + worldRadius) / (2 * worldRadius)) * (TERRAIN_SIZE - 1);
  const py = ((worldZ + worldRadius) / (2 * worldRadius)) * (TERRAIN_SIZE - 1);
  return [px, py];
}

/**
 * Convert terrain pixel coordinates to world XZ.
 * @param {number} px
 * @param {number} py
 * @param {number} worldRadius
 * @returns {[number, number]} [worldX, worldZ]
 */
export function pixelToWorld(px, py, worldRadius) {
  const worldX = (px / (TERRAIN_SIZE - 1)) * (2 * worldRadius) - worldRadius;
  const worldZ = (py / (TERRAIN_SIZE - 1)) * (2 * worldRadius) - worldRadius;
  return [worldX, worldZ];
}

/**
 * Encode terrain ImageData as a PNG Blob (for saving).
 * @param {ImageData} imageData
 * @returns {Promise<Blob>}
 */
export async function terrainToBlob(imageData) {
  const canvas = new OffscreenCanvas(TERRAIN_SIZE, TERRAIN_SIZE);
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
  if (!ctx) throw new Error('Failed to get 2d context');
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
