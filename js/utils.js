/**
 * utils.js — Utility helpers for TutorialForge
 * Includes FrameStore for memory-efficient blob-based image storage.
 */

const Utils = {
  /**
   * Format seconds to HH:MM:SS or MM:SS
   */
  formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  /**
   * Parse a timestamp string into total seconds.
   * Supports: "0:15", "1:00:04", "[7:52]", "(10:03)", "00:01:23,456"
   */
  parseTimestamp(str) {
    if (!str) return null;
    let clean = str.replace(/[\[\]\(\)]/g, '').trim();
    clean = clean.replace(/[,\.]\d+$/, '');

    const parts = clean.split(':').map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return null;
  },

  /**
   * Format file size in human-readable form
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  /**
   * Read a file as text
   */
  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  },

  /**
   * Create object URL for a file
   */
  createObjectURL(file) {
    return URL.createObjectURL(file);
  },

  /**
   * Revoke object URL
   */
  revokeObjectURL(url) {
    if (url) URL.revokeObjectURL(url);
  },

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      toast.style.transition = '0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  },

  /**
   * Truncate string
   */
  truncate(str, maxLen = 50) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  },

  /**
   * Convert a Blob to a base64 data URL (one at a time, for export)
   */
  blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Convert a Blob to Uint8Array (for DOCX images)
   */
  blobToUint8Array(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  },

  /**
   * Convert data URL to Uint8Array (fallback for inline data URLs)
   */
  dataURLtoUint8Array(dataURL) {
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);
    const len = binary.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = binary.charCodeAt(i);
    }
    return arr;
  },

  /**
   * Get image dimensions from any URL (blob: or data:)
   */
  getImageDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 1920, height: 1080 });
      img.src = url;
    });
  }
};


/**
 * FrameStore — Memory-efficient storage for video frames.
 * Stores frames as Blobs (browser-managed, not in JS heap)
 * and creates lightweight objectURLs for display.
 *
 * This is the KEY to handling 1-2+ hour videos without crashing.
 * - A 1920×1080 JPEG at 92% = ~200KB as Blob (browser-managed memory)
 * - A 1920×1080 PNG as data URL = ~6MB in JS heap string
 * - For 360 frames: Blob approach = ~72MB vs data URL = ~2.2GB
 */
const FrameStore = {
  _blobs: new Map(),    // objectURL → Blob
  _dims: new Map(),     // objectURL → { width, height }

  /**
   * Store a Blob and return its objectURL
   */
  store(blob, width, height) {
    const url = URL.createObjectURL(blob);
    this._blobs.set(url, blob);
    this._dims.set(url, { width, height });
    return url;
  },

  /**
   * Get the Blob for a given objectURL
   */
  getBlob(url) {
    return this._blobs.get(url) || null;
  },

  /**
   * Get stored dimensions
   */
  getDims(url) {
    return this._dims.get(url) || { width: 1920, height: 1080 };
  },

  /**
   * Convert a stored objectURL to data URL (for PDF export — one at a time)
   */
  async toDataURL(url) {
    const blob = this._blobs.get(url);
    if (!blob) {
      // Already a data URL or external URL, return as-is
      return url;
    }
    return await Utils.blobToDataURL(blob);
  },

  /**
   * Convert a stored objectURL to Uint8Array (for DOCX export)
   */
  async toUint8Array(url) {
    const blob = this._blobs.get(url);
    if (!blob) {
      // Fallback: might be a data URL
      if (url.startsWith('data:')) {
        return Utils.dataURLtoUint8Array(url);
      }
      // Fetch external URL
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    }
    return await Utils.blobToUint8Array(blob);
  },

  /**
   * Check if a URL is managed by FrameStore
   */
  has(url) {
    return this._blobs.has(url);
  },

  /**
   * Get total stored size estimate
   */
  getTotalSize() {
    let total = 0;
    for (const blob of this._blobs.values()) {
      total += blob.size;
    }
    return total;
  },

  /**
   * Get count
   */
  count() {
    return this._blobs.size;
  },

  /**
   * Cleanup all stored blobs
   */
  cleanup() {
    for (const url of this._blobs.keys()) {
      URL.revokeObjectURL(url);
    }
    this._blobs.clear();
    this._dims.clear();
  }
};
