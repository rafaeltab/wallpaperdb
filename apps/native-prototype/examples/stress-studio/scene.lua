-- Disposable comparison scene. Both hosts read the same shader and workload table.
local directory = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
local function read(name)
  local file = assert(io.open(directory .. name, "rb"))
  local value = file:read("*a")
  file:close()
  return value
end

local preset = stress_preset or "standard"
assert(preset:match("^[a-z]+$"), "Invalid stress preset")
local entry = assert(read("workloads.js"):match(preset .. "%s*:%s*%[([^%]]+)%]"),
  "Unknown stress preset: " .. preset)
local workload = {}
for number in entry:gmatch("%d+") do workload[#workload + 1] = tonumber(number) end
assert(#workload == 4 and workload[1] <= 40 and workload[2] <= 4 and workload[3] <= 12,
  "Stress workload exceeds its fixed shader bounds")
local seed = workload[4]
local ffi = require("ffi")
ffi.cdef[[
  struct stress_timespec { long tv_sec; long tv_nsec; };
  int clock_gettime(int clockid, struct stress_timespec *value);
]]
local stamp = ffi.new("struct stress_timespec[1]")

if stress_media then media = (stress_asset_prefix or "") .. "background-4k.mp4" end
function frame(_time, _input)
  assert(ffi.C.clock_gettime(0, stamp) == 0, "Cannot read the wall clock")
  workload[4] = tonumber(stamp[0].tv_sec) % 4096 + tonumber(stamp[0].tv_nsec) / 1e9
  return workload
end

fragment = "#define STRESS_SEED " .. seed .. ".0\n" ..
  assert(read("shader.js"):match("String%.raw`(.*)`;"), "Shared GLSL is missing") ..
  "\nvoid main() { color = vec4(studio(uv), 1.0); }\n"
