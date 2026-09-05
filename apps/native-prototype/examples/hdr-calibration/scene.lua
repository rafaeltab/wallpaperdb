function frame(t, input) return {1, input.audio, input.pulse, 0} end
fragment = [[
void main(){
  float nits[8]=float[8](.1,1.,10.,80.,203.,300.,400.,800.);
  float n=nits[min(int(uv.x*8.),7)];
  vec3 c=vec3(n/80.);
  if(uv.y<.12)c=vec3(.2,.015,.12)*(1.+sin(time+uv.x*12.)*.5+audio);
  color=vec4(c,1.);
}
]]
