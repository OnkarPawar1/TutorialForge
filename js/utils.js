/**
 * utils.js — Utility helpers for TutorialForge
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
    // Remove brackets / parens
    let clean = str.replace(/[\[\]\(\)]/g, '').trim();
    // Remove SRT milliseconds: 00:01:23,456 -> 00:01:23
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
   * Convert data URL to ArrayBuffer (for docx images)
   */
  dataURLtoArrayBuffer(dataURL) {
    const base64 = dataURL.split(',')[1];
    const binary = atob(base64);
    const len = binary.length;
    const buffer = new ArrayBuffer(len);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < len; i++) {
      view[i] = binary.charCodeAt(i);
    }
    return buffer;
  },

  /**
   * Convert data URL to Uint8Array
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
   * Get image dimensions from a data URL
   */
  getImageDimensions(dataURL) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 640, height: 360 });
      img.src = dataURL;
    });
  }
};
