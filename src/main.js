// @ts-check

async function main() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
  const messageEl = /** @type {HTMLElement} */ (document.getElementById('message'));

  // Check WebGPU support
  if (!navigator.gpu) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'WebGPU is not supported in this browser.';
    console.error('WebGPU not supported');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'Failed to get GPU adapter.';
    console.error('No GPU adapter');
    return;
  }

  const device = await adapter.requestDevice();
  const context = /** @type {GPUCanvasContext} */ (canvas.getContext('webgpu'));
  if (!context) {
    messageEl.style.display = 'block';
    messageEl.textContent = 'Failed to get WebGPU context.';
    console.error('No WebGPU context');
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  console.log('WebGPU initialized');
  console.log(`  Adapter: ${adapter.info?.vendor ?? 'unknown'} / ${adapter.info?.architecture ?? 'unknown'}`);
  console.log(`  Format: ${format}`);

  // Resize canvas to match display
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // Render loop placeholder — clears to dark blue-black
  function frame() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.01, g: 0.01, b: 0.03, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
