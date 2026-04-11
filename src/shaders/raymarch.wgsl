// Fullscreen ray march shader
// Vertex: fullscreen triangle from vertex_index
// Fragment: ray march SDF scene with moonlit atmosphere
//
// Coordinate System:
//   - Y is up
//   - Camera at yaw=0 is at +Z looking toward -Z (into the scene)
//   - Ari at facing=0 looks toward +Z (world forward = (sin(facing), 0, cos(facing)))
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
  worldRadius: f32,
  maxHeight: f32,
  terrainFadeWidth: f32,
  _pad5: f32,
};

// ── Bindings ─────────────────────────────────────────────────────────────

@group(0) @binding(0) var<uniform> input: InputUniforms;
@group(0) @binding(1) var<storage, read> camera: CameraState;
@group(0) @binding(2) var<storage, read> ari: AriState;
@group(0) @binding(3) var<storage, read> fireflies: array<Firefly>;
@group(0) @binding(4) var<storage, read> game: GameState;
@group(0) @binding(5) var<uniform> scene: SceneParams;
@group(0) @binding(6) var terrainTexture: texture_2d<f32>;
@group(0) @binding(7) var terrainSampler: sampler;
@group(0) @binding(8) var slopeTexture: texture_2d<f32>;
@group(0) @binding(9) var slopeSampler: sampler;
@group(0) @binding(10) var normalTexture: texture_2d<f32>;

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

// ── Ari SDF ─────────────────────────────────────────────────────────────
// Ari looks toward local +Z. We rotate world points into Ari's local frame.
//
// Given forward = (fx, 0, fz), we can compute:
//   right = up × forward = (0,1,0) × (fx,0,fz) = (fz, 0, -fx)
//
// World→local rotation matrix (rows are right, up, forward):
//   |  fz   0  -fx |
//   |  0    1   0  |
//   |  fx   0   fz |

