// Also read by scene.lua. Keep these four integer arrays as the shared workload table.
// Values: maximum ray steps, field octaves, lights, composition seed.
globalThis.STRESS_STUDIO_PRESETS = {
  light: [12, 2, 4, 173],
  standard: [24, 3, 8, 173],
  heavy: [40, 4, 12, 173],
};
