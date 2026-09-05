-- A native interpretation of Afterglow: one video decoder plus an audio-reactive
-- shader and a civil-time clock. The HTML version remains independently runnable.
media = "background.mp4"
local level = 0
function frame(t, input)
  level = level + (input.audio - level) * 0.16
  return {level, input.hdr and 5 or 1, 0, 0}
end
fragment = [[
float hand(vec2 p, float angle, float reach) {
  vec2 direction=vec2(sin(angle),cos(angle));
  return smoothstep(.004,.001,length(p-direction*clamp(dot(p,direction),0.,reach)));
}
void main() {
  vec2 p=uv;
  vec3 image=mediaColor(clamp(p+(pointer.xy-.5)*.008,0.,1.))*.65;
  float wave=.31+sin(p.x*18.+time*.7)*(0.016+params.x*.2);
  float band=bands[int(clamp(p.x*16.,0.,15.))];
  float line=exp(-abs(p.y-wave-band*.08)*350.);
  vec3 tint=.5+.5*cos(vec3(0.,2.,4.)+floor(pulse)*.8+date.z*.03);
  vec2 clock=(p-vec2(.82,.74))*vec2(1.7778,1.);
  float ring=exp(-abs(length(clock)-.105)*650.);
  float seconds=date.w;
  float clockInk=max(hand(clock,seconds/43200.*6.283185,.058),
    max(hand(clock,seconds/3600.*6.283185,.088),hand(clock,seconds/60.*6.283185,.095)*.45));
  image+=tint*(line*.6+ring*.35+clockInk*.8)*params.y;
  color=vec4(image,1);
}
]]
