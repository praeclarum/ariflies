// One-time compute pass: reads terrain heightmap, writes max-slope texture.
// For each texel, samples a neighborhood and finds the maximum gradient.
// Output: conservative SDF factor = 1/sqrt(1 + maxGrad²).
// Used by the ray marcher for per-texel adaptive step sizing.

struct TerrainParams {
  worldRadius: f32,
  maxHeight: f32,
  terrainFadeWidth: f32,
  _pad: f32,
};

@group(0) @binding(0) var terrainTexture: texture_2d<f32>;
@group(0) @binding(1) var slopeTexture: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> params: TerrainParams;
@group(0) @binding(3) var normalTexture: texture_storage_2d<rgba16float, write>;

const RADIUS: i32 = 8;

// Compute terrain fade at a texel coordinate (same algorithm as raymarch.wgsl terrainFade)
fn terrainFadeFromTexel(coord: vec2i, texSizeF: f32) -> f32 {
  let uv = (vec2f(coord) + 0.5) / texSizeF;
  let fromCenter = abs(uv - vec2f(0.5)) * 2.0;
  let edgeDist = max(fromCenter.x, fromCenter.y);
  return 1.0 - smoothstep(1.0 - params.terrainFadeWidth, 1.0, edgeDist);
}

// Get terrain height at a texel with fade applied (matches getTerrainHeight in raymarch)
fn getHeightWithFade(coord: vec2i, iTexSize: vec2i, texSizeF: f32) -> f32 {
  let clamped = clamp(coord, vec2i(0), iTexSize - vec2i(1));
  let rawH = textureLoad(terrainTexture, clamped, 0).r;
  return rawH * params.maxHeight * terrainFadeFromTexel(clamped, texSizeF);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texSize = textureDimensions(terrainTexture, 0);
  if (gid.x >= texSize.x || gid.y >= texSize.y) { return; }

  let texSizeF = f32(texSize.x);
  let worldTexelSize = params.worldRadius * 2.0 / texSizeF;

  // Height at this texel
  let iTexSize = vec2i(texSize);
  let centerH = getHeightWithFade(vec2i(gid.xy), iTexSize, texSizeF);

  // Find max gradient in neighborhood by sampling along 8 directions
  // This is O(radius) per texel instead of O(radius²)
  var maxGrad2: f32 = 0.0;
  let dirs = array<vec2i, 8>(
    vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
    vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1),
  );

  for (var d = 0; d < 8; d++) {
    let dir = dirs[d];
    for (var step = 1; step <= RADIUS; step++) {
      let nx = clamp(i32(gid.x) + dir.x * step, 0, iTexSize.x - 1);
      let ny = clamp(i32(gid.y) + dir.y * step, 0, iTexSize.y - 1);
      let nh = getHeightWithFade(vec2i(nx, ny), iTexSize, texSizeF);
      let worldDist = length(vec2f(f32(dir.x * step), f32(dir.y * step))) * worldTexelSize;
      let grad = abs(nh - centerH) / worldDist;
      maxGrad2 = max(maxGrad2, grad * grad);
    }
  }

  // Store conservative factor: 1/sqrt(1 + maxGrad²)
  let factor = 1.0 / sqrt(1.0 + maxGrad2);
  textureStore(slopeTexture, vec2i(gid.xy), vec4f(factor, 0.0, 0.0, 1.0));

  // Compute terrain normal from central differences (including terrain fade)
  let hL = getHeightWithFade(vec2i(i32(gid.x) - 1, i32(gid.y)), iTexSize, texSizeF);
  let hR = getHeightWithFade(vec2i(i32(gid.x) + 1, i32(gid.y)), iTexSize, texSizeF);
  let hD = getHeightWithFade(vec2i(gid.xy) + vec2i(0, -1), iTexSize, texSizeF);
  let hU = getHeightWithFade(vec2i(gid.xy) + vec2i(0, 1), iTexSize, texSizeF);

  let gradX = (hR - hL) / (2.0 * worldTexelSize);
  let gradZ = (hU - hD) / (2.0 * worldTexelSize);
  let normal = normalize(vec3f(-gradX, 1.0, -gradZ));
  textureStore(normalTexture, vec2i(gid.xy), vec4f(normal, 0.0));
}
