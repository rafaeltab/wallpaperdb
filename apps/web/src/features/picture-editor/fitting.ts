/** Coalesce only short-frame runs. Retained frames keep the exact elapsed interval. */
export function pictureAnimationFramePlan(durations: readonly number[], minimumInterval: number) {
  const maximumDuration = 0xffffff;
  if (
    !durations.length ||
    !Number.isInteger(minimumInterval) ||
    minimumInterval < 0 ||
    minimumInterval > maximumDuration ||
    durations.some(
      (duration) => !Number.isInteger(duration) || duration < 1 || duration > maximumDuration
    )
  )
    throw new Error('Picture frame timing cannot be preserved.');
  const frames: Array<{ index: number; duration: number }> = [];
  for (let index = 0; index < durations.length; ) {
    if (durations[index] >= minimumInterval) {
      frames.push({ index, duration: durations[index++] });
      continue;
    }
    const start = frames.length;
    while (index < durations.length && durations[index] < minimumInterval) {
      const frame = { index, duration: durations[index++] };
      while (
        index < durations.length &&
        durations[index] < minimumInterval &&
        frame.duration < minimumInterval &&
        frame.duration + durations[index] <= maximumDuration
      )
        frame.duration += durations[index++];
      const previous = frames.at(-1);
      if (
        frame.duration < minimumInterval &&
        frames.length > start &&
        previous &&
        previous.duration + frame.duration <= maximumDuration
      )
        previous.duration += frame.duration;
      else frames.push(frame);
    }
  }
  if (frames.length === 1 && durations.length > 1) {
    frames[0].duration -= durations[durations.length - 1];
    frames.push({ index: durations.length - 1, duration: durations[durations.length - 1] });
  }
  return frames;
}
