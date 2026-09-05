const canvas = document.getElementById("canvas");
canvas.width = wallpaper.canvas.width;
canvas.height = wallpaper.canvas.height;
canvas.style.width = "100%";
canvas.style.height = "100%";
const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
});
if (!gl) throw new Error("WebGL2 is unavailable in this renderer");
const vertex = `#version 300 es
out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}`;
const fragment = `#version 300 es
precision highp float;in vec2 uv;out vec4 color;uniform float time;uniform vec2 pointer;uniform float gain;uniform float pulse;uniform float seconds;
vec3 enc(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),x));}
void main(){vec2 p=(uv-.5)*vec2(1.7778,1.);vec2 m=(pointer-.5)*vec2(1.7778,-1.);float wave=sin(p.x*4.+time*.25)*.15+sin(p.x*7.-time*.18)*.06;float ribbon=exp(-abs(p.y-wave)*14.);vec3 tint=.5+.5*cos(vec3(0.,2.1,4.2)+p.x*2.+time*.06+seconds*.00001);float glow=exp(-length(p-m*.3)*3.5);float ring=exp(-abs(length(p-m)-mod(time+floor(pulse)*.71,4.)*.2)*60.);vec3 base=vec3(.006,.008,.018)+tint*ribbon*.65+vec3(.15,.3,.4)*glow;vec3 linear=base*gain+ring*tint*.1+pow(ribbon,12.)*2.2*.15;color=vec4(enc(clamp(linear*80./203.,0.,1.)),1.);}`;
function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
gl.linkProgram(program);
gl.useProgram(program);
let time = 0,
  audio = 0,
  pulse = 0;
wallpaper.on("signal", () => pulse++);
wallpaper.on("frame", (frame) => {
  time += frame.dt;
  audio += (frame.audio.rms - audio) * 0.16;
  gl.uniform1f(gl.getUniformLocation(program, "time"), time);
  gl.uniform1f(
    gl.getUniformLocation(program, "gain"),
    1 + audio * 4 + Math.exp(-(time % 4) * 2) * 0.12,
  );
  gl.uniform1f(gl.getUniformLocation(program, "pulse"), pulse);
  gl.uniform1f(
    gl.getUniformLocation(program, "seconds"),
    frame.date.getHours() * 3600 +
      frame.date.getMinutes() * 60 +
      frame.date.getSeconds(),
  );
  gl.uniform2f(
    gl.getUniformLocation(program, "pointer"),
    frame.pointer.x,
    frame.pointer.y,
  );
  gl.drawArrays(gl.TRIANGLES, 0, 3);
});
