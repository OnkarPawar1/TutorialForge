/**
 * document-builder.js — Merge extracted frames with parsed transcript segments.
 * Now uses objectURLs (from FrameStore) instead of data URLs.
 */

const DocumentBuilder = {
  /**
   * Build document model by merging frames with transcript segments.
   * 
   * @param {Array} frames - [{ time, url (objectURL), width, height }]
   * @param {Array} segments - [{ time, text }]
   * @param {string} placement - 'above' or 'below'
   * @returns {Array} - ordered document blocks
   */
  build(frames, segments, placement = 'above') {
    if (!segments.length && !frames.length) return [];

    const hasTimestamps = segments.some(s => s.time !== null);

    if (hasTimestamps && frames.length > 0) {
      return this._buildWithTimestamps(frames, segments, placement);
    }

    if (frames.length > 0) {
      return this._buildWithoutTimestamps(frames, segments, placement);
    }

    return segments.map(s => ({
      type: 'text',
      time: s.time,
      text: s.text
    }));
  },

  _buildWithTimestamps(frames, segments, placement) {
    const blocks = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segTime = seg.time !== null ? seg.time : 0;
      const nextSegTime = (i + 1 < segments.length && segments[i + 1].time !== null)
        ? segments[i + 1].time
        : Infinity;

      const matchedFrames = frames.filter(f => f.time >= segTime && f.time < nextSegTime);

      if (placement === 'above') {
        for (const frame of matchedFrames) {
          blocks.push({
            type: 'screenshot',
            time: frame.time,
            url: frame.url,
            width: frame.width,
            height: frame.height
          });
        }
        blocks.push({ type: 'text', time: seg.time, text: seg.text });
      } else {
        blocks.push({ type: 'text', time: seg.time, text: seg.text });
        for (const frame of matchedFrames) {
          blocks.push({
            type: 'screenshot',
            time: frame.time,
            url: frame.url,
            width: frame.width,
            height: frame.height
          });
        }
      }
    }

    // Leftover frames
    const allMatchedTimes = new Set();
    for (let i = 0; i < segments.length; i++) {
      const segTime = segments[i].time !== null ? segments[i].time : 0;
      const nextSegTime = (i + 1 < segments.length && segments[i + 1].time !== null)
        ? segments[i + 1].time
        : Infinity;
      frames.filter(f => f.time >= segTime && f.time < nextSegTime)
        .forEach(f => allMatchedTimes.add(f.time));
    }
    const unmatched = frames.filter(f => !allMatchedTimes.has(f.time));
    for (const frame of unmatched) {
      blocks.push({ type: 'screenshot', time: frame.time, url: frame.url, width: frame.width, height: frame.height });
    }

    return blocks;
  },

  _buildWithoutTimestamps(frames, segments, placement) {
    const blocks = [];

    if (segments.length === 0) {
      for (const frame of frames) {
        blocks.push({ type: 'screenshot', time: frame.time, url: frame.url, width: frame.width, height: frame.height });
      }
      return blocks;
    }

    const framesPerSegment = Math.ceil(frames.length / segments.length);
    let frameIdx = 0;

    for (let i = 0; i < segments.length; i++) {
      const segFrames = frames.slice(frameIdx, frameIdx + framesPerSegment);
      frameIdx += framesPerSegment;

      if (placement === 'above') {
        for (const f of segFrames) {
          blocks.push({ type: 'screenshot', time: f.time, url: f.url, width: f.width, height: f.height });
        }
        blocks.push({ type: 'text', time: null, text: segments[i].text });
      } else {
        blocks.push({ type: 'text', time: null, text: segments[i].text });
        for (const f of segFrames) {
          blocks.push({ type: 'screenshot', time: f.time, url: f.url, width: f.width, height: f.height });
        }
      }
    }

    while (frameIdx < frames.length) {
      blocks.push({ type: 'screenshot', time: frames[frameIdx].time, url: frames[frameIdx].url, width: frames[frameIdx].width, height: frames[frameIdx].height });
      frameIdx++;
    }

    return blocks;
  }
};
