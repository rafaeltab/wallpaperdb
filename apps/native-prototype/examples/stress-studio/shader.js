// One literal GLSL body: WebGL2 loads this script; Lua extracts the String.raw body.
// Host adapters supply the common uniforms and mediaColor(), then call studio().
globalThis.STRESS_STUDIO_FRAGMENT = String.raw`
#define time params.w
const float TAU = 6.28318530718;
const vec2 ASPECT = vec2(1.77777777778, 1.0);

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031 + STRESS_SEED * .001);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise2(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(cell), hash21(cell + vec2(1, 0)), f.x),
             mix(hash21(cell + vec2(0, 1)), hash21(cell + vec2(1)), f.x), f.y);
}

float field(vec2 p) {
  float sum = 0.0, weight = .5;
  for (int i = 0; i < 4; i++) {
    if (i >= int(params.y)) break;
    sum += noise2(p) * weight;
    p = mat2(.8, .6, -.6, .8) * p * 2.03 + vec2(8.3, 2.8);
    weight *= .5;
  }
  return sum;
}

mat2 rotation(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }

vec3 palette(float x) {
  return .52 + .48 * cos(TAU * (x + vec3(.04, .37, .63)));
}

vec2 nearest(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

vec2 sculpture(vec3 p) {
  float turn = time * .13 + STRESS_SEED * .017 + pulse * .13;
  p.xz = rotation(turn) * p.xz;
  vec3 q = p - vec3(-.66, .28 + .12 * sin(time * .51), .08);
  vec2 hit = vec2(length(q) - .54, 1);
  q = p - vec3(.75, -.26, -.18);
  q.xy = rotation(time * .24) * q.xy;
  vec3 box = abs(q) - vec3(.32);
  hit = nearest(hit, vec2(length(max(box, 0.0)) +
    min(max(box.x, max(box.y, box.z)), 0.0) - .085, 2));
  q = p - vec3(.07, -.02, .14);
  q.yz = rotation(.88 + .2 * sin(time * .2)) * q.yz;
  hit = nearest(hit, vec2(length(vec2(length(q.xz) - 1.03, q.y)) - .075, 3));
  q = p - vec3(.34 * sin(time * .37), .89, .37 * cos(time * .37));
  return nearest(hit, vec2(length(q) - .19, 4));
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(.003, 0);
  return normalize(vec3(
    sculpture(p + e.xyy).x - sculpture(p - e.xyy).x,
    sculpture(p + e.yxy).x - sculpture(p - e.yxy).x,
    sculpture(p + e.yyx).x - sculpture(p - e.yyx).x));
}

float line(vec2 p, vec2 a, vec2 b, float width) {
  vec2 ab = b - a;
  float d = length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
  return 1.0 - smoothstep(width, width + .0018, d);
}

float digit(vec2 p, int value) {
  int mask = value == 0 ? 63 : value == 1 ? 6 : value == 2 ? 91 :
    value == 3 ? 79 : value == 4 ? 102 : value == 5 ? 109 :
    value == 6 ? 125 : value == 7 ? 7 : value == 8 ? 127 : 111;
  float ink = 0.0;
  if ((mask & 1) != 0) ink = max(ink, line(p, vec2(0, 1), vec2(.5, 1), .043));
  if ((mask & 2) != 0) ink = max(ink, line(p, vec2(.5, 1), vec2(.5, .5), .043));
  if ((mask & 4) != 0) ink = max(ink, line(p, vec2(.5, .5), vec2(.5, 0), .043));
  if ((mask & 8) != 0) ink = max(ink, line(p, vec2(0), vec2(.5, 0), .043));
  if ((mask & 16) != 0) ink = max(ink, line(p, vec2(0), vec2(0, .5), .043));
  if ((mask & 32) != 0) ink = max(ink, line(p, vec2(0, .5), vec2(0, 1), .043));
  if ((mask & 64) != 0) ink = max(ink, line(p, vec2(0, .5), vec2(.5), .043));
  return ink;
}

vec3 studio(vec2 uv) {
  vec2 p = (uv - .5) * ASPECT;
  vec2 mouse = (pointer.xy - .5) * ASPECT * vec2(1, -1);
  float level = clamp(audio, 0.0, 1.0);
  float civil = date.z * .007 + date.y * .001;
  float mist = field(p * 3.2 + vec2(time * .031, -time * .017));
  float folds = field(p * 5.0 + mist * 2.4 - vec2(time * .021, 0));
  vec3 tint = palette(.58 + folds * .22 + civil + pulse * .037);
  vec3 result = vec3(.012, .019, .034) + tint * (.045 + mist * mist * .25);
  if (hasMedia != 0) result = mix(result, mediaColor(uv), .55);

  vec2 starCell = floor(uv * vec2(160, 90));
  vec2 starLocal = fract(uv * vec2(160, 90)) - .5;
  float star = (1.0 - smoothstep(.01, .075, length(starLocal))) *
    step(.969, hash21(starCell)) * (.6 + .4 * sin(time + hash21(starCell) * TAU));
  result += star * vec3(.38, .49, .64);

  vec3 origin = vec3(mouse * .16, 4.7);
  vec3 ray = normalize(vec3(p * 2.25, -3.25));
  float travel = 1.5;
  vec2 hit = vec2(1, 0);
  for (int i = 0; i < 40; i++) {
    if (i >= int(params.x)) break;
    hit = sculpture(origin + ray * travel);
    if (hit.x < .0025 || travel > 8.0) break;
    travel += max(hit.x * .82, .006);
  }
  if (hit.x < .009 && travel < 8.0) {
    vec3 point = origin + ray * travel;
    vec3 normal = normalAt(point);
    vec3 albedo = palette(hit.y * .13 + civil + pulse * .037);
    vec3 surface = albedo * (.06 + .11 * mist);
    float roughness = hit.y == 3.0 ? 74.0 : 38.0;
    for (int i = 0; i < 12; i++) {
      if (i >= int(params.z)) break;
      float fi = float(i), phase = hash21(vec2(fi, 81)) * TAU + time * .1;
      vec3 light = vec3(cos(phase) * 3.4, sin(phase * 1.7) * 2.6,
        1.7 + hash21(vec2(fi, 31)) * 2.0);
      vec3 offset = light - point;
      float attenuation = 1.4 / (1.0 + dot(offset, offset) * .25);
      vec3 direction = normalize(offset);
      float diffuse = max(dot(normal, direction), 0.0);
      float specular = pow(max(dot(normal, normalize(direction - ray)), 0.0), roughness);
      vec3 lamp = palette(fi * .127 + .12) * (1.0 + level * 1.6);
      surface += lamp * (albedo * diffuse * .19 + specular * .58) * attenuation;
    }
    float rim = pow(1.0 - max(dot(normal, -ray), 0.0), 3.0);
    result = surface + tint * rim * .6;
  }

  // The same translucent foreground rings, spectrum and clock in both engines.
  float radius = length(p - mouse * .24);
  float orbit = 1.0 - smoothstep(.001, .003, abs(radius - .39 - level * .025));
  float echo = exp(-abs(radius - fract(time * .13 + pulse * .17) * .92) * 90.0);
  result += tint * (orbit * .16 + echo * .055);
  vec2 cursor = p - mouse;
  result += vec3(.16, .27, .34) * exp(-dot(cursor, cursor) * 160.0);

  int bandIndex = int(clamp(floor((uv.x - .12) / .0475), 0.0, 15.0));
  float bandHeight = .006 + clamp(bands[bandIndex], 0.0, 1.0) * .075;
  float bars = step(.12, uv.x) * step(uv.x, .88) *
    step(.08, fract((uv.x - .12) / .0475)) *
    step(.06, uv.y) * step(uv.y, .06 + bandHeight);
  result += palette(uv.x * .4 + civil) * bars * .35;

  if (uv.x > .07 && uv.x < .185 && uv.y > .84 && uv.y < .915) {
    vec2 clock = (uv - vec2(.075, .845)) * vec2(28.0, 16.0);
    int hours = int(date.w / 3600.0), minutes = int(mod(date.w / 60.0, 60.0));
    float ink = digit(clock, hours / 10) + digit(clock - vec2(.72, 0), hours % 10) +
      digit(clock - vec2(1.72, 0), minutes / 10) +
      digit(clock - vec2(2.44, 0), minutes % 10);
    float colon = (1.0 - smoothstep(.045, .07, length(clock - vec2(1.47, .28)))) +
      (1.0 - smoothstep(.045, .07, length(clock - vec2(1.47, .72))));
    result += vec3(.47, .58, .65) * min(ink + colon, 1.0) * .55;
  }
  float progress = step(uv.x, .075 + mod(date.w, 60.0) / 60.0 * .105) *
    step(.075, uv.x) * (1.0 - smoothstep(.0008, .002, abs(uv.y - .827)));
  result += tint * progress * .55;
  result *= .76 + .24 * max(0.0, 1.0 - dot(p * .62, p * .62));
  // Keep this workload in SDR's range even when its presenter uses an HDR surface.
  return clamp(result, vec3(0), vec3(2.35));
}
`;
