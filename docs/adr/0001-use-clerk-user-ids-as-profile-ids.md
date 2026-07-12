# Use Clerk user IDs as Profile IDs

WallpaperDB Profiles use the immutable Clerk user ID directly as their Profile ID. Wallpaper ownership already records this identifier, so introducing a separate internal identity would require a mapping layer and migration without providing a current product benefit; accepting the Clerk coupling keeps ownership and Profile relationships consistent.
