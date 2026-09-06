#ifndef WALLPAPERDB_FRAME_PACING_H
#define WALLPAPERDB_FRAME_PACING_H

#include <stdbool.h>
#include <stdint.h>

// Playback eligibility and callback participation are independent: covered
// keep-playing outputs render, but cannot hold a visible output's callback
// barrier. The caller destroys callbacks removed from callback_outputs.
typedef struct {
  uint32_t active, callback_outputs, pending;
  double period, next_frame, wait_deadline;
  bool waiting;
} FramePacer;

static inline void frame_pacer_init(FramePacer *p, int fps, double now) {
  *p = (FramePacer){.period = 1.0 / fps, .next_frame = now};
}

static inline void frame_pacer_set_outputs(FramePacer *p, uint32_t active,
                                           uint32_t callback_outputs) {
  p->active = active;
  p->callback_outputs = active & callback_outputs;
  p->pending &= p->callback_outputs;
  if (!p->pending)
    p->waiting = false;
}

static inline void frame_pacer_set_active(FramePacer *p, uint32_t active) {
  frame_pacer_set_outputs(p, active, active);
}

static inline bool frame_pacer_ready(const FramePacer *p, double now) {
  return p->active && !p->pending && now >= p->next_frame;
}

static inline void frame_pacer_submit(FramePacer *p, double now) {
  p->pending = p->callback_outputs;
  p->next_frame = now + p->period;
  p->waiting = false;
}

// Arm wait accounting only after rendering and output swaps have returned.
// Earlier deadlines belong to rendering, not to callback wait.
static inline void frame_pacer_rendered(FramePacer *p, double now) {
  p->waiting = p->pending != 0;
  p->wait_deadline = p->next_frame;
  if (p->wait_deadline <= now) {
    uint64_t elapsed = 1 + (uint64_t)((now - p->wait_deadline) / p->period);
    p->wait_deadline += elapsed * p->period;
  }
}

static inline uint64_t frame_pacer_wait_deadlines(FramePacer *p, double now) {
  if (!p->waiting || !p->pending || now < p->wait_deadline)
    return 0;
  uint64_t elapsed = 1 + (uint64_t)((now - p->wait_deadline) / p->period);
  p->wait_deadline += elapsed * p->period;
  return elapsed;
}

static inline void frame_pacer_done(FramePacer *p, unsigned output) {
  p->pending &= ~(UINT32_C(1) << output);
  if (!p->pending)
    p->waiting = false;
}

#endif
