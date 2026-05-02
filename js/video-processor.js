/**
 * video-processor.js — Extract frames from video at intervals using Canvas API
 */

const VideoProcessor = {
  _video: null,
  _canvas: null,
  _ctx: null,
  _frames: [], // [{ time: <seconds>, dataURL: <string> }]
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
   * @param {number} interval - seconds between captures
   * @param {number} quality - JPEG quality 0-1
   * @param {number} maxWidth - max image width
   * @param {function} onProgress - callback(percent, frameCount)
   * @returns {Array<{time, dataURL}>}
   */
  async extractFrames(interval, quality = 0.8, maxWidth = 800, onProgress = null) {
    const video = this._video;
    const canvas = this._canvas;
    const ctx = this._ctx;

    if (!video || !video.duration) {
      throw new Error('No video loaded');
    }

    this._frames = [];
    this._aborted = false;
    const duration = video.duration;
    const totalFrames = Math.floor(duration / interval) + 1;

    // Scale canvas if maxWidth is smaller
    let drawWidth = video.videoWidth;
    let drawHeight = video.videoHeight;
    if (drawWidth > maxWidth) {
      const ratio = maxWidth / drawWidth;
      drawWidth = maxWidth;
      drawHeight = Math.round(video.videoHeight * ratio);
    }
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    for (let i = 0; i < totalFrames; i++) {
      if (this._aborted) break;

      const time = i * interval;
      if (time > duration) break;

      try {
        const dataURL = await this._captureFrame(time, drawWidth, drawHeight, quality);
        this._frames.push({ time, dataURL });
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
   * Capture a single frame at the given time
   */
  _captureFrame(time, width, height, quality) {
    return new Promise((resolve, reject) => {
      const video = this._video;
      const ctx = this._ctx;

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        try {
          ctx.drawImage(video, 0, 0, width, height);
          // Use PNG for high quality (>= 0.9) for sharper HD screenshots
          let dataURL;
          if (quality >= 0.9) {
            dataURL = this._canvas.toDataURL('image/png');
          } else {
            dataURL = this._canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataURL);
        } catch (e) {
          reject(e);
        }
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;

      // Longer timeout for big videos
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        reject(new Error('Seek timeout'));
      }, 10000);
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
