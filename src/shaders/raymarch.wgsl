// Fullscreen ray march shader
// Vertex: fullscreen triangle from vertex_index
// Fragment: ray march SDF scene with moonlit atmosphere
//
// Coordinate System:
//   - Y is up
//   - Camera at yaw=0 is at +Z looking toward -Z (into the scene)
//   - Ari at facing=0 looks toward +Z; facing=π looks toward -Z
//   - Moon direction is typically (-0.3, 0.8, -0.5) — upper left, slightly behind camera

// ── Shared struct definitions (must match JS/compute layouts) ────────────

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
  lookAt: vec3f,
  _pad1: f32,
  orbitYaw: f32,
  orbitPitch: f32,
  dist: f32,
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

struct Firefly {
  position: vec3f,
  phase: f32,
  velocity: vec3f,
  brightness: f32,
  homePosition: vec3f,
  alive: u32,
};

struct GameState {
  score: u32,
  catchThisFrame: u32,
  gamePhase: u32,
  timeRemaining: f32,
};

struct SceneParams {
  moonDir: vec3f,
  _pad0: f32,
  moonColor: vec3f,
  _pad1: f32,
  houseLightPos: vec3f,
  _pad2: f32,
  houseLightColor: vec3f,
  fogDensity: f32,
  ambientColor: vec3f,
  _pad3: f32,
};

// ── Bindings ─────────────────────────────────────────────────────────────

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> camera: CameraState;
@group(0) @binding(2) var<storage, read> ari: AriState;
@group(0) @binding(3) var<storage, read> fireflies: array<Firefly>;
@group(0) @binding(4) var<storage, read> game: GameState;
@group(0) @binding(5) var<uniform> scene: SceneParams;

// ── Vertex shader: fullscreen triangle ───────────────────────────────────

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // Single oversized triangle covering the full screen
  var out: VSOut;
  let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
  let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  // UV: 0..1 range for the visible portion
  out.uv = vec2f(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
  return out;
}

// ── SDF primitives ───────────────────────────────────────────────────────

fn sdSphere(p: vec3f, r: f32) -> f32 {
  return length(p) - r;
}

fn sdPlane(p: vec3f, n: vec3f, h: f32) -> f32 {
  return dot(p, n) + h;
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
  let ab = b - a;
  let ap = p - a;
  let t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - (a + t * ab)) - r;
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// ── Ari SDF (placeholder: sphere body + head) ───────────────────────────

fn sdAri(p: vec3f) -> f32 {
  let ap = p - ari.position;
  let cosF = cos(ari.facing);
  let sinF = sin(ari.facing);
  // Rotate into Ari's local space
  let lp = vec3f(
    ap.x * cosF + ap.z * sinF,
    ap.y,
    -ap.x * sinF + ap.z * cosF,
  );

  // Body bob based on animation
  let bob = sin(ari.animPhase * 2.0) * 0.05;

  // Body: elongated sphere
  let bodyP = lp - vec3f(0.0, 0.5 + bob, 0.0);
  let body = length(bodyP / vec3f(1.0, 0.7, 1.3)) * 0.7 - 0.4;

  // Head
  let headP = lp - vec3f(0.0, 0.9 + bob, 0.55);
  let head = sdSphere(headP, 0.3);

  // Ears
  let earL = lp - vec3f(-0.15, 1.2 + bob, 0.6);
  let earR = lp - vec3f(0.15, 1.2 + bob, 0.6);
  let ears = min(
    length(earL / vec3f(0.6, 1.0, 0.6)) - 0.12,
    length(earR / vec3f(0.6, 1.0, 0.6)) - 0.12,
  );

  // Tail: curved away from facing
  let tailSwing = sin(ari.tailPhase) * 0.4;
  let tailBase = lp - vec3f(tailSwing * 0.3, 0.6, -0.7);
  let tailTip = lp - vec3f(tailSwing, 0.9, -1.2);
  let tail = sdCapsule(lp, vec3f(0.0, 0.6 + bob, -0.55), vec3f(tailSwing, 0.8 + bob, -1.1), 0.06);

  // Legs (simplified)
  let legFL = sdCapsule(lp, vec3f(-0.2, 0.0, 0.3), vec3f(-0.2, 0.5 + bob, 0.3), 0.08);
  let legFR = sdCapsule(lp, vec3f(0.2, 0.0, 0.3), vec3f(0.2, 0.5 + bob, 0.3), 0.08);
  let legBL = sdCapsule(lp, vec3f(-0.2, 0.0, -0.3), vec3f(-0.2, 0.5 + bob, -0.3), 0.08);
  let legBR = sdCapsule(lp, vec3f(0.2, 0.0, -0.3), vec3f(0.2, 0.5 + bob, -0.3), 0.08);
  let legs = min(min(legFL, legFR), min(legBL, legBR));

  // Smooth blend everything
  var d = smin(body, head, 0.15);
  d = smin(d, ears, 0.08);
  d = smin(d, tail, 0.1);
  d = smin(d, legs, 0.1);

  return d;
}

