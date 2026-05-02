/**
 * exporter.js — Export document to PDF (jsPDF) or DOCX (docx.js)
 * Maximum HD image quality: full-width images, no re-compression, no height caps.
 * Supports single-file and multi-file split downloads.
 */

const Exporter = {
  _selectedFormat: 'pdf',

  /**
   * Estimate page count for the given blocks
   */
  estimatePages(blocks, config) {
    const pageSize = config.pageSize === 'letter' ? { h: 279 } : { h: 297 };
    const margin = 15;
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
        // Each image gets roughly 60% of page height
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
   * Export as PDF using jsPDF — MAXIMUM IMAGE QUALITY
   * - Images span full page width with minimal margins
   * - No aggressive height capping
   * - PNG format preserved (no re-compression to JPEG)
   * - No compression flag on addImage
   */
  async exportPDF(blocks, config, onProgress) {
    await this._ensureJsPDF();
    const { jsPDF } = window.jspdf;

    const pageSize = config.pageSize === 'letter' ? 'letter' : 'a4';
    const doc = new jsPDF({ unit: 'mm', format: pageSize, orientation: 'portrait' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    // Smaller margins = bigger images = more detail visible
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

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (block.type === 'image') {
        try {
          const dims = await Utils.getImageDimensions(block.content);

          // Calculate image dimensions to fill FULL content width
          let imgWidth = contentWidth;
          let imgHeight = (dims.height / dims.width) * imgWidth;

          // Allow images up to 75% of page height — much bigger than before
          const maxImgHeight = pageHeight * 0.75;
          if (imgHeight > maxImgHeight) {
            imgHeight = maxImgHeight;
            imgWidth = (dims.width / dims.height) * imgHeight;
          }

          // If image won't fit on current page, start a new page
          checkNewPage(imgHeight + 10);

          // Center the image horizontally
          const xOffset = margin + (contentWidth - imgWidth) / 2;

          // Detect image format from the data URL
          const imgFormat = block.content.includes('data:image/png') ? 'PNG' : 'JPEG';

          // Add image with NO compression — 'NONE' preserves original quality
          doc.addImage(block.content, imgFormat, xOffset, y, imgWidth, imgHeight, undefined, 'NONE');
          y += imgHeight + 3;

          // Caption below image
          if (block.caption) {
            doc.setFont(pdfFont, 'italic');
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 170);
            doc.text(block.caption, pageWidth / 2, y, { align: 'center' });
            y += 6;
          }
        } catch (e) {
          console.warn('Failed to add image to PDF:', e);
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
      if (i % 3 === 0) await Utils.delay(10);
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
   * Export as DOCX — MAXIMUM IMAGE QUALITY
   * Uses full-page-width images (≈700px for A4 at 96dpi)
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
          const dims = await Utils.getImageDimensions(block.content);
          // Full page width in DOCX is about 625px (A4 with 1-inch margins)
          // Use the full width for maximum clarity
          const maxW = 625;
          let w = dims.width;
          let h = dims.height;
          if (w > maxW) {
            h = Math.round((maxW / w) * h);
            w = maxW;
          }

          const imgData = Utils.dataURLtoUint8Array(block.content);
          const imgType = block.content.includes('data:image/png') ? 'png' : 'jpg';

          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 100 },
            children: [
              new ImageRun({
                data: imgData,
                transformation: { width: w, height: h },
                type: imgType
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
          console.warn('DOCX image error:', e);
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
      if (i % 10 === 0) await Utils.delay(5);
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
   * Dynamically load docx library from CDN
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
