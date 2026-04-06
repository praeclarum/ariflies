// Camera orbit compute shader
// Reads Input + Ari → writes Camera

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

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> ari: AriState;
@group(0) @binding(2) var<storage, read_write> camera: CameraState;

const MOUSE_SENSITIVITY: f32 = 0.003;
const PITCH_MIN: f32 = 0.1;
const PITCH_MAX: f32 = 1.4;
const CAMERA_DISTANCE: f32 = 10.0;
const CAMERA_HEIGHT_OFFSET: f32 = 1.5;
const CAMERA_SMOOTH: f32 = 5.0;

@compute @workgroup_size(1)
fn main() {
  let dt = input.dt;

  // Update orbit angles from mouse delta
  var yaw = camera.orbitYaw - input.mouseDeltaX * MOUSE_SENSITIVITY;
  var pitch = camera.orbitPitch + input.mouseDeltaY * MOUSE_SENSITIVITY;

  // Wrap yaw
  yaw = yaw % (2.0 * 3.14159265);

  // Clamp pitch
  pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);

  // Target point: Ari's position + slight upward offset
  let targetPos = ari.position + vec3f(0.0, CAMERA_HEIGHT_OFFSET, 0.0);

  // Compute desired eye position from orbit angles
  //
  // Coordinate system:
  //   - Y is up
  //   - yaw=0: camera at +Z looking toward -Z (into the scene)
  //   - yaw increases counterclockwise when viewed from above
  //   - pitch=0: camera at horizon level; pitch increases = camera higher
  //
  // Camera position = Ari + spherical offset
  let cosP = cos(pitch);
  let sinP = sin(pitch);
  let cosY = cos(yaw);
  let sinY = sin(yaw);

  let offset = vec3f(
    sinY * cosP * CAMERA_DISTANCE,
    sinP * CAMERA_DISTANCE,
    cosY * cosP * CAMERA_DISTANCE,
  );
  let desiredEye = targetPos + offset;

  // Smooth interpolation toward desired position
  let smoothFactor = 1.0 - exp(-CAMERA_SMOOTH * dt);
  let eye = mix(camera.eye, desiredEye, vec3f(smoothFactor));
  let lookAtPos = mix(camera.lookAt, targetPos, vec3f(smoothFactor));

  // Write updated camera state
  camera.eye = eye;
  camera.lookAt = lookAtPos;
  camera.orbitYaw = yaw;
  camera.orbitPitch = pitch;
  camera.dist = CAMERA_DISTANCE;
  camera.fov = 1.0; // ~60° half-angle tangent
}
