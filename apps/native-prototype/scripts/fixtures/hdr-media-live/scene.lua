-- Verification fixture outside the default examples/library. Generate media with
-- make native-lab-assets. Reuse the original file; never re-encode its patches.
media = "../../../examples/HDR reference.mkv"

function frame(t, input)
  return {t, 0, 0, 0}
end

-- Keep patch values intact while exercising the live Lua/GLSL composition path.
fragment = [[
void main() {
  color = vec4(mediaColor(uv), 1);
}
]]
