// @ts-check

/**
 * @fileoverview Fullscreen ray march render pipeline.
 * Uses a single oversized triangle (no vertex buffer) and reads all game state
 * buffers as read-only storage/uniforms in the fragment shader.
 */

/**
 * @typedef {import('./buffers.js').Buffers} Buffers
 */

/**
 * @typedef {Object} Renderer
 * @property {GPURenderPipeline} pipeline
 * @property {GPUBindGroup} bindGroup
 */

/**
 * Create the fullscreen ray march render pipeline.
 * @param {GPUDevice} device
 * @param {GPUTextureFormat} format
 * @param {Buffers} buffers
 * @returns {Promise<Renderer>}
 */
export async function createRenderer(device, format, buffers) {
  const resp = await fetch('src/shaders/raymarch.wgsl');
  if (!resp.ok) throw new Error('Failed to load raymarch.wgsl');
  const shaderSrc = await resp.text();

  const module = device.createShaderModule({ label: 'raymarch', code: shaderSrc });

  const bgl = device.createBindGroupLayout({
    label: 'raymarch-bgl',
    entries: [
      // 0: InputUniforms (uniform)
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      // 1: CameraState (read-only storage)
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      // 2: AriState (read-only storage)
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      // 3: FireflyArray (read-only storage)
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      // 4: GameState (read-only storage)
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      // 5: SceneParams (uniform)
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      // 6: Terrain texture
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      // 7: Terrain sampler
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      // 8: Slope texture (r32float, filterable with float32-filterable feature)
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      // 9: Slope sampler
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    label: 'raymarch',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: {
      module,
      entryPoint: 'vs_main',
      // No vertex buffers — fullscreen triangle from vertex_index
    },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const bindGroup = device.createBindGroup({
    label: 'raymarch-bg',
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.camera } },
      { binding: 2, resource: { buffer: buffers.ari } },
      { binding: 3, resource: { buffer: buffers.fireflies } },
      { binding: 4, resource: { buffer: buffers.game } },
      { binding: 5, resource: { buffer: buffers.scene } },
      { binding: 6, resource: buffers.terrainTexture.createView() },
      { binding: 7, resource: buffers.terrainSampler },
      { binding: 8, resource: buffers.slopeTexture.createView() },
      { binding: 9, resource: buffers.terrainSampler },
    ],
  });

  return { pipeline, bindGroup };
}

/**
 * Rebuild the render bind group (needed after terrain texture recreation).
 * @param {GPUDevice} device
 * @param {Renderer} renderer
 * @param {Buffers} buffers
 */
export function rebuildRenderBindGroup(device, renderer, buffers) {
  renderer.bindGroup = device.createBindGroup({
    label: 'raymarch-bg',
    layout: renderer.pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.camera } },
      { binding: 2, resource: { buffer: buffers.ari } },
      { binding: 3, resource: { buffer: buffers.fireflies } },
      { binding: 4, resource: { buffer: buffers.game } },
      { binding: 5, resource: { buffer: buffers.scene } },
      { binding: 6, resource: buffers.terrainTexture.createView() },
      { binding: 7, resource: buffers.terrainSampler },
      { binding: 8, resource: buffers.slopeTexture.createView() },
      { binding: 9, resource: buffers.terrainSampler },
    ],
  });
}

/**
 * Encode the fullscreen ray march render pass.
 * @param {GPUCommandEncoder} encoder
 * @param {GPUCanvasContext} context
 * @param {Renderer} renderer
 */
export function render(encoder, context, renderer) {
  const pass = encoder.beginRenderPass({
    label: 'raymarch-pass',
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.bindGroup);
  pass.draw(3); // Fullscreen triangle — 3 vertices, no vertex buffer
  pass.end();
}
