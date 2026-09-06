-- Benchmark-only wrapper. Keep the original shared fragment and Lua setup.
local directory = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
stress_preset = "heavy"
stress_media = false
dofile(directory .. "../scene.lua")
local shared_frame = frame
local file = assert(io.open(directory .. "inputs.js", "rb"))
local source = file:read("*a")
file:close()
local function input(name, count)
  local body = assert(source:match(name .. "%s*:%s*%[([^%]]+)%]"), name .. " is missing")
  local values = {}
  for number in body:gmatch("[-%d%.]+") do values[#values + 1] = assert(tonumber(number)) end
  assert(#values == count, "Invalid input count: " .. name)
  return values
end
local fixed = {
  params = input("params", 4), pointer = input("pointer", 4),
  audio = input("audio", 1), pulse = input("pulse", 1),
  bands = input("bands", 16), date = input("date", 4),
  hasMedia = input("hasMedia", 1), seed = input("seed", 1),
}
assert(fixed.hasMedia[1] == 0, "Fixed control cannot load media")
assert(tonumber(fragment:match("#define STRESS_SEED (%d+)%.0")) == fixed.seed[1],
  "Fixed control seed differs from the shared shader")

-- The existing Linux presenter links libepoxy and calls frame() with the
-- scene program current, after writing common uniforms but before params.
-- Use its exported dispatch pointers; do not rely on optional libGL symbols.
local ffi = require("ffi")
ffi.cdef[[
extern void (*epoxy_glGetIntegerv)(unsigned int pname, int *data);
extern int (*epoxy_glGetUniformLocation)(unsigned int program, const char *name);
extern void (*epoxy_glGetUniformfv)(unsigned int program, int location, float *value);
extern void (*epoxy_glGetUniformiv)(unsigned int program, int location, int *value);
extern void (*epoxy_glUniform1f)(int location, float value);
extern void (*epoxy_glUniform1fv)(int location, int count, const float *value);
extern void (*epoxy_glUniform4f)(int location, float x, float y, float z, float w);
]]
local program
local locations = {}
local zeros = ffi.new("float[16]", fixed.bands)
local floats = ffi.new("float[16]")
local integer = ffi.new("int[1]")
local calls = 0
local function location(name)
  if locations[name] == nil then
    locations[name] = ffi.C.epoxy_glGetUniformLocation(program, name)
    assert(locations[name] >= 0, "Fixed control uniform missing: " .. name)
  end
  return locations[name]
end
local function set4(name)
  local v = fixed[name]
  ffi.C.epoxy_glUniform4f(location(name), v[1], v[2], v[3], v[4])
end
local function read_float(name, count)
  ffi.C.epoxy_glGetUniformfv(program, location(name), floats)
  local values = {}
  for i = 1, count do values[i] = tonumber(floats[i - 1]) end
  return values
end
local function verify_uniforms()
  local actual = {
    params = read_float("params", 4), pointer = read_float("pointer", 4),
    audio = read_float("audio", 1), pulse = read_float("pulse", 1),
    date = read_float("date", 4), bands = {},
  }
  for i = 0, 15 do actual.bands[i + 1] = read_float("bands[" .. i .. "]", 1)[1] end
  ffi.C.epoxy_glGetUniformiv(program, location("hasMedia"), integer)
  actual.hasMedia = {tonumber(integer[0])}
  local entries = {}
  for _, name in ipairs({"params", "pointer", "audio", "pulse", "date", "bands", "hasMedia"}) do
    for i, number in ipairs(actual[name]) do
      assert(number == fixed[name][i], "Fixed control uniform mismatch: " .. name)
    end
    entries[#entries + 1] = '"' .. name .. '":[' .. table.concat(actual[name], ",") .. ']'
  end
  io.stderr:write('WDB_FIXED_HEAVY_INPUTS {"schema":1,"verified":true,' ..
    '"method":"OpenGL getUniform during warmup","draw":2,"media":false,' ..
    '"seed":' .. fixed.seed[1] .. ',"inputs":{' .. table.concat(entries, ",") .. '}}\n')
  io.stderr:flush()
end

function frame(time, inputs)
  -- Retain the original per-frame Lua clock read and table handling, then
  -- replace its phase. None of the original shader source is changed.
  local params = shared_frame(time, inputs)
  for i = 1, 3 do assert(params[i] == fixed.params[i], "Shared heavy preset changed") end
  params[4] = fixed.params[4]
  if not program then
    ffi.C.epoxy_glGetIntegerv(0x8B8D, integer) -- GL_CURRENT_PROGRAM
    program = tonumber(integer[0])
    assert(program > 0, "Fixed control needs the current native scene program")
  end
  set4("pointer")
  set4("date")
  ffi.C.epoxy_glUniform1f(location("audio"), fixed.audio[1])
  ffi.C.epoxy_glUniform1f(location("pulse"), fixed.pulse[1])
  ffi.C.epoxy_glUniform1fv(location("bands[0]"), 16, zeros)
  calls = calls + 1
  -- At call two, params still holds the previous frame's identical fixed
  -- values; the presenter writes the returned params again after this call.
  if calls == 2 then verify_uniforms() end
  return params
end
