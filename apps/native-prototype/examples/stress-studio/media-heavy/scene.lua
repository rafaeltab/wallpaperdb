local directory = debug.getinfo(1, "S").source:sub(2):match("(.*/)")
stress_preset = "heavy"
stress_media = true
stress_asset_prefix = "../"
dofile(directory .. "../scene.lua")