fn sdAri(p: vec3f) -> f32 {
  let ap = p - ari.position;
  
  // Forward direction (Y=0, normalized)
  let fwd = vec2f(ari.forwardX, ari.forwardZ);
  
  // Build rotation using cross product: right = up × forward
  // right = (fz, -fx), up = (0,1,0), forward = (fx, fz)
  let lp = vec3f(
    fwd.y * ap.x - fwd.x * ap.z,   // dot(right, ap) where right = (fz, 0, -fx)
    ap.y,
    fwd.x * ap.x + fwd.y * ap.z,   // dot(forward, ap)
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

// ── Terrain height ───────────────────────────────────────────────────────

fn worldToTerrainUV(worldXZ: vec2f) -> vec2f {
  return (worldXZ + vec2f(scene.worldRadius)) / (2.0 * scene.worldRadius);
}

// Fade factor: 1.0 inside terrain, fades to 0 outside world radius
fn terrainFade(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  // Distance from UV center (0.5, 0.5) in UV space
  let fromCenter = abs(uv - vec2f(0.5)) * 2.0; // 0..1 inside, >1 outside
  let edgeDist = max(fromCenter.x, fromCenter.y);
  return 1.0 - smoothstep(1.0 - scene.terrainFadeWidth, 1.0, edgeDist);
}

fn getTerrainHeight(worldXZ: vec2f) -> f32 {
  let uv = worldToTerrainUV(worldXZ);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  // Must use explicit LOD — this is called inside ray march and shadow loops
  // which are non-uniform control flow (textureSample derivatives are undefined).
  let h = textureSampleLevel(terrainTexture, terrainSampler, clampedUV, 0.0).r;
  return h * scene.maxHeight * terrainFade(worldXZ);
}

// ── Scene SDF ────────────────────────────────────────────────────────────

const FIREFLY_COUNT: u32 = 50u;

struct HitInfo {
  dist: f32,
  materialId: u32, // 0=ground, 1=ari, 2=sky
};

fn sceneSDF(p: vec3f) -> HitInfo {
  // Terrain heightfield distance estimate.
  // Use precomputed per-texel conservative factor from slope texture.
  let terrainH = getTerrainHeight(p.xz);
  let uv = worldToTerrainUV(p.xz);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  let slopeFactor = textureSampleLevel(slopeTexture, slopeSampler, clampedUV, 0.0).r;
  let ground = (p.y - terrainH) * slopeFactor;

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

// Cheaper SDF for shadow rays — uses slope factor to prevent overshoot
// past terrain peaks, but on flat terrain the factor is ~1.0 (no penalty).
fn sceneSDF_cheap(p: vec3f) -> f32 {
  let terrainH = getTerrainHeight(p.xz);
  let uv = worldToTerrainUV(p.xz);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  let slopeFactor = textureSampleLevel(slopeTexture, slopeSampler, clampedUV, 0.0).r;
  let ground = (p.y - terrainH) * slopeFactor;
  return min(ground, sdAri(p));
}

fn sceneNormal(p: vec3f) -> vec3f {
  // Use analytic terrain normal when we hit ground (avoids noisy finite differences)
  let e = 0.002;
  let d = sceneSDF(p).dist;
  return normalize(vec3f(
    sceneSDF(p + vec3f(e, 0.0, 0.0)).dist - d,
    sceneSDF(p + vec3f(0.0, e, 0.0)).dist - d,
    sceneSDF(p + vec3f(0.0, 0.0, e)).dist - d,
  ));
}

fn terrainNormal(p: vec3f) -> vec3f {
  let uv = worldToTerrainUV(p.xz);
  let clampedUV = clamp(uv, vec2f(0.001), vec2f(0.999));
  return normalize(textureSampleLevel(normalTexture, terrainSampler, clampedUV, 0.0).rgb);
}

// ── Ray marching ─────────────────────────────────────────────────────────

const MAX_STEPS: i32 = 196;
const MAX_DIST: f32 = 120.0;
const SURFACE_DIST: f32 = 0.002;
const PRIMARY_MIN_STEP: f32 = 0.002;

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
  var prevTotalDist = 0.0;
  var prevDist = 1e9;

  for (var i = 0; i < MAX_STEPS; i++) {
    let p = ro + rd * result.totalDist;
    let hit = sceneSDF(p);
    result.dist = hit.dist;

    // Terrain gets a wider hit epsilon at grazing view angles.
    // We later snap terrain hits to exact heightfield, so this avoids edge gaps
    // without leaving visible floating intersections.
    let grazing = 1.0 - abs(rd.y);
    let grazingT = smoothstep(0.7, 1.0, grazing);
    let terrainSurfaceThreshold = mix(SURFACE_DIST, SURFACE_DIST * 6.0, grazingT);
    let surfaceThreshold = select(SURFACE_DIST, terrainSurfaceThreshold, hit.materialId == 0u);

    if (hit.dist < surfaceThreshold) {
      // Refine hit position to improve world-space stability at grazing angles.
      // This reduces camera-dependent jitter that shows up as shadow splotches.
      if (prevDist * hit.dist <= 0.0) {
        var tNear = prevTotalDist;
        var tFar = result.totalDist;
        for (var j = 0; j < 4; j++) {
          let tMid = 0.5 * (tNear + tFar);
          let dMid = sceneSDF(ro + rd * tMid).dist;
          if (dMid > 0.0) {
            tNear = tMid;
          } else {
            tFar = tMid;
          }
        }
        result.totalDist = 0.5 * (tNear + tFar);
      } else if (hit.dist > 0.0) {
        // If accepted by threshold before crossing, march forward briefly to
        // bracket an actual zero-crossing and refine there (prevents rings).
        var tNear = prevTotalDist;
        var dNear = prevDist;
        var tFar = result.totalDist;
        var dFar = hit.dist;

        for (var j = 0; j < 5; j++) {
          if (dFar <= 0.0 || tFar > MAX_DIST) { break; }
          tNear = tFar;
          dNear = dFar;
          tFar += max(dFar, PRIMARY_MIN_STEP);
          dFar = sceneSDF(ro + rd * tFar).dist;
        }

        if (dNear > 0.0 && dFar <= 0.0) {
          for (var j = 0; j < 5; j++) {
            let tMid = 0.5 * (tNear + tFar);
            let dMid = sceneSDF(ro + rd * tMid).dist;
            if (dMid > 0.0) {
              tNear = tMid;
            } else {
              tFar = tMid;
            }
          }
          result.totalDist = 0.5 * (tNear + tFar);
        } else {
          // Conservative fallback if we still fail to bracket a crossing.
          result.totalDist = max(result.totalDist - hit.dist * 0.35, prevTotalDist);
        }
      } else if (hit.dist < 0.0) {
        // Fallback clamp for slight overshoot when no sign change was bracketed.
        result.totalDist = max(result.totalDist + hit.dist, prevTotalDist);
      }
      result.hit = true;
      result.materialId = hit.materialId;
      break;
    }
    // Trust the SDF — only enforce a tiny fixed minimum to avoid zero-step stalls.
    // Do NOT scale minStep with distance: that causes overshoot on grazing rays,
    // producing dark circular splotches where the ray punches underground.
    prevTotalDist = result.totalDist;
    prevDist = hit.dist;
    result.totalDist += max(hit.dist, PRIMARY_MIN_STEP);
    if (result.totalDist > MAX_DIST) { break; }
  }

  return result;
}

// ── Sky and moon ─────────────────────────────────────────────────────────

// Hash function for procedural stars
fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash31(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Procedural star field
fn starField(rd: vec3f) -> f32 {
  // Only render stars above horizon
  if (rd.y < 0.05) { return 0.0; }
  
  // Project ray direction to a 2D grid for star placement
  let theta = atan2(rd.z, rd.x);
  let phi = asin(rd.y);
  
  // Multiple scales for variety
  var stars = 0.0;
  
  // Fine stars (many, dim)
  let grid1 = vec2f(theta * 30.0, phi * 60.0);
  let cell1 = floor(grid1);
  let starPos1 = hash21(cell1);
  let starBright1 = hash21(cell1 + 100.0);
  if (starPos1 > 0.97) {
    let dist = length(fract(grid1) - 0.5);
    let twinkle = 0.7 + 0.3 * sin(input.time * (2.0 + starBright1 * 4.0) + starBright1 * 6.28);
    stars += smoothstep(0.15, 0.0, dist) * starBright1 * 0.4 * twinkle;
  }
  
  // Medium stars (fewer, brighter)
  let grid2 = vec2f(theta * 15.0, phi * 30.0);
  let cell2 = floor(grid2);
  let starPos2 = hash21(cell2 + 50.0);
  let starBright2 = hash21(cell2 + 150.0);
  if (starPos2 > 0.92) {
    let dist = length(fract(grid2) - 0.5);
    let twinkle = 0.8 + 0.2 * sin(input.time * (1.5 + starBright2 * 3.0) + starBright2 * 6.28);
    stars += smoothstep(0.12, 0.0, dist) * starBright2 * 0.7 * twinkle;
  }
  
  // Bright stars (rare, very bright)
  let grid3 = vec2f(theta * 8.0, phi * 16.0);
  let cell3 = floor(grid3);
  let starPos3 = hash21(cell3 + 200.0);
  let starBright3 = hash21(cell3 + 250.0);
  if (starPos3 > 0.96) {
    let dist = length(fract(grid3) - 0.5);
    let twinkle = 0.85 + 0.15 * sin(input.time * (1.0 + starBright3 * 2.0) + starBright3 * 6.28);
    stars += smoothstep(0.08, 0.0, dist) * (0.8 + starBright3 * 0.4) * twinkle;
  }
  
  // Fade stars near horizon
  let horizonFade = smoothstep(0.05, 0.25, rd.y);
  
  return stars * horizonFade;
}

fn skyColor(rd: vec3f) -> vec3f {
  // Dramatic dark night sky - deep blacks with color
  let skyZenith = vec3f(0.005, 0.005, 0.025);   // Near black with hint of blue
  let skyMid = vec3f(0.01, 0.012, 0.04);        // Very dark blue
  let skyHorizon = vec3f(0.02, 0.025, 0.06);    // Dark blue-gray horizon
  
  // Two-stage gradient for depth
  let t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  let tMid = smoothstep(0.0, 0.5, t);
  let tTop = smoothstep(0.5, 1.0, t);
  var sky = mix(skyHorizon, skyMid, tMid);
  sky = mix(sky, skyZenith, tTop);
  
  // Subtle purple/magenta tint toward zenith
  let purpleTint = vec3f(0.015, 0.005, 0.025) * smoothstep(0.3, 0.8, rd.y);
  sky += purpleTint;
  
  // Subtle horizon glow on opposite side of moon
  let moonDir = normalize(scene.moonDir);
  let antiMoon = -vec3f(moonDir.x, 0.0, moonDir.z);
  let horizonGlow = max(dot(normalize(vec3f(rd.x, 0.0, rd.z)), antiMoon), 0.0);
  let horizonBand = exp(-abs(rd.y) * 10.0);
  sky += vec3f(0.01, 0.015, 0.025) * horizonGlow * horizonBand;
  
  // Add stars
  let stars = starField(rd);
  sky += vec3f(0.9, 0.95, 1.0) * stars;

  // Moon
  let moonDot = dot(rd, moonDir);

  // Soft moon disk with limb darkening
  let moonRadius = 0.9995;  // Slightly larger moon
  let moonEdge = smoothstep(moonRadius - 0.002, moonRadius + 0.001, moonDot);
  let moonCenter = vec3f(0.98, 0.96, 0.88);  // Warm white center
  let moonLimb = vec3f(0.85, 0.82, 0.75);     // Slightly darker/cooler edge
  let limbDarkening = smoothstep(moonRadius, 1.0, moonDot);
  let moonDisk = mix(moonLimb, moonCenter, limbDarkening);
  sky = mix(sky, moonDisk, moonEdge);
  
  // Tight inner glow
  let moonGlow = pow(max(moonDot, 0.0), 256.0) * 0.6;
  sky += scene.moonColor * moonGlow;

  // Medium halo
  let halo1 = pow(max(moonDot, 0.0), 32.0) * 0.15;
  sky += scene.moonColor * halo1;
  
  // Broad atmospheric halo
  let halo2 = pow(max(moonDot, 0.0), 8.0) * 0.06;
  sky += scene.moonColor * halo2 * vec3f(0.8, 0.85, 1.0);

  return sky;
}

// ── Fog with moon rays ───────────────────────────────────────────────────

fn applyFog(color: vec3f, dist: f32, rd: vec3f) -> vec3f {
  let fogAmount = 1.0 - exp(-dist * scene.fogDensity);
  
  // Base fog color from sky
  var fogColor = skyColor(rd) * 1.2 + scene.ambientColor;
  
  // Moon influence on fog - brighter when looking toward moon (god rays effect)
  let moonDir = normalize(scene.moonDir);
  let moonInfluence = max(dot(rd, moonDir), 0.0);
  
  // Add moon-tinted brightness to fog when looking toward moon
  // Subtle effect without noisy banding
  let godRayStrength = pow(moonInfluence, 3.0) * 0.25;
  fogColor += scene.moonColor * godRayStrength;
  
  // Height-based fog density (thicker near ground)
  let heightFog = exp(-max(rd.y, 0.0) * 2.0);
  let adjustedFogAmount = fogAmount * (0.7 + 0.3 * heightFog);
  
  return mix(color, fogColor, adjustedFogAmount);
}

// ── Soft shadows ─────────────────────────────────────────────────────────

const SHADOW_STEPS: i32 = 72;
const SHADOW_HIT_EPS: f32 = 0.0005;
const SHADOW_MIN_STEP_BASE: f32 = 0.0015;
const SHADOW_MIN_STEP_DIST_SCALE: f32 = 0.01;
const SHADOW_MAX_STEP: f32 = 1.25;

const SHADOW_BIAS_BASE: f32 = 0.02;
const SHADOW_BIAS_GRAZE_SCALE: f32 = 0.06;
const SHADOW_LIGHT_PUSH: f32 = 0.012;

// SDF-based soft shadow using penumbra estimation
// Returns shadow factor: 0.0 = full shadow, 1.0 = fully lit
fn calcSoftShadow(ro: vec3f, rd: vec3f, mint: f32, maxt: f32, k: f32) -> f32 {
  var res = 1.0;
  var t = mint;
  
  for (var i = 0; i < SHADOW_STEPS; i++) {
    let p = ro + rd * t;
    let h = sceneSDF_cheap(p);

    // If the shadow ray enters geometry, this point is shadowed.
    if (h < SHADOW_HIT_EPS) { return 0.0; }
    
    // Simple soft shadow: smaller h/t ratio = sharper shadow edge
    res = min(res, k * h / t);
    
    // Use distance-scaled min step to avoid fixed-step shell artifacts (rings).
    let minStep = SHADOW_MIN_STEP_BASE + t * SHADOW_MIN_STEP_DIST_SCALE;
    t += clamp(h, minStep, SHADOW_MAX_STEP);
    
    if (res < 0.001 || t > maxt) { break; }
  }
  
  return clamp(res, 0.0, 1.0);
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
  
  // Calculate moon shadow (soft shadows from moonlight)
  // Use slope-scaled bias to reduce view-dependent self-shadow artifacts.
  let moonNdotL = max(dot(normal, moonDir), 0.0);
  let moonBias = SHADOW_BIAS_BASE + (1.0 - moonNdotL) * SHADOW_BIAS_GRAZE_SCALE;
  let moonShadowOrigin = p + normal * moonBias + moonDir * SHADOW_LIGHT_PUSH;
  let moonShadow = calcSoftShadow(moonShadowOrigin, moonDir, 0.02, 40.0, 5.5);
  
  // Moonlight diffuse with shadows - high contrast
  let moonDiffuse = max(dot(normal, moonDir), 0.0);
  let shadowedMoon = moonDiffuse * (0.08 + 0.92 * moonShadow);  // Deep shadows
  color += color * scene.moonColor * shadowedMoon * 2.0;

  // Minimal ambient - let shadows be dark
  color += scene.ambientColor * 0.15;

  // House light (point light) with shadows
  let toLight = scene.houseLightPos - p;
  let lightDist = length(toLight);
  let lightDir = toLight / lightDist;
  let lightAtten = 1.0 / (1.0 + lightDist * lightDist * 0.02);
  let lightDiffuse = max(dot(normal, lightDir), 0.0);
  
  // House light shadow (softer k value for warmer light)
  let houseNdotL = max(dot(normal, lightDir), 0.0);
  let houseBias = SHADOW_BIAS_BASE + (1.0 - houseNdotL) * SHADOW_BIAS_GRAZE_SCALE;
  let houseShadowOrigin = p + normal * houseBias + lightDir * SHADOW_LIGHT_PUSH;
  let houseShadow = calcSoftShadow(houseShadowOrigin, lightDir, 0.02, lightDist, 3.5);
  color += scene.houseLightColor * lightDiffuse * lightAtten * houseShadow * 0.5;

  // Rim light for Ari (helps silhouette) - no shadow needed
  if (materialId == 1u) {
    let viewDir = normalize(camera.eye - p);
    let rim = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
    color += scene.moonColor * rim * 0.35;
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
  var sceneDepth = MAX_DIST;
  if (result.hit) {
    var hitPos = eye + rd * result.totalDist;
    var hitDist = result.totalDist;

    // Terrain hits should lie on the exact heightfield surface. This removes
    // march-depth quantization that can show up as concentric shadow/fog rings.
    if (result.materialId == 0u) {
      hitPos = vec3f(hitPos.x, getTerrainHeight(hitPos.xz), hitPos.z);
      hitDist = length(hitPos - eye);
    }

    // Use analytic normal for terrain (smooth, no noise), SDF normal for Ari
    var normal: vec3f;
    if (result.materialId == 0u) {
      normal = terrainNormal(hitPos);
    } else {
      normal = sceneNormal(hitPos);
    }
    color = shade(hitPos, normal, result.materialId);
    color = applyFog(color, hitDist, rd);
    sceneDepth = hitDist;
  } else {
    color = skyColor(rd);
  }

  // Add firefly glow on top
  color += fireflyGlow(eye, rd, sceneDepth);

  // Simple tonemap
  color = color / (1.0 + color);

  // Gamma correction
  color = pow(color, vec3f(1.0 / 2.2));

  return vec4f(color, 1.0);
}
