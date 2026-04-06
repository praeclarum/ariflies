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
  _pad: f32,
  _pad2: f32,
  _pad3: f32,
};

struct CameraState {
  eye: vec3f,
  _pad0: f32,
  target: vec3f,
  _pad1: f32,
  orbitYaw: f32,
  orbitPitch: f32,
  distance: f32,
  fov: f32,
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

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> camera: CameraState;
@group(0) @binding(2) var<storage, read_write> ari: AriState;

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
const FACING_LERP: f32 = 10.0;
const WORLD_RADIUS: f32 = 15.0;

@compute @workgroup_size(1)
fn main() {
  let dt = input.dt;
  let keys = input.keys;

  // Build movement direction in camera-relative space
  var moveX: f32 = 0.0;
  var moveZ: f32 = 0.0;
  if ((keys & KEY_W) != 0u) { moveZ += 1.0; }
  if ((keys & KEY_S) != 0u) { moveZ -= 1.0; }
  if ((keys & KEY_A) != 0u) { moveX -= 1.0; }
  if ((keys & KEY_D) != 0u) { moveX += 1.0; }

  // Transform to world space using camera yaw
  let yaw = camera.orbitYaw;
  let cosY = cos(yaw);
  let sinY = sin(yaw);
  // Camera forward is -Z in orbit convention, so forward relative to camera:
  let worldMoveX = moveX * cosY - moveZ * sinY;
  let worldMoveZ = moveX * sinY + moveZ * cosY;

  var moveDir = vec2f(worldMoveX, worldMoveZ);
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
  let groundY: f32 = 0.0; // flat terrain for now

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
  if (distXZ > WORLD_RADIUS) {
    pos.x = pos.x * (WORLD_RADIUS / distXZ);
    pos.z = pos.z * (WORLD_RADIUS / distXZ);
  }

  // Update facing direction toward movement
  var facing = ari.facing;
  if (moveMag > 0.1) {
    let targetFacing = atan2(moveDir.x, moveDir.y);
    // Lerp angle (handle wrapping)
    var diff = targetFacing - facing;
    if (diff > 3.14159265) { diff -= 6.28318530; }
    if (diff < -3.14159265) { diff += 6.28318530; }
    facing = facing + diff * min(1.0, FACING_LERP * dt);
  }

  // Update animation phase
  let speed = length(vel.xz);
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
  ari.facing = facing;
  ari.velocity = vel;
  ari.speed = speed;
  ari.groundY = groundY;
  ari.poseState = poseState;
  ari.jumpT = jumpT;
  ari.animPhase = animPhase;
  ari.tailPhase = tailPhase;
}
