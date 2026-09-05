-- Real Lua state controls the GLSL scene. Inputs have no dependency on a browser.
local smoothed = 0
function frame(t, input)
  smoothed = smoothed + (input.audio - smoothed) * 0.16
  local beat = math.exp(-((t % 4) * 2)) * 0.12
  return {1 + smoothed * 4 + beat, input.x, input.y, input.hdr and 6 or 2.2}
end
fragment = [[
void main() {
  vec2 p=(uv-.5)*vec2(1.7778,1.);
  vec2 m=(pointer.xy-.5)*vec2(1.7778,-1.);
  float wave=sin(p.x*4.+time*.25)*.15+sin(p.x*7.-time*.18)*.06;
  float ribbon=exp(-abs(p.y-wave)*14.);
  vec3 tint=.5+.5*cos(vec3(0.,2.1,4.2)+p.x*2.+time*.06+date.w*.00001);
  float glow=exp(-length(p-m*.3)*3.5);
  float ring=exp(-abs(length(p-m)-mod(time+floor(pulse)*.71,4.)*.2)*60.);
  vec3 base=vec3(.006,.008,.018)+tint*ribbon*.65+vec3(.15,.3,.4)*glow;
  color=vec4(base*params.x+ring*tint*.1+pow(ribbon,12.)*params.w*.15,1.);
}
]]
