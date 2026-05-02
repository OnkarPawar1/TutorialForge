/**
 * document-builder.js — Merge extracted frames with parsed transcript segments
 */

const DocumentBuilder = {
  /**
   * Build document model by merging frames with transcript segments.
   * 
   * @param {Array} frames - [{ time, dataURL }]
   * @param {Array} segments - [{ time, text }]
   * @param {string} placement - 'above' or 'below'
   * @returns {Array} - ordered document blocks
   *   [{ type: 'screenshot', time, dataURL }, { type: 'text', time, text }, ...]
   */
  build(frames, segments, placement = 'above') {
    if (!segments.length && !frames.length) return [];

    // If segments have timestamps, match frames to nearest segment
    const hasTimestamps = segments.some(s => s.time !== null);

    if (hasTimestamps && frames.length > 0) {
      return this._buildWithTimestamps(frames, segments, placement);
    }

    // No timestamps in transcript — evenly distribute frames
    if (frames.length > 0) {
      return this._buildWithoutTimestamps(frames, segments, placement);
    }

    // No frames at all — just text blocks
    return segments.map(s => ({
      type: 'text',
      time: s.time,
      text: s.text
    }));
  },

  /**
   * Build with timestamp matching
   */
  _buildWithTimestamps(frames, segments, placement) {
    const blocks = [];

    // For each segment, find frames that belong to it
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segTime = seg.time !== null ? seg.time : 0;
      const nextSegTime = (i + 1 < segments.length && segments[i + 1].time !== null)
        ? segments[i + 1].time
        : Infinity;

      // Find all frames in range [segTime, nextSegTime)
      const matchedFrames = frames.filter(f => f.time >= segTime && f.time < nextSegTime);

      if (placement === 'above') {
        // Screenshots first, then text
        for (const frame of matchedFrames) {
          blocks.push({
            type: 'screenshot',
            time: frame.time,
            dataURL: frame.dataURL
          });
        }
        blocks.push({ type: 'text', time: seg.time, text: seg.text });
      } else {
        // Text first, then screenshots
        blocks.push({ type: 'text', time: seg.time, text: seg.text });
        for (const frame of matchedFrames) {
          blocks.push({
            type: 'screenshot',
            time: frame.time,
            dataURL: frame.dataURL
          });
        }
      }
    }

    // Handle any leftover frames that didn't match any segment
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
      blocks.push({ type: 'screenshot', time: frame.time, dataURL: frame.dataURL });
    }

    return blocks;
  },

  /**
   * Build without timestamps — distribute frames evenly among text segments
   */
  _buildWithoutTimestamps(frames, segments, placement) {
    const blocks = [];

    if (segments.length === 0) {
      // Only frames
      for (const frame of frames) {
        blocks.push({ type: 'screenshot', time: frame.time, dataURL: frame.dataURL });
      }
      return blocks;
    }

    // Distribute frames evenly
    const framesPerSegment = Math.ceil(frames.length / segments.length);
    let frameIdx = 0;

    for (let i = 0; i < segments.length; i++) {
      const segFrames = frames.slice(frameIdx, frameIdx + framesPerSegment);
      frameIdx += framesPerSegment;

      if (placement === 'above') {
        for (const f of segFrames) {
          blocks.push({ type: 'screenshot', time: f.time, dataURL: f.dataURL });
        }
        blocks.push({ type: 'text', time: null, text: segments[i].text });
      } else {
        blocks.push({ type: 'text', time: null, text: segments[i].text });
        for (const f of segFrames) {
          blocks.push({ type: 'screenshot', time: f.time, dataURL: f.dataURL });
        }
      }
    }

    // Remaining frames
    while (frameIdx < frames.length) {
      blocks.push({ type: 'screenshot', time: frames[frameIdx].time, dataURL: frames[frameIdx].dataURL });
      frameIdx++;
    }

    return blocks;
  }
};
