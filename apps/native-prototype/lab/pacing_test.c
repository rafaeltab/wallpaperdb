#include "pacing.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

static void covered_keep_playing_and_reveal(void) {
  FramePacer p;
  frame_pacer_init(&p, 120, 0.0);
  frame_pacer_set_outputs(&p, 3, 3);
  frame_pacer_submit(&p, 0.0);
  frame_pacer_done(&p, 0);
  // The covered member keeps playing without holding the visible member back.
  frame_pacer_set_outputs(&p, 3, 1);
  assert(p.active == 3 && p.callback_outputs == 1 && p.pending == 0);
  assert(frame_pacer_ready(&p, .01));
  frame_pacer_submit(&p, .01);
  assert(p.pending == 1);
  // All covered + keep-playing becomes timer-driven, with no callback.
  frame_pacer_set_outputs(&p, 3, 0);
  assert(!frame_pacer_ready(&p, .011));
  assert(frame_pacer_ready(&p, .02));
  frame_pacer_submit(&p, .02);
  frame_pacer_rendered(&p, .021);
  assert(p.pending == 0);
  assert(frame_pacer_wait_deadlines(&p, 1.0) == 0);
  // Reveal gets fresh callbacks on the next frame, not an old callback.
  frame_pacer_set_outputs(&p, 3, 3);
  assert(frame_pacer_ready(&p, .03));
  frame_pacer_submit(&p, .03);
  assert(p.pending == 3);
  frame_pacer_done(&p, 0);
  assert(!frame_pacer_ready(&p, .1));
  frame_pacer_done(&p, 1);
  assert(frame_pacer_ready(&p, .1));
}

static void pause_overrides_callback_eligibility(void) {
  FramePacer p;
  frame_pacer_init(&p, 120, 0.0);
  frame_pacer_set_outputs(&p, 3, 3);
  frame_pacer_submit(&p, 0.0);
  frame_pacer_rendered(&p, .001);
  frame_pacer_set_outputs(&p, 0, 3);
  assert(p.pending == 0 && p.callback_outputs == 0);
  assert(!frame_pacer_ready(&p, 10.0));
  assert(frame_pacer_wait_deadlines(&p, 10.0) == 0);
  // Resume with one powered-off/hidden output cannot request its callback.
  frame_pacer_set_outputs(&p, 1, 3);
  assert(frame_pacer_ready(&p, 10.0));
  frame_pacer_submit(&p, 10.0);
  assert(p.pending == 1);
}

static void rendering_is_not_callback_wait(void) {
  FramePacer p;
  frame_pacer_init(&p, 120, 0.0);
  frame_pacer_set_outputs(&p, 1, 1);
  frame_pacer_submit(&p, 0.0);
  // Even with a callback reserved, 30 ms spent rendering counts no wait slots.
  assert(frame_pacer_wait_deadlines(&p, .030) == 0);
  frame_pacer_rendered(&p, .030);
  assert(frame_pacer_wait_deadlines(&p, .031) == 0);
  // Only deadlines crossed after render returned count, without double
  // counting.
  assert(frame_pacer_wait_deadlines(&p, .034) == 1);
  assert(frame_pacer_wait_deadlines(&p, .034) == 0);
  assert(frame_pacer_wait_deadlines(&p, .043) == 1);
  frame_pacer_done(&p, 0);
  assert(frame_pacer_wait_deadlines(&p, 1.0) == 0);
  // Finishing on a deadline cannot claim a zero-duration callback wait.
  frame_pacer_submit(&p, 1.0);
  frame_pacer_rendered(&p, p.next_frame);
  assert(frame_pacer_wait_deadlines(&p, 1.0 + 1.5 / 120.0) == 0);
}

static void covered_timer_respects_fps(void) {
  for (int fps = 120; fps <= 360; fps += 120) {
    FramePacer p;
    frame_pacer_init(&p, fps, 0.0);
    frame_pacer_set_outputs(&p, 3, 0);
    for (int frame = 0; frame < 12; frame++) {
      double t = p.next_frame;
      assert(frame_pacer_ready(&p, t));
      frame_pacer_submit(&p, t);
      assert(p.pending == 0);
      assert(!frame_pacer_ready(&p, t + .99 / fps));
      assert(frame_pacer_ready(&p, t + 1.01 / fps));
    }
  }
}

int main(void) {
  covered_keep_playing_and_reveal();
  pause_overrides_callback_eligibility();
  rendering_is_not_callback_wait();
  covered_timer_respects_fps();
  FramePacer p;
  frame_pacer_init(&p, 120, 10.0);
  frame_pacer_set_active(&p, 3);
  assert(frame_pacer_ready(&p, 10.0));
  frame_pacer_submit(&p, 10.0);
  assert(p.pending == 3);
  assert(!frame_pacer_ready(&p, 11.0));
  frame_pacer_done(&p, 0);
  assert(!frame_pacer_ready(&p, 11.0));
  frame_pacer_done(&p, 1);
  assert(!frame_pacer_ready(&p, 10.001));
  assert(frame_pacer_ready(&p, 11.0));

  // A delayed compositor permits one frame, never a catch-up burst.
  frame_pacer_submit(&p, 11.0);
  frame_pacer_done(&p, 0);
  frame_pacer_done(&p, 1);
  assert(!frame_pacer_ready(&p, 11.001));
  assert(fabs(p.next_frame - (11.0 + 1.0 / 120.0)) < 1e-9);

  // Hiding the slow output removes its callback from the group barrier.
  frame_pacer_submit(&p, 12.0);
  frame_pacer_done(&p, 0);
  frame_pacer_set_active(&p, 1);
  assert(p.pending == 0);
  assert(frame_pacer_ready(&p, 12.1));
  frame_pacer_submit(&p, 12.1);
  assert(p.pending == 1);

  // Pausing/all-hidden cancels the barrier; revealing needs no old callback.
  frame_pacer_set_active(&p, 0);
  assert(p.pending == 0);
  assert(!frame_pacer_ready(&p, 20.0));
  frame_pacer_set_active(&p, 3);
  assert(frame_pacer_ready(&p, 20.0));
  frame_pacer_submit(&p, 20.0);
  assert(p.pending == 3);
  frame_pacer_done(&p, 0);
  frame_pacer_set_active(&p, 1);
  frame_pacer_set_active(&p, 3);
  assert(frame_pacer_ready(&p, 20.1));

  for (int fps = 120; fps <= 360; fps += 120) {
    frame_pacer_init(&p, fps, 0.0);
    frame_pacer_set_active(&p, 1);
    frame_pacer_submit(&p, 0.0);
    frame_pacer_done(&p, 0);
    assert(!frame_pacer_ready(&p, 0.99 / fps));
    assert(frame_pacer_ready(&p, 1.01 / fps));
  }
  puts("frame pacing: visible barrier, covered playback, pause/reveal, render "
       "attribution, and 120/240/360 FPS limits passed");
  return 0;
}
