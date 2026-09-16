# Share Biography parsing and validation between User and Web

The `@wallpaperdb/profile-markdown` package owns Biography parsing, supported Markdown syntax, URL rules, and `wallpaper:` image recognition. User validates authored Markdown with this policy and checks embedded wallpaper ownership against its local event-fed projection. Web uses the same policy and remark plugin with React Markdown, GFM, and sanitization to render React elements. Authored Markdown is the only persisted representation.

This keeps acceptance and rendering rules together while preserving User's authority over wallpaper ownership. HTTPS destinations are normalized and pass through a warning dialog before navigation. The renderer permits only dedicated wallpaper components for images; arbitrary remote images and raw HTML are rejected.

Newly published wallpapers may be temporarily unavailable for embedding until their ownership events arrive. The current publication signal is `wallpaper.uploaded`, which also feeds the public catalog; the application does not yet publish deletion or unpublication events. A future lifecycle must extend the ownership projection and embed availability checks together.
