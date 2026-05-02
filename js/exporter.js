/**
 * exporter.js — Export document to PDF (jsPDF) or DOCX (docx.js)
 *
 * CRITICAL ARCHITECTURE for handling heavy/long videos:
 * - Images are stored as Blobs in FrameStore (browser-managed memory)
 * - During export, each image is converted to data URL ONE AT A TIME
 * - After adding to PDF, the data URL string is released immediately
 * - This keeps peak memory usage low even for 500+ frame documents
 * - Supports single-file and multi-file split downloads
 */

const Exporter = {
  _selectedFormat: 'pdf',

  /**
   * Estimate page count for the given blocks
   */
  estimatePages(blocks, config) {
    const pageSize = config.pageSize === 'letter' ? { h: 279 } : { h: 297 };
    const margin = 12;
    const usableH = pageSize.h - margin * 2;
    const bodySize = parseInt(config.fontSize) || 14;
    const lineH = bodySize * 0.3528 * (parseFloat(config.lineHeight) || 1.6);

    let y = 0;
    let pages = 1;
    let imageCount = 0;
    let textCount = 0;

    for (const block of blocks) {
      if (block.type === 'image') {
        imageCount++;
        const imgH = usableH * 0.6;
        if (y + imgH + 12 > usableH) { pages++; y = 0; }
        y += imgH + 12;
      } else if (block.type === 'timestamp') {
        if (y + 10 > usableH) { pages++; y = 0; }
        y += 8;
      } else if (block.type === 'text') {
        textCount++;
        const chars = (block.content || '').length;
        const estLines = Math.max(1, Math.ceil(chars / 80));
        const textH = estLines * lineH + 4;
        if (y + textH > usableH) { pages++; y = 0; }
        y += textH;
      }
    }

    return { pages, imageCount, textCount };
  },

  /**
   * Ensure jsPDF is loaded
   */
  async _ensureJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return;
    for (let i = 0; i < 10; i++) {
      await Utils.delay(200);
      if (window.jspdf && window.jspdf.jsPDF) return;
    }
    throw new Error('jsPDF library failed to load. Please check your internet connection and reload.');
  },

  /**
   * Resolve an image URL to a data URL for PDF embedding.
   * If it's a blob: URL, reads the Blob one-at-a-time.
   * If it's already a data: URL, returns as-is.
   */
  async _resolveImageForPDF(url) {
    // If managed by FrameStore, convert blob → data URL
    if (FrameStore.has(url)) {
      return await FrameStore.toDataURL(url);
    }
    // If it's a blob URL not in FrameStore, fetch it
    if (url.startsWith('blob:')) {
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        return await Utils.blobToDataURL(blob);
      } catch (e) {
        console.warn('Failed to fetch blob URL:', e);
        return null;
      }
    }
    // Already a data URL
    return url;
  },

  /**
   * Resolve an image URL to Uint8Array for DOCX embedding.
   */
  async _resolveImageForDOCX(url) {
    if (FrameStore.has(url)) {
      return await FrameStore.toUint8Array(url);
    }
    if (url.startsWith('blob:')) {
      try {
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) {
        console.warn('Failed to fetch blob URL for DOCX:', e);
        return null;
      }
    }
    if (url.startsWith('data:')) {
      return Utils.dataURLtoUint8Array(url);
    }
    return null;
  },

  /**
   * Export as PDF using jsPDF.
   * Converts each image blob → data URL ONE AT A TIME to prevent memory blowup.
   */
  async exportPDF(blocks, config, onProgress) {
    await this._ensureJsPDF();
    const { jsPDF } = window.jspdf;

    const pageSize = config.pageSize === 'letter' ? 'letter' : 'a4';
    const doc = new jsPDF({ unit: 'mm', format: pageSize, orientation: 'portrait' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 12;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const font = config.fontFamily || 'helvetica';
    const bodySize = parseInt(config.fontSize) || 12;
    const lineHeightMultiplier = parseFloat(config.lineHeight) || 1.6;

    const fontMap = {
      'Inter': 'helvetica', 'Roboto': 'helvetica', 'Arial': 'helvetica',
      'Georgia': 'times', 'Times New Roman': 'times', 'Courier New': 'courier'
    };
    const pdfFont = fontMap[font] || 'helvetica';

    const isDark = config.docTheme === 'dark';
    const textColor = isDark ? [220, 220, 240] : [30, 30, 50];
    const bgColor = isDark ? [26, 26, 46] : [255, 255, 255];
    const tsColor = [124, 58, 237];

    const fillPageBg = () => {
      doc.setFillColor(...bgColor);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
    };
    fillPageBg();

    const checkNewPage = (needed) => {
      if (y + needed > pageHeight - margin) {
        doc.addPage();
        fillPageBg();
        y = margin;
      }
    };

    const total = blocks.length;
    let imgErrors = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'image') {
        try {
          // Resolve blob → data URL (ONE AT A TIME — critical for memory)
          const dataURL = await this._resolveImageForPDF(block.content);
          if (!dataURL) {
            imgErrors++;
            continue;
          }

          // Get dimensions
          const dims = await Utils.getImageDimensions(block.content);
          let imgWidth = contentWidth;
          let imgHeight = (dims.height / dims.width) * imgWidth;

          // Allow up to 75% of page height
          const maxImgHeight = pageHeight * 0.75;
          if (imgHeight > maxImgHeight) {
            imgHeight = maxImgHeight;
            imgWidth = (dims.width / dims.height) * imgHeight;
          }

          checkNewPage(imgHeight + 10);

          const xOffset = margin + (contentWidth - imgWidth) / 2;
          const imgFormat = dataURL.includes('data:image/png') ? 'PNG' : 'JPEG';

          // Add image — use 'NONE' compression to preserve quality
          doc.addImage(dataURL, imgFormat, xOffset, y, imgWidth, imgHeight, undefined, 'NONE');
          y += imgHeight + 3;

          // Caption
          if (block.caption) {
            doc.setFont(pdfFont, 'italic');
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 170);
            doc.text(block.caption, pageWidth / 2, y, { align: 'center' });
            y += 6;
          }

          // dataURL goes out of scope here — GC can reclaim the string memory

        } catch (e) {
          console.warn('Failed to add image to PDF at block', i, ':', e);
          imgErrors++;
        }
      } else if (block.type === 'timestamp') {
        checkNewPage(10);
        doc.setFont(pdfFont, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...tsColor);
        doc.text(block.content, margin, y);
        y += 6;
      } else if (block.type === 'text') {
        doc.setFont(pdfFont, 'normal');
        doc.setFontSize(bodySize);
        doc.setTextColor(...textColor);

        const lines = doc.splitTextToSize(block.content, contentWidth);
        const lineH = bodySize * 0.3528 * lineHeightMultiplier;

        for (const line of lines) {
          checkNewPage(lineH + 2);
          doc.text(line, margin, y);
          y += lineH;
        }
        y += 3;
      }

      if (onProgress) {
        onProgress(Math.round(((i + 1) / total) * 100));
      }

      // Yield to UI thread every few blocks to keep browser responsive
      if (i % 3 === 0) await Utils.delay(20);
    }

    if (imgErrors > 0) {
      console.warn(`${imgErrors} images failed to embed in PDF`);
    }

    return doc;
  },

  /**
   * Export as PDF — split into N files
   */
  async exportPDFSplit(blocks, config, splitCount, onProgress) {
    const chunkSize = Math.ceil(blocks.length / splitCount);
    const docs = [];

    for (let part = 0; part < splitCount; part++) {
      const start = part * chunkSize;
      const end = Math.min(start + chunkSize, blocks.length);
      const chunk = blocks.slice(start, end);
      if (chunk.length === 0) break;

      const doc = await this.exportPDF(chunk, config, (p) => {
        const overallPercent = Math.round(((part * chunkSize + (p / 100) * chunk.length) / blocks.length) * 100);
        if (onProgress) onProgress(overallPercent);
      });
      docs.push(doc);
    }
    return docs;
  },

  /**
   * Export as DOCX.
   * Converts each image blob → Uint8Array ONE AT A TIME.
   */
  async exportDOCX(blocks, config, onProgress) {
    await this._ensureDocx();

    const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType } = window.docx;

    const children = [];
    const total = blocks.length;
    const bodySize = parseInt(config.fontSize) || 14;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'image') {
        try {
          // Resolve blob → Uint8Array (one at a time)
          const imgData = await this._resolveImageForDOCX(block.content);
          if (!imgData) continue;

          const dims = await Utils.getImageDimensions(block.content);
          const maxW = 625;
          let w = dims.width;
          let h = dims.height;
          if (w > maxW) {
            h = Math.round((maxW / w) * h);
            w = maxW;
          }

          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [
              new ImageRun({
                data: imgData,
                transformation: { width: w, height: h },
                type: 'jpg'
              })
            ]
          }));

          if (block.caption) {
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [
                new TextRun({ text: block.caption, size: 18, color: '888888', italics: true })
              ]
            }));
          }
        } catch (e) {
          console.warn('DOCX image error at block', i, ':', e);
        }
      } else if (block.type === 'timestamp') {
        children.push(new Paragraph({
          spacing: { before: 300, after: 60 },
          children: [
            new TextRun({ text: block.content, size: 18, color: '7C3AED', bold: true, font: 'Consolas' })
          ]
        }));
      } else if (block.type === 'text') {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: block.content, size: bodySize * 2, font: config.fontFamily || 'Calibri' })
          ]
        }));
      }

      if (onProgress) onProgress(Math.round(((i + 1) / total) * 100));
      if (i % 5 === 0) await Utils.delay(10);
    }

    const docxDoc = new Document({
      sections: [{ properties: {}, children }]
    });

    return await Packer.toBlob(docxDoc);
  },

  /**
   * Export as DOCX — split into N files
   */
  async exportDOCXSplit(blocks, config, splitCount, onProgress) {
    const chunkSize = Math.ceil(blocks.length / splitCount);
    const blobs = [];

    for (let part = 0; part < splitCount; part++) {
      const start = part * chunkSize;
      const end = Math.min(start + chunkSize, blocks.length);
      const chunk = blocks.slice(start, end);
      if (chunk.length === 0) break;

      const blob = await this.exportDOCX(chunk, config, (p) => {
        const overallPercent = Math.round(((part * chunkSize + (p / 100) * chunk.length) / blocks.length) * 100);
        if (onProgress) onProgress(overallPercent);
      });
      blobs.push(blob);
    }
    return blobs;
  },

  /**
   * Ensure docx library is loaded
   */
  async _ensureDocx() {
    if (window.docx) return;
    await this._loadDocxLib();
    for (let i = 0; i < 15; i++) {
      await Utils.delay(300);
      if (window.docx) return;
    }
    throw new Error('DOCX library failed to load. Please check your internet connection and reload.');
  },

  /**
   * Dynamically load docx library
   */
  _loadDocxLib() {
    return new Promise((resolve, reject) => {
      if (window.docx) return resolve();

      const urls = [
        'https://unpkg.com/docx@8.5.0/build/index.umd.js',
        'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'
      ];

      let loaded = false;
      const tryLoad = (idx) => {
        if (idx >= urls.length) {
          if (!loaded) reject(new Error('Failed to load docx library from any CDN'));
          return;
        }
        const script = document.createElement('script');
        script.src = urls[idx];
        script.onload = () => { loaded = true; resolve(); };
        script.onerror = () => tryLoad(idx + 1);
        document.head.appendChild(script);
      };
      tryLoad(0);
    });
  }
};
