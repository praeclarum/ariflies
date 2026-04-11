// @ts-check

/**
 * @fileoverview Creates and dispatches 3 compute pipelines in dependency order:
 *   1. Camera (reads Input+Ari → writes Camera)
 *   2. Ari (reads Input+Camera → writes Ari)
 *   3. Firefly (reads Input+Ari+Game+Scene+Terrain → writes Fireflies+Game)
 */

import { MAX_FIREFLIES, prependWGSLSharedStructs } from './buffers.js';

/**
 * @typedef {import('./buffers.js').Buffers} Buffers
 */

/**
 * @typedef {Object} ComputePipelines
 * @property {GPUComputePipeline} camera
 * @property {GPUComputePipeline} ari
 * @property {GPUComputePipeline} firefly
 * @property {GPUComputePipeline} terrainPreprocess
 * @property {GPUBindGroup} cameraBindGroup
 * @property {GPUBindGroup} ariBindGroup
 * @property {GPUBindGroup} fireflyBindGroup
 */

/**
 * Load a WGSL shader file via fetch and prepend shared struct definitions.
 * @param {string} path - Relative path from repo root
 * @returns {Promise<string>}
 */
async function loadShader(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to load shader: ${path}`);
  const shaderSource = await resp.text();
  return prependWGSLSharedStructs(shaderSource);
}

/**
 * Create all three compute pipelines and their bind groups.
 * @param {GPUDevice} device
 * @param {Buffers} buffers
 * @returns {Promise<ComputePipelines>}
 */
export async function createComputePipelines(device, buffers) {
  const [cameraSrc, ariSrc, fireflySrc, terrainPreprocSrc] = await Promise.all([
    loadShader('src/shaders/camera_compute.wgsl'),
    loadShader('src/shaders/ari_compute.wgsl'),
    loadShader('src/shaders/firefly_compute.wgsl'),
    loadShader('src/shaders/terrain_preprocess.wgsl'),
  ]);

  // ── Camera compute pipeline ─────────────────────────────────────────────

  const cameraModule = device.createShaderModule({ label: 'camera-compute', code: cameraSrc });
  const cameraBGL = device.createBindGroupLayout({
    label: 'camera-compute-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const cameraPipeline = device.createComputePipeline({
    label: 'camera-compute',
    layout: device.createPipelineLayout({ bindGroupLayouts: [cameraBGL] }),
    compute: { module: cameraModule, entryPoint: 'main' },
  });
  const cameraBindGroup = device.createBindGroup({
    label: 'camera-compute-bg',
    layout: cameraBGL,
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.ari } },
      { binding: 2, resource: { buffer: buffers.camera } },
    ],
  });

  // ── Ari compute pipeline ────────────────────────────────────────────────

  const ariModule = device.createShaderModule({ label: 'ari-compute', code: ariSrc });
  const ariBGL = device.createBindGroupLayout({
    label: 'ari-compute-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const ariPipeline = device.createComputePipeline({
    label: 'ari-compute',
    layout: device.createPipelineLayout({ bindGroupLayouts: [ariBGL] }),
    compute: { module: ariModule, entryPoint: 'main' },
  });
  const ariBindGroup = device.createBindGroup({
    label: 'ari-compute-bg',
    layout: ariBGL,
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.camera } },
      { binding: 2, resource: { buffer: buffers.ari } },
      { binding: 3, resource: { buffer: buffers.scene } },
      { binding: 4, resource: buffers.terrainTexture.createView() },
      { binding: 5, resource: buffers.terrainSampler },
      { binding: 6, resource: { buffer: buffers.game } },
    ],
  });

  // ── Firefly compute pipeline ────────────────────────────────────────────

  const fireflyModule = device.createShaderModule({ label: 'firefly-compute', code: fireflySrc });
  const fireflyBGL = device.createBindGroupLayout({
    label: 'firefly-compute-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
    ],
  });
  const fireflyPipeline = device.createComputePipeline({
    label: 'firefly-compute',
    layout: device.createPipelineLayout({ bindGroupLayouts: [fireflyBGL] }),
    compute: { module: fireflyModule, entryPoint: 'main' },
  });
  const fireflyBindGroup = device.createBindGroup({
    label: 'firefly-compute-bg',
    layout: fireflyBGL,
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.ari } },
      { binding: 2, resource: { buffer: buffers.fireflies } },
      { binding: 3, resource: { buffer: buffers.game } },
      { binding: 4, resource: { buffer: buffers.scene } },
      { binding: 5, resource: buffers.terrainTexture.createView() },
      { binding: 6, resource: buffers.terrainSampler },
    ],
  });

  // ── Terrain preprocess pipeline ─────────────────────────────────────────

  const terrainPreprocModule = device.createShaderModule({ label: 'terrain-preprocess', code: terrainPreprocSrc });
  const terrainPreprocBGL = device.createBindGroupLayout({
    label: 'terrain-preprocess-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    ],
  });
  const terrainPreprocessPipeline = device.createComputePipeline({
    label: 'terrain-preprocess',
    layout: device.createPipelineLayout({ bindGroupLayouts: [terrainPreprocBGL] }),
    compute: { module: terrainPreprocModule, entryPoint: 'main' },
  });

  return {
    camera: cameraPipeline,
    ari: ariPipeline,
    firefly: fireflyPipeline,
    terrainPreprocess: terrainPreprocessPipeline,
    cameraBindGroup,
    ariBindGroup,
    fireflyBindGroup,
  };
}

/**
 * Encode all compute dispatches into a command encoder.
 * Must be called in order: camera → ari → firefly.
 * Each gets its own compute pass for implicit storage barrier.
 * @param {GPUCommandEncoder} encoder
 * @param {ComputePipelines} pipelines
 */
export function dispatchCompute(encoder, pipelines) {
  // Pass 1: Camera
  {
    const pass = encoder.beginComputePass({ label: 'camera-compute-pass' });
    pass.setPipeline(pipelines.camera);
    pass.setBindGroup(0, pipelines.cameraBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  // Pass 2: Ari
  {
    const pass = encoder.beginComputePass({ label: 'ari-compute-pass' });
    pass.setPipeline(pipelines.ari);
    pass.setBindGroup(0, pipelines.ariBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  // Pass 3: Fireflies
  {
    const pass = encoder.beginComputePass({ label: 'firefly-compute-pass' });
    pass.setPipeline(pipelines.firefly);
    pass.setBindGroup(0, pipelines.fireflyBindGroup);
    pass.dispatchWorkgroups(Math.ceil(MAX_FIREFLIES / 64));
    pass.end();
  }
}

/**
 * Rebuild the Ari compute bind group (needed after terrain texture recreation).
 * @param {GPUDevice} device
 * @param {ComputePipelines} pipelines
 * @param {Buffers} buffers
 */
export function rebuildAriBindGroup(device, pipelines, buffers) {
  pipelines.ariBindGroup = device.createBindGroup({
    label: 'ari-compute-bg',
    layout: pipelines.ari.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.camera } },
      { binding: 2, resource: { buffer: buffers.ari } },
      { binding: 3, resource: { buffer: buffers.scene } },
      { binding: 4, resource: buffers.terrainTexture.createView() },
      { binding: 5, resource: buffers.terrainSampler },
      { binding: 6, resource: { buffer: buffers.game } },
    ],
  });
}

/**
 * Rebuild the firefly compute bind group (needed after terrain texture recreation).
 * @param {GPUDevice} device
 * @param {ComputePipelines} pipelines
 * @param {Buffers} buffers
 */
export function rebuildFireflyBindGroup(device, pipelines, buffers) {
  pipelines.fireflyBindGroup = device.createBindGroup({
    label: 'firefly-compute-bg',
    layout: pipelines.firefly.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.input } },
      { binding: 1, resource: { buffer: buffers.ari } },
      { binding: 2, resource: { buffer: buffers.fireflies } },
      { binding: 3, resource: { buffer: buffers.game } },
      { binding: 4, resource: { buffer: buffers.scene } },
      { binding: 5, resource: buffers.terrainTexture.createView() },
      { binding: 6, resource: buffers.terrainSampler },
    ],
  });
}

/**
 * Run the one-time terrain preprocess: compute max-slope texture from heightmap.
 * @param {GPUDevice} device
 * @param {ComputePipelines} pipelines
 * @param {Buffers} buffers
 * @param {number} worldRadius
 * @param {number} maxHeight
 */
export function preprocessTerrain(device, pipelines, buffers, worldRadius, maxHeight, terrainFadeWidth = 0.1) {
  // Create a small temp uniform for the preprocess params (16-byte aligned)
  const paramsData = new Float32Array([worldRadius, maxHeight, terrainFadeWidth, 0]);
  const paramsBuffer = device.createBuffer({
    label: 'terrain-preprocess-params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);

  const bindGroup = device.createBindGroup({
    label: 'terrain-preprocess-bg',
    layout: pipelines.terrainPreprocess.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: buffers.terrainTexture.createView() },
      { binding: 1, resource: buffers.slopeTexture.createView() },
      { binding: 2, resource: { buffer: paramsBuffer } },
      { binding: 3, resource: buffers.normalTexture.createView() },
    ],
  });

  const size = buffers.terrainSize;
  const encoder = device.createCommandEncoder({ label: 'terrain-preprocess' });
  const pass = encoder.beginComputePass({ label: 'terrain-preprocess-pass' });
  pass.setPipeline(pipelines.terrainPreprocess);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(size / 16), Math.ceil(size / 16));
  pass.end();
  device.queue.submit([encoder.finish()]);
}
