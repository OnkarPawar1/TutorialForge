/**
 * video-processor.js — Extract frames using Canvas API.
 * 
 * KEY ARCHITECTURE: Uses Blobs instead of data URLs.
 * - canvas.toBlob() → Blob (browser-managed memory, NOT in JS heap)
 * - FrameStore manages Blob lifecycle + creates lightweight objectURLs
 * - JPEG at 92% quality: 1920×1080 = ~200KB per frame (vs ~6MB for PNG data URL)
 * - 360 frames (1hr @10s) = ~72MB total (vs 2.2GB with old approach)
 */

const VideoProcessor = {
  _video: null,
  _canvas: null,
  _ctx: null,
  _frames: [], // [{ time, url (objectURL), width, height }]
  _aborted: false,

  /**
   * Initialize with a video file
   */
  async loadVideo(file) {
    // Cleanup previous
    FrameStore.cleanup();
    this._frames = [];
    this._aborted = false;

    const video = document.getElementById('hiddenVideo');
    const canvas = document.getElementById('hiddenCanvas');
    const ctx = canvas.getContext('2d');

    this._video = video;
    this._canvas = canvas;
    this._ctx = ctx;

    const url = Utils.createObjectURL(file);
    video.src = url;

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
   * Extract frames at the given interval.
   * Captures at full native resolution, stores as JPEG Blobs.
   * @param {number} interval - seconds between captures
   * @param {number} quality - JPEG quality 0-1 (default 0.92)
   * @param {number} maxWidth - max capture width (default: native)
   * @param {function} onProgress - callback(percent, frameCount)
   */
  async extractFrames(interval, quality = 0.92, maxWidth = 9999, onProgress = null) {
    const video = this._video;
    const canvas = this._canvas;

    if (!video || !video.duration) {
      throw new Error('No video loaded');
    }

    // Cleanup any previous frames
    FrameStore.cleanup();
    this._frames = [];
    this._aborted = false;
    const duration = video.duration;
    const totalFrames = Math.floor(duration / interval) + 1;

    // Use native resolution, capped at maxWidth for sanity
    let drawWidth = video.videoWidth;
    let drawHeight = video.videoHeight;
    if (drawWidth > maxWidth) {
      const ratio = maxWidth / drawWidth;
      drawWidth = Math.round(maxWidth);
      drawHeight = Math.round(video.videoHeight * ratio);
    }
    canvas.width = drawWidth;
    canvas.height = drawHeight;

    for (let i = 0; i < totalFrames; i++) {
      if (this._aborted) break;

      const time = i * interval;
      if (time > duration) break;

      try {
        const url = await this._captureFrame(time, drawWidth, drawHeight, quality);
        this._frames.push({ time, url, width: drawWidth, height: drawHeight });
      } catch (e) {
        console.warn(`Failed to capture frame at ${time}s:`, e);
      }

      if (onProgress) {
        const percent = Math.round(((i + 1) / totalFrames) * 100);
        onProgress(percent, this._frames.length);
      }

      // Yield to UI thread and allow GC
      await Utils.delay(50);
    }

    return this._frames;
  },

  /**
   * Capture a single frame as a JPEG Blob, store in FrameStore.
   * Returns the objectURL for display.
   */
  _captureFrame(time, width, height, quality) {
    return new Promise((resolve, reject) => {
      const video = this._video;
      const canvas = this._canvas;
      const ctx = this._ctx;

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        try {
          // Draw at full resolution
          ctx.drawImage(video, 0, 0, width, height);

          // Use toBlob() — stores image in browser memory, NOT as a giant string
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob returned null'));
              return;
            }
            // Store in FrameStore and get lightweight objectURL
            const url = FrameStore.store(blob, width, height);
            resolve(url);
          }, 'image/jpeg', quality);

        } catch (e) {
          reject(e);
        }
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;

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
   * Get memory usage summary
   */
  getMemoryInfo() {
    return {
      frameCount: this._frames.length,
      totalSize: FrameStore.getTotalSize(),
      totalSizeFormatted: Utils.formatFileSize(FrameStore.getTotalSize())
    };
  },

  /**
   * Cleanup
   */
  cleanup() {
    if (this._video && this._video.src) {
      Utils.revokeObjectURL(this._video.src);
      this._video.src = '';
    }
    FrameStore.cleanup();
    this._frames = [];
  }
};
