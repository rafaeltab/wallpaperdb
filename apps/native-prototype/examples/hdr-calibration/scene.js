(async () => {
  const canvas = document.getElementById("canvas");
  canvas.width = wallpaper.canvas.width;
  canvas.height = wallpaper.canvas.height;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter)
    throw new Error(
      "HDR live probe needs WebGPU; this engine exposes no adapter",
    );
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  context.configure({
    device,
    format: "rgba16float",
    colorSpace: "srgb",
    toneMapping: { mode: "extended" },
    alphaMode: "opaque",
  });
  // WebGPU linear sRGB uses reference white = 203 nits. OSR must preserve extended values.
  const shader = device.createShaderModule({
    code: `
 struct Out{@builtin(position) pos:vec4f,@location(0) uv:vec2f};
 @vertex fn vert(@builtin(vertex_index) i:u32)->Out{let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.pos=vec4f(p*2.-1.,0.,1.);o.uv=p;return o;}
 @fragment fn frag(i:Out)->@location(0) vec4f{let nits=array<f32,8>(.1,1.,10.,80.,203.,300.,400.,800.);let n=nits[min(u32(i.uv.x*8.),7u)];return vec4f(vec3f(n/203.),1.);}`,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vert" },
    fragment: {
      module: shader,
      entryPoint: "frag",
      targets: [{ format: "rgba16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  function draw() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  wallpaper.on("frame", draw);
  draw();
  document.getElementById("diagnostic").textContent =
    "WebGPU · rgba16float · extended · 0.1 / 1 / 10 / 80 / 203 / 300 / 400 / 800 nits";
})().catch((error) => {
  document.getElementById("diagnostic").textContent = error.message;
  throw error;
});