// ── Scene SDF ────────────────────────────────────────────────────────────

const FIREFLY_COUNT: u32 = 50u;

struct HitInfo {
  dist: f32,
  materialId: u32, // 0=ground, 1=ari, 2=sky
};

fn sceneSDF(p: vec3f) -> HitInfo {
  // Ground plane at y=0
  let ground = p.y;

  // Ari
  let ariDist = sdAri(p);

  var hit: HitInfo;
  if (ariDist < ground) {
    hit.dist = ariDist;
    hit.materialId = 1u;
  } else {
    hit.dist = ground;
    hit.materialId = 0u;
  }

  return hit;
}

fn sceneNormal(p: vec3f) -> vec3f {
  let e = 0.001;
  let d = sceneSDF(p).dist;
  return normalize(vec3f(
    sceneSDF(p + vec3f(e, 0.0, 0.0)).dist - d,
    sceneSDF(p + vec3f(0.0, e, 0.0)).dist - d,
    sceneSDF(p + vec3f(0.0, 0.0, e)).dist - d,
  ));
}

// ── Ray marching ─────────────────────────────────────────────────────────

const MAX_STEPS: i32 = 80;
const MAX_DIST: f32 = 80.0;
const SURFACE_DIST: f32 = 0.005;

struct RayResult {
  dist: f32,
  totalDist: f32,
  materialId: u32,
  hit: bool,
};

fn rayMarch(ro: vec3f, rd: vec3f) -> RayResult {
  var result: RayResult;
  result.totalDist = 0.0;
  result.hit = false;
  result.materialId = 2u; // sky by default

  for (var i = 0; i < MAX_STEPS; i++) {
    let p = ro + rd * result.totalDist;
    let hit = sceneSDF(p);
    result.dist = hit.dist;

    if (hit.dist < SURFACE_DIST) {
      result.hit = true;
      result.materialId = hit.materialId;
      break;
    }
    result.totalDist += hit.dist;
    if (result.totalDist > MAX_DIST) { break; }
  }

  return result;
}

// ── Sky and moon ─────────────────────────────────────────────────────────

fn skyColor(rd: vec3f) -> vec3f {
  // Night sky gradient - brightened for debugging
  let skyUp = vec3f(0.05, 0.05, 0.15);
  let skyHorizon = vec3f(0.08, 0.1, 0.2);
  let t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  var sky = mix(skyHorizon, skyUp, t);

  // Moon
  let moonDir = normalize(scene.moonDir);
  let moonDot = dot(rd, moonDir);

  // Moon disk
  if (moonDot > 0.999) {
    sky = vec3f(0.95, 0.93, 0.85);
  }
  // Moon glow
  let moonGlow = pow(max(moonDot, 0.0), 256.0) * 0.5;
  sky += scene.moonColor * moonGlow;

  // Broader halo
  let halo = pow(max(moonDot, 0.0), 16.0) * 0.08;
  sky += scene.moonColor * halo;

  return sky;
}

// ── Fog ──────────────────────────────────────────────────────────────────

fn applyFog(color: vec3f, dist: f32, rd: vec3f) -> vec3f {
  let fogAmount = 1.0 - exp(-dist * scene.fogDensity);
  let fogColor = skyColor(rd) * 1.5 + scene.ambientColor;
  return mix(color, fogColor, fogAmount);
}

