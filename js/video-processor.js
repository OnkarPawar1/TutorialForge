/**
 * video-processor.js — Extract frames using Canvas API.
 * 
 * Uses PNG Blobs for LOSSLESS quality (critical for text-heavy content).
 * Blob storage keeps images in browser-managed memory instead of JS heap
 * to prevent "Aw, Snap!" crashes on long videos.
 *
 * PNG vs JPEG for code/text screenshots:
 * - JPEG creates compression artifacts around sharp text edges → blurry text
 * - PNG preserves every pixel perfectly → crystal clear text at any zoom
 * - PNG Blob (~2MB) is stored efficiently by browser, not as 6MB base64 string
 */

const VideoProcessor = {
  _video: null,
  _canvas: null,
  _ctx: null,
  _frames: [],
  _aborted: false,

  /**
   * Initialize with a video file
   */
  async loadVideo(file) {
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
   * ALWAYS captures as lossless PNG at full native resolution.
   */
  async extractFrames(interval, quality = 1.0, maxWidth = 9999, onProgress = null) {
    const video = this._video;
    const canvas = this._canvas;

    if (!video || !video.duration) {
      throw new Error('No video loaded');
    }

    FrameStore.cleanup();
    this._frames = [];
    this._aborted = false;
    const duration = video.duration;
    const totalFrames = Math.floor(duration / interval) + 1;

    // Full native resolution — no downscaling
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
        const url = await this._captureFrame(time, drawWidth, drawHeight);
        this._frames.push({ time, url, width: drawWidth, height: drawHeight });
      } catch (e) {
        console.warn(`Failed to capture frame at ${time}s:`, e);
      }

      if (onProgress) {
        const percent = Math.round(((i + 1) / totalFrames) * 100);
        onProgress(percent, this._frames.length);
      }

      // Yield to UI thread
      await Utils.delay(50);
    }

    return this._frames;
  },

  /**
   * Capture a single frame as a LOSSLESS PNG Blob.
   * PNG preserves every pixel — critical for readable text in code editors.
   */
  _captureFrame(time, width, height) {
    return new Promise((resolve, reject) => {
      const video = this._video;
      const canvas = this._canvas;
      const ctx = this._ctx;

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        try {
          ctx.drawImage(video, 0, 0, width, height);

          // PNG — lossless, no compression artifacts, every pixel preserved
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob returned null'));
              return;
            }
            const url = FrameStore.store(blob, width, height);
            resolve(url);
          }, 'image/png');

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

  abort() {
    this._aborted = true;
  },

  getFrames() {
    return this._frames;
  },

  getMemoryInfo() {
    return {
      frameCount: this._frames.length,
      totalSize: FrameStore.getTotalSize(),
      totalSizeFormatted: Utils.formatFileSize(FrameStore.getTotalSize())
    };
  },

  cleanup() {
    if (this._video && this._video.src) {
      Utils.revokeObjectURL(this._video.src);
      this._video.src = '';
    }
    FrameStore.cleanup();
    this._frames = [];
  }
};
