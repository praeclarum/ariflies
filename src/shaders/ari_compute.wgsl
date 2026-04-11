// Ari movement compute shader
// Reads Input + Camera → writes Ari

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
  analogX: f32,
  analogZ: f32,
  _pad3: f32,
};

struct CameraState {
  eye: vec3f,
  _pad0: f32,
  lookAt: vec3f,
  _pad1: f32,
  orbitYaw: f32,
  orbitPitch: f32,
  dist: f32,
  fov: f32,
};

struct AriState {
  position: vec3f,
  forwardX: f32,      // forward.x (Y is always 0)
  velocity: vec3f,
  forwardZ: f32,      // forward.z
  groundY: f32,
  poseState: u32,
  jumpT: f32,
  animPhase: f32,
  tailPhase: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

struct HouseLightData {
  positionIntensity: vec4f,
  colorAttenuation: vec4f,
  shadowParams: vec4f,
};

struct SceneParams {
  moonDir: vec4f,
  moonColor: vec4f,
  ambientColorFogDensity: vec4f,
  worldParams: vec4f,         // worldRadius, maxHeight, terrainFadeWidth, ambientStrength
  lightComposerParams: vec4f, // fogSkyScale, pointLightDiffuseScale, moonShadowK, moonShadowMaxDistance
  houseLights: array<HouseLightData, 10>,
};

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> camera: CameraState;
@group(0) @binding(2) var<storage, read_write> ari: AriState;
@group(0) @binding(3) var<uniform> scene: SceneParams;
@group(0) @binding(4) var terrainTexture: texture_2d<f32>;
@group(0) @binding(5) var terrainSampler: sampler;

// Key bit constants — must match JS
const KEY_W: u32     = 0x01u;
const KEY_A: u32     = 0x02u;
const KEY_S: u32     = 0x04u;
const KEY_D: u32     = 0x08u;
const KEY_SPACE: u32 = 0x10u;

// Pose constants
const POSE_IDLE: u32   = 0u;
const POSE_WALK: u32   = 1u;
const POSE_JUMP: u32   = 4u;
const POSE_LAND: u32   = 5u;

const MOVE_SPEED: f32 = 5.0;
const FRICTION: f32 = 8.0;
const JUMP_VELOCITY: f32 = 6.0;
const GRAVITY: f32 = 18.0;
const FORWARD_LERP: f32 = 15.0;

// Terrain height lookup using textureSampleLevel (available in compute)
fn worldToTerrainUV(worldXZ: vec2f) -> vec2f {
  let worldRadius = scene.worldParams.x;
  return (worldXZ + vec2f(worldRadius)) / (2.0 * worldRadius);
}

fn terrainFade(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  let fromCenter = abs(uv - vec2f(0.5)) * 2.0;
  let edgeDist = max(fromCenter.x, fromCenter.y);
  let fadeWidth = clamp(scene.worldParams.z, 0.001, 1.0);
  return 1.0 - smoothstep(1.0 - fadeWidth, 1.0, edgeDist);
}

fn getTerrainHeight(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  let h = textureSampleLevel(terrainTexture, terrainSampler, clampedUV, 0.0).r;
  return h * scene.worldParams.y * terrainFade(worldXZ);
}

@compute @workgroup_size(1)
fn main() {
  let dt = input.dt;
  let keys = input.keys;

  // Build movement direction in camera-relative space
  // moveX: +1 = right, -1 = left
  // moveZ: +1 = forward (into scene), -1 = backward
  var inputX: f32 = 0.0;
  var inputZ: f32 = 0.0;
  if ((keys & KEY_W) != 0u) { inputZ += 1.0; }
  if ((keys & KEY_S) != 0u) { inputZ -= 1.0; }
  if ((keys & KEY_A) != 0u) { inputX -= 1.0; }
  if ((keys & KEY_D) != 0u) { inputX += 1.0; }

  // Add analog touch input (virtual trackpad on mobile)
  inputX += input.analogX;
  inputZ += input.analogZ;

  // Get camera basis vectors from eye/lookAt
  // Forward: direction camera is looking (XZ plane, normalized)
  // Right: forward × up = (fx,0,fz) × (0,1,0) = (-fz, 0, fx)
  let camFwd3 = camera.lookAt - camera.eye;
  let camFwd = normalize(vec2f(camFwd3.x, camFwd3.z));
  let camRight = vec2f(-camFwd.y, camFwd.x);  // (-fz, fx)

  // World movement = inputX * right + inputZ * forward
  var moveDir = inputX * camRight + inputZ * camFwd;
  let moveMag = length(moveDir);
  if (moveMag > 0.001) {
    moveDir = moveDir / moveMag;
  }

  // Horizontal velocity
  var vel = ari.velocity;
  let targetVelXZ = moveDir * MOVE_SPEED;
  vel.x = vel.x + (targetVelXZ.x - vel.x) * min(1.0, FRICTION * dt);
  vel.z = vel.z + (targetVelXZ.y - vel.z) * min(1.0, FRICTION * dt);

  // Vertical: jump / gravity
  var pos = ari.position;
  var jumpT = ari.jumpT;
  var poseState = ari.poseState;
  let groundY = getTerrainHeight(pos.xz);

  let isOnGround = pos.y <= groundY + 0.01;

  if ((keys & KEY_SPACE) != 0u && isOnGround && poseState != POSE_JUMP) {
    vel.y = JUMP_VELOCITY;
    poseState = POSE_JUMP;
    jumpT = 0.0;
  }

  if (!isOnGround || poseState == POSE_JUMP) {
    vel.y = vel.y - GRAVITY * dt;
    jumpT = jumpT + dt;
  }

  // Integrate position
  pos = pos + vel * dt;

  // Ground collision
  if (pos.y < groundY) {
    pos.y = groundY;
    vel.y = 0.0;
    if (poseState == POSE_JUMP) {
      poseState = POSE_LAND;
      jumpT = 0.0;
    }
  }

  // Clamp to world bounds (soft circle)
  let distXZ = length(pos.xz);
  let worldRadius = scene.worldParams.x;
  if (distXZ > worldRadius) {
    pos.x = pos.x * (worldRadius / distXZ);
    pos.z = pos.z * (worldRadius / distXZ);
  }

  // Update forward direction toward actual movement direction (velocity), not input
  // This ensures the cat faces where it's actually going, no lag
  var forward = vec2f(ari.forwardX, ari.forwardZ);
  let speed = length(vel.xz);
  if (speed > 0.5) {
    // Face the direction we're actually moving
    let velDir = vec2f(vel.x, vel.z) / speed;
    let lerpT = min(1.0, FORWARD_LERP * dt);
    forward = normalize(mix(forward, velDir, vec2f(lerpT)));
  }

  // Update animation phase
  var animPhase = ari.animPhase;
  animPhase = animPhase + speed * dt * 2.0;

  var tailPhase = ari.tailPhase;
  tailPhase = tailPhase + dt * 3.0;

  // Determine pose
  if (poseState == POSE_LAND) {
    jumpT = jumpT + dt;
    if (jumpT > 0.15) {
      poseState = POSE_IDLE;
    }
  }
  if (poseState != POSE_JUMP && poseState != POSE_LAND) {
    if (speed > 0.5) {
      poseState = POSE_WALK;
    } else {
      poseState = POSE_IDLE;
    }
  }

  // Write back
  ari.position = pos;
  ari.forwardX = forward.x;
  ari.forwardZ = forward.y;  // Note: forward is vec2f(worldX, worldZ)
  ari.velocity = vel;
  ari.groundY = groundY;
  ari.poseState = poseState;
  ari.jumpT = jumpT;
  ari.animPhase = animPhase;
  ari.tailPhase = tailPhase;
}