// ── Lighting ─────────────────────────────────────────────────────────────

fn shade(p: vec3f, normal: vec3f, materialId: u32) -> vec3f {
  var color: vec3f;

  if (materialId == 0u) {
    // Ground: grass-like dark green
    color = vec3f(0.02, 0.05, 0.01);
  } else if (materialId == 1u) {
    // Ari: very dark (black cat)
    color = vec3f(0.02, 0.02, 0.03);
  } else {
    color = vec3f(0.0, 0.0, 0.0);
  }

  let moonDir = normalize(scene.moonDir);

  // Moonlight diffuse
  let moonDiffuse = max(dot(normal, moonDir), 0.0);
  color += color * scene.moonColor * moonDiffuse * 1.5;

  // Ambient
  color += scene.ambientColor * 0.3;

  // House light (point light)
  let toLight = scene.houseLightPos - p;
  let lightDist = length(toLight);
  let lightDir = toLight / lightDist;
  let lightAtten = 1.0 / (1.0 + lightDist * lightDist * 0.02);
  let lightDiffuse = max(dot(normal, lightDir), 0.0);
  color += scene.houseLightColor * lightDiffuse * lightAtten * 0.5;

  // Rim light for Ari (helps silhouette)
  if (materialId == 1u) {
    let viewDir = normalize(camera.eye - p);
    let rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    color += scene.moonColor * rim * 0.3;
  }

  return color;
}

// ── Firefly glow ─────────────────────────────────────────────────────────

fn fireflyGlow(ro: vec3f, rd: vec3f, sceneDepth: f32) -> vec3f {
  var glow = vec3f(0.0);

  for (var i = 0u; i < FIREFLY_COUNT; i++) {
    let fly = fireflies[i];
    if (fly.alive == 0u) { continue; }

    // Project firefly position onto ray
    let toFly = fly.position - ro;
    let t = dot(toFly, rd);
    if (t < 0.0 || t > sceneDepth) { continue; }

    let closest = ro + rd * t;
    let dist = length(fly.position - closest);

    // Glow falloff
    let intensity = fly.brightness * exp(-dist * dist * 20.0);
    let flyColor = vec3f(0.8, 0.95, 0.2) * intensity * 2.0;

    glow += flyColor;
  }

  return glow;
}

// ── Fragment shader ──────────────────────────────────────────────────────

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = vec2f(input.resolutionX, input.resolutionY);
  
  // Safety check: if resolution is invalid, show red
  if (resolution.x < 1.0 || resolution.y < 1.0) {
    return vec4f(1.0, 0.0, 0.0, 1.0);
  }
  
  let aspect = resolution.x / resolution.y;

  // Pixel coords: -1..1 with aspect correction
  // Note: uv.y is 0 at top, 1 at bottom, so we flip it
  let pixelCoord = vec2f(
    (uv.x - 0.5) * 2.0 * aspect,
    (0.5 - uv.y) * 2.0,
  );

  // Ray from camera
  let eye = camera.eye;
  let lookAt = camera.lookAt;
  let fwd = normalize(lookAt - eye);
  let worldUp = vec3f(0.0, 1.0, 0.0);
  let right = normalize(cross(fwd, worldUp));
  let up = cross(right, fwd);

  let fov = camera.fov;
  let rd = normalize(fwd + right * pixelCoord.x * fov + up * pixelCoord.y * fov);

  // Ray march
  let result = rayMarch(eye, rd);

  var color: vec3f;
  if (result.hit) {
    let hitPos = eye + rd * result.totalDist;
    let normal = sceneNormal(hitPos);
    color = shade(hitPos, normal, result.materialId);
    color = applyFog(color, result.totalDist, rd);
  } else {
    color = skyColor(rd);
  }

  // Add firefly glow on top
  let maxDist = select(MAX_DIST, result.totalDist, result.hit);
  color += fireflyGlow(eye, rd, maxDist);

  // Simple tonemap
  color = color / (1.0 + color);

  // Gamma correction
  color = pow(color, vec3f(1.0 / 2.2));

  return vec4f(color, 1.0);
}
