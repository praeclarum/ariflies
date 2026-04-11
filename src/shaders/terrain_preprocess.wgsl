// One-time compute pass: reads terrain heightmap, writes max-slope texture.
// For each texel, samples a neighborhood and finds the maximum gradient.
// Output: conservative SDF factor = 1/sqrt(1 + maxGrad²).
// Used by the ray marcher for per-texel adaptive step sizing.

struct TerrainParams {
  worldRadius: f32,
  maxHeight: f32,
};

@group(0) @binding(0) var terrainTexture: texture_2d<f32>;
@group(0) @binding(1) var slopeTexture: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var<uniform> params: TerrainParams;

const RADIUS: i32 = 8;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texSize = textureDimensions(terrainTexture, 0);
  if (gid.x >= texSize.x || gid.y >= texSize.y) { return; }

  let worldTexelSize = params.worldRadius * 2.0 / f32(texSize.x);

  // Height at this texel
  let centerH = textureLoad(terrainTexture, vec2i(gid.xy), 0).r * params.maxHeight;

  // Find max gradient in neighborhood by sampling along 8 directions
  // This is O(radius) per texel instead of O(radius²)
  var maxGrad2: f32 = 0.0;
  let iTexSize = vec2i(texSize);

  // 8 directions: cardinal + diagonal
  let dirs = array<vec2i, 8>(
    vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
    vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1),
  );

  for (var d = 0; d < 8; d++) {
    let dir = dirs[d];
    for (var step = 1; step <= RADIUS; step++) {
      let nx = clamp(i32(gid.x) + dir.x * step, 0, iTexSize.x - 1);
      let ny = clamp(i32(gid.y) + dir.y * step, 0, iTexSize.y - 1);
      let nh = textureLoad(terrainTexture, vec2i(nx, ny), 0).r * params.maxHeight;
      let worldDist = length(vec2f(f32(dir.x * step), f32(dir.y * step))) * worldTexelSize;
      let grad = abs(nh - centerH) / worldDist;
      maxGrad2 = max(maxGrad2, grad * grad);
    }
  }

  // Store conservative factor: 1/sqrt(1 + maxGrad²)
  let factor = 1.0 / sqrt(1.0 + maxGrad2);
  textureStore(slopeTexture, vec2i(gid.xy), vec4f(factor, 0.0, 0.0, 1.0));
}
