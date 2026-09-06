#ifndef WALLPAPERDB_MEDIA_TEXTURE_H
#define WALLPAPERDB_MEDIA_TEXTURE_H

#include <stdbool.h>
#include <stdint.h>

// The mpv clock owns when a queued video frame is due. This state only owns
// texture retention and one submission acknowledgement per texture update.
typedef struct {
  bool ready, submission_pending;
  uint64_t updates, reuses, submissions;
} MediaTexture;

static inline bool media_texture_begin_frame(MediaTexture *texture,
                                             bool frame_queued) {
  if (!frame_queued && texture->ready)
    texture->reuses++;
  return frame_queued;
}

// Call only after a successful libmpv render; failure keeps the prior texture
// state and cannot earn a submission acknowledgement.
static inline void media_texture_rendered(MediaTexture *texture) {
  texture->ready = true;
  texture->submission_pending = true;
  texture->updates++;
}

// Call once after the whole output group, never once per output or scene-only
// redraw. This reports a window-buffer submission, not a physical presentation.
static inline bool media_texture_submitted(MediaTexture *texture,
                                           bool any_output_submitted) {
  if (!any_output_submitted || !texture->submission_pending)
    return false;
  texture->submission_pending = false;
  texture->submissions++;
  return true;
}

#endif
