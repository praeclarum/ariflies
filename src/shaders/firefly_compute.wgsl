// Firefly simulation + catch detection compute shader
// Reads Input + Ari + Game → writes Fireflies + Game
// Shared structs are prepended at runtime from src/buffers.js.

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> ari: AriState;
@group(0) @binding(2) var<storage, read_write> fireflies: array<Firefly>;
@group(0) @binding(3) var<storage, read_write> game: GameStateAtomic;
@group(0) @binding(4) var<uniform> scene: SceneParams;
@group(0) @binding(5) var terrainTexture: texture_2d<f32>;
@group(0) @binding(6) var terrainSampler: sampler;

const FIREFLY_COUNT: u32 = 50u;
const CATCH_RADIUS: f32 = 1.5;
const POSE_JUMP: u32 = 4u;
const PHASE_PLAYING: u32 = 1u;

// Wander parameters
const WANDER_RADIUS: f32 = 2.0;
const WANDER_SPEED: f32 = 0.8;
const BOB_AMPLITUDE: f32 = 0.3;
const BOB_FREQ: f32 = 2.0;
const RETURN_STRENGTH: f32 = 0.5;
// Must match FIREFLY_RENDER_RADIUS in raymarch.wgsl.
const FIREFLY_RADIUS: f32 = 0.2;
const FIREFLY_GROUND_CLEARANCE: f32 = 0.05;
const MIN_ALTITUDE_BAND: f32 = 0.2;

fn worldToTerrainUV(worldXZ: vec2f) -> vec2f {
  return (worldXZ + vec2f(scene.worldRadius)) / (2.0 * scene.worldRadius);
}

fn terrainFade(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  let fromCenter = abs(uv - vec2f(0.5)) * 2.0;
  let edgeDist = max(fromCenter.x, fromCenter.y);
  let fadeWidth = clamp(scene.terrainFadeWidth, 0.001, 1.0);
  return 1.0 - smoothstep(1.0 - fadeWidth, 1.0, edgeDist);
}

fn getTerrainHeight(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  let h = textureSampleLevel(terrainTexture, terrainSampler, clampedUV, 0.0).r;
  return h * scene.maxHeight * terrainFade(worldXZ);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= FIREFLY_COUNT) { return; }

  var fly = fireflies[idx];
  if (fly.alive == 0u) { return; }

  let dt = input.dt;
  let time = input.time;
  let maxHeightAboveGround = max(ari.maxJumpHeight, FIREFLY_RADIUS + FIREFLY_GROUND_CLEARANCE + MIN_ALTITUDE_BAND);

  // Keep each home altitude valid over terrain changes before wandering from it.
  let homeGroundY = max(getTerrainHeight(fly.homePosition.xz), scene.waterLevel);
  let homeMinY = homeGroundY + FIREFLY_RADIUS + FIREFLY_GROUND_CLEARANCE;
  let homeMaxY = homeGroundY + maxHeightAboveGround;
  fly.homePosition.y = clamp(fly.homePosition.y, homeMinY, homeMaxY);

  // Stochastic wandering: orbit around home position
  let phaseOffset = fly.phase;
  let wanderAngle = time * WANDER_SPEED + phaseOffset;
  let wanderX = cos(wanderAngle + phaseOffset * 3.7) * WANDER_RADIUS;
  let wanderZ = sin(wanderAngle * 1.3 + phaseOffset * 2.1) * WANDER_RADIUS;
  let wanderY = sin(time * BOB_FREQ + phaseOffset * 5.3) * BOB_AMPLITUDE;

  var targetPos = fly.homePosition + vec3f(wanderX, wanderY, wanderZ);
  let targetGroundY = max(getTerrainHeight(targetPos.xz), scene.waterLevel);
  let targetMinY = targetGroundY + FIREFLY_RADIUS + FIREFLY_GROUND_CLEARANCE;
  let targetMaxY = targetGroundY + maxHeightAboveGround;
  targetPos.y = clamp(targetPos.y, targetMinY, targetMaxY);

  // Smooth movement toward target
  let toTarget = targetPos - fly.position;
  fly.velocity = fly.velocity + toTarget * RETURN_STRENGTH * dt * 10.0;
  fly.velocity = fly.velocity * (1.0 - 2.0 * dt); // damping
  fly.position = fly.position + fly.velocity * dt;

  // Never allow the firefly sphere to clip below ground, and keep it in Ari's reachable air band.
  let groundY = max(getTerrainHeight(fly.position.xz), scene.waterLevel);
  let minY = groundY + FIREFLY_RADIUS + FIREFLY_GROUND_CLEARANCE;
  let maxY = groundY + maxHeightAboveGround;
  let clampedY = clamp(fly.position.y, minY, maxY);
  if (clampedY <= minY + 0.0001 && fly.velocity.y < 0.0) {
    fly.velocity.y = 0.0;
  }
  if (clampedY >= maxY - 0.0001 && fly.velocity.y > 0.0) {
    fly.velocity.y = 0.0;
  }
  fly.position.y = clampedY;

  // Brightness oscillation (firefly blinking)
  fly.brightness = 0.5 + 0.5 * sin(time * 4.0 + phaseOffset * 6.28);

  // Catch detection: if game is playing and Ari is jumping near this firefly
  if (game.gamePhase == PHASE_PLAYING) {
    let toAri = fly.position - ari.position;
    let dist = length(toAri);
    if (dist < CATCH_RADIUS && ari.poseState == POSE_JUMP) {
      fly.alive = 0u;
      fly.brightness = 0.0;
      atomicAdd(&game.score, 1u);
      atomicAdd(&game.catchThisFrame, 1u);
    }
  }

  fireflies[idx] = fly;
}
