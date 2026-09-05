-- Reuse the native clock/composition program with a still image as its media.
-- Loading a sibling Lua file is intentional: bundles are trusted local programs.
local directory = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
dofile(directory .. "../tide/scene.lua")
media = "background.png"
