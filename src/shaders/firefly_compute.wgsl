// Firefly simulation + catch detection compute shader
// Reads Input + Ari + Game → writes Fireflies + Game

struct InputUniforms {
  keys: u32,
  mouseButtons: u32,
  mouseDeltaX: f32,
  mouseDeltaY: f32,
  dt: f32,
  time: f32,
  resolutionX: f32,
  resolutionY: f32,
  renderScale: f32,
  _pad: f32,
  _pad2: f32,
  _pad3: f32,
};

struct AriState {
  position: vec3f,
  facing: f32,
  velocity: vec3f,
  speed: f32,
  groundY: f32,
  poseState: u32,
  jumpT: f32,
  animPhase: f32,
  tailPhase: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

struct Firefly {
  position: vec3f,
  phase: f32,
  velocity: vec3f,
  brightness: f32,
  homePosition: vec3f,
  alive: u32,
};

struct GameState {
  score: atomic<u32>,
  catchThisFrame: atomic<u32>,
  gamePhase: u32,
  timeRemaining: f32,
};

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> ari: AriState;
@group(0) @binding(2) var<storage, read_write> fireflies: array<Firefly>;
@group(0) @binding(3) var<storage, read_write> game: GameState;

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

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= FIREFLY_COUNT) { return; }

  var fly = fireflies[idx];
  if (fly.alive == 0u) { return; }

  let dt = input.dt;
  let time = input.time;

  // Stochastic wandering: orbit around home position
  let phaseOffset = fly.phase;
  let wanderAngle = time * WANDER_SPEED + phaseOffset;
  let wanderX = cos(wanderAngle + phaseOffset * 3.7) * WANDER_RADIUS;
  let wanderZ = sin(wanderAngle * 1.3 + phaseOffset * 2.1) * WANDER_RADIUS;
  let wanderY = sin(time * BOB_FREQ + phaseOffset * 5.3) * BOB_AMPLITUDE;

  let targetPos = fly.homePosition + vec3f(wanderX, wanderY, wanderZ);

  // Smooth movement toward target
  let toTarget = targetPos - fly.position;
  fly.velocity = fly.velocity + toTarget * RETURN_STRENGTH * dt * 10.0;
  fly.velocity = fly.velocity * (1.0 - 2.0 * dt); // damping
  fly.position = fly.position + fly.velocity * dt;

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
