/**
 * video-processor.js — Extract frames from video at FULL NATIVE RESOLUTION
 * using Canvas API. Always captures at the video's actual pixel dimensions
 * and uses lossless PNG for maximum quality.
 */

const VideoProcessor = {
  _video: null,
  _canvas: null,
  _ctx: null,
  _frames: [], // [{ time: <seconds>, dataURL: <string>, width, height }]
  _aborted: false,

  /**
   * Initialize with a video file
   */
  async loadVideo(file) {
    this._frames = [];
    this._aborted = false;

    const video = document.getElementById('hiddenVideo');
    const canvas = document.getElementById('hiddenCanvas');
    const ctx = canvas.getContext('2d');

    this._video = video;
    this._canvas = canvas;
    this._ctx = ctx;

    // Create object URL
    const url = Utils.createObjectURL(file);
    video.src = url;

    // Wait for metadata
    return new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        resolve({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          url: url
        });
      };
      video.onerror = () => reject(new Error('Failed to load video'));
    });
  },

  /**
   * Extract frames at the given interval (seconds).
   * ALWAYS captures at full native video resolution — no downscaling.
   * @param {number} interval - seconds between captures
   * @param {number} quality - quality 0-1 (only used if format is JPEG)
   * @param {number} maxWidth - ignored now, kept for API compatibility
   * @param {function} onProgress - callback(percent, frameCount)
   * @returns {Array<{time, dataURL, width, height}>}
   */
  async extractFrames(interval, quality = 0.95, maxWidth = 9999, onProgress = null) {
    const video = this._video;
    const canvas = this._canvas;

    if (!video || !video.duration) {
      throw new Error('No video loaded');
    }

    this._frames = [];
    this._aborted = false;
    const duration = video.duration;
    const totalFrames = Math.floor(duration / interval) + 1;

    // ALWAYS use full native resolution — no scaling at all
    const drawWidth = video.videoWidth;
    const drawHeight = video.videoHeight;
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    for (let i = 0; i < totalFrames; i++) {
      if (this._aborted) break;

      const time = i * interval;
      if (time > duration) break;

      try {
        const dataURL = await this._captureFrame(time, drawWidth, drawHeight, quality);
        this._frames.push({ time, dataURL, width: drawWidth, height: drawHeight });
      } catch (e) {
        console.warn(`Failed to capture frame at ${time}s:`, e);
      }

      if (onProgress) {
        const percent = Math.round(((i + 1) / totalFrames) * 100);
        onProgress(percent, this._frames.length);
      }

      // Yield to UI thread
      await Utils.delay(30);
    }

    return this._frames;
  },

  /**
   * Capture a single frame at the given time.
   * ALWAYS uses PNG for lossless quality — no JPEG compression artifacts.
   */
  _captureFrame(time, width, height, quality) {
    return new Promise((resolve, reject) => {
      const video = this._video;
      const ctx = this._ctx;

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        try {
          // Draw at full native resolution
          ctx.drawImage(video, 0, 0, width, height);
          // ALWAYS use PNG — zero compression, pixel-perfect quality
          const dataURL = this._canvas.toDataURL('image/png');
          resolve(dataURL);
        } catch (e) {
          reject(e);
        }
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;

      // Generous timeout for large videos
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        reject(new Error('Seek timeout'));
      }, 15000);
    });
  },

  /**
   * Abort extraction
   */
  abort() {
    this._aborted = true;
  },

  /**
   * Get extracted frames
   */
  getFrames() {
    return this._frames;
  },

  /**
   * Cleanup
   */
  cleanup() {
    if (this._video && this._video.src) {
      Utils.revokeObjectURL(this._video.src);
      this._video.src = '';
    }
    this._frames = [];
  }
};
