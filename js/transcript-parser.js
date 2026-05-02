/**
 * transcript-parser.js — Parse transcript text into time-indexed segments.
 * 
 * Supports formats:
 *  1) "0:15\nText here\n0:20\nMore text" (timestamp on own line)
 *  2) "[7:52] Text here" (bracketed timestamp inline)
 *  3) "(10:03) Text here" (parenthesized timestamp inline)
 *  4) SRT: "1\n00:00:01,000 --> 00:00:05,000\nText"
 */

const TranscriptParser = {
  /**
   * Parse transcript text into segments.
   * Returns: [{ time: <seconds|null>, text: <string> }, ...]
   */
  parse(rawText) {
    if (!rawText || !rawText.trim()) return [];

    const text = rawText.trim();

    // Detect format
    if (this._isSRT(text)) {
      return this._parseSRT(text);
    }
    if (this._isBracketedInline(text)) {
      return this._parseBracketedInline(text);
    }
    // Default: timestamps on separate lines
    return this._parseLineTimestamps(text);
  },

  /**
   * Check if text looks like SRT format
   */
  _isSRT(text) {
    return /^\d+\s*\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(text);
  },

  /**
   * Check if text uses bracketed inline timestamps: [7:52] or (7:52)
   */
  _isBracketedInline(text) {
    const lines = text.split('\n').slice(0, 20);
    let bracketCount = 0;
    for (const line of lines) {
      if (/^\s*[\[\(]\d{1,2}:\d{2}(:\d{2})?[\]\)]/.test(line)) {
        bracketCount++;
      }
    }
    return bracketCount >= 2;
  },

  /**
   * Parse SRT format
   */
  _parseSRT(text) {
    const blocks = text.split(/\n\s*\n/);
    const segments = [];
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      // Find the timestamp line
      const tsLine = lines.find(l => /\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/.test(l));
      if (!tsLine) continue;
      const startTs = tsLine.split('-->')[0].trim();
      const time = Utils.parseTimestamp(startTs);
      // The rest are text lines
      const textLines = lines.filter(l => l !== tsLine && !/^\d+$/.test(l.trim()));
      const txt = textLines.join(' ').trim();
      if (txt) {
        segments.push({ time, text: txt });
      }
    }
    return segments;
  },

  /**
   * Parse bracketed inline format: "[7:52] text" or "(7:52) text"
   */
  _parseBracketedInline(text) {
    const lines = text.split('\n');
    const segments = [];
    let currentTime = null;
    let currentText = [];

    for (const line of lines) {
      const match = line.match(/^\s*[\[\(](\d{1,2}:\d{2}(?::\d{2})?)[\]\)]\s*(.*)/);
      if (match) {
        // Save previous segment
        if (currentText.length > 0) {
          segments.push({ time: currentTime, text: currentText.join(' ').trim() });
        }
        currentTime = Utils.parseTimestamp(match[1]);
        currentText = match[2].trim() ? [match[2].trim()] : [];
      } else {
        const trimmed = line.trim();
        if (trimmed) {
          currentText.push(trimmed);
        }
      }
    }
    // Final segment
    if (currentText.length > 0) {
      segments.push({ time: currentTime, text: currentText.join(' ').trim() });
    }
    return segments;
  },

  /**
   * Parse format where timestamps are on their own line:
   * "0:15\nSome text here\n0:20\nMore text"
   * Also handles "1:00:04\nText" (H:MM:SS)
   */
  _parseLineTimestamps(text) {
    const lines = text.split('\n');
    const segments = [];
    let currentTime = null;
    let currentText = [];
    let foundAnyTimestamp = false;

    // Regex for standalone timestamp line
    const tsRegex = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

    for (const line of lines) {
      const match = line.match(tsRegex);
      if (match) {
        foundAnyTimestamp = true;
        // Save previous segment
        if (currentText.length > 0) {
          segments.push({ time: currentTime, text: currentText.join(' ').trim() });
          currentText = [];
        }
        currentTime = Utils.parseTimestamp(match[1]);
      } else {
        const trimmed = line.trim();
        if (trimmed) {
          currentText.push(trimmed);
        }
      }
    }
    // Final segment
    if (currentText.length > 0) {
      segments.push({ time: currentTime, text: currentText.join(' ').trim() });
    }

    // If no timestamps found at all, treat entire text as one segment
    if (!foundAnyTimestamp && segments.length === 0) {
      segments.push({ time: null, text: text.trim() });
    }

    return segments;
  },

  /**
   * Get stats about the parsed transcript
   */
  getStats(segments) {
    const totalWords = segments.reduce((acc, s) => acc + s.text.split(/\s+/).filter(Boolean).length, 0);
    const withTimestamps = segments.filter(s => s.time !== null).length;
    return {
      wordCount: totalWords,
      timestampCount: withTimestamps,
      segmentCount: segments.length
    };
  }
};
