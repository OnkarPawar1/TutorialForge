/**
 * app.js — Main application controller for TutorialForge
 * Handles the 5-step wizard flow, state management, and all UI interactions.
 * Uses blob-based FrameStore for memory-efficient handling of long videos.
 */

(function () {
  'use strict';

  // ===== STATE =====
  const state = {
    currentStep: 1,
    videoFile: null,
    videoURL: null,
    videoDuration: 0,
    transcript: '',
    segments: [],
    frames: [],       // [{ time, url (objectURL), width, height }]
    documentBlocks: [],
    exportFormat: 'pdf',
    estimatedPages: 0
  };

  const $ = (id) => document.getElementById(id);

  // ===== STEP NAVIGATION =====
  function goToStep(step) {
    if (step < 1 || step > 5) return;
    if (step > state.currentStep + 1) return;

    document.querySelectorAll('.step-item').forEach(el => {
      const s = parseInt(el.dataset.step);
      el.classList.remove('active', 'completed');
      if (s === step) el.classList.add('active');
      else if (s < step) el.classList.add('completed');
    });

    for (let i = 1; i < 5; i++) {
      const conn = $(`conn-${i}-${i + 1}`);
      if (conn) conn.classList.toggle('completed', i < step);
    }

    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    const panel = $(`panel-${step}`);
    if (panel) panel.classList.add('active');

    if (step === 5) {
      updatePageEstimate();
    }

    state.currentStep = step;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== PAGE ESTIMATION =====
  function updatePageEstimate() {
    const blocks = Editor.getStructuredContent();
    const config = {
      fontFamily: $('fontFamily').value,
      fontSize: $('fontSize').value,
      lineHeight: $('lineHeight').value,
      pageSize: $('pageSize').value,
      docTheme: $('docTheme').value
    };

    const est = Exporter.estimatePages(blocks, config);
    state.estimatedPages = est.pages;

    $('estPageCount').textContent = est.pages;
    $('estImageCount').textContent = est.imageCount;
    $('estTextCount').textContent = est.textCount;

    updateSplitInfo();
  }

  function updateSplitInfo() {
    const splitCount = parseInt($('splitCount').value) || 2;
    const pagesEach = Math.ceil(state.estimatedPages / splitCount);
    $('splitInfo').textContent = `(~${pagesEach} pages each)`;
  }

  // ===== STEP 1: VIDEO UPLOAD =====
  function initVideoUpload() {
    const dropZone = $('videoDropZone');
    const fileInput = $('videoFileInput');
    const videoInfo = $('videoInfo');
    const preview = $('videoPreview');
    const removeBtn = $('videoRemoveBtn');
    const nextBtn = $('toStep2Btn');

    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].type.startsWith('video/')) {
        handleVideoFile(files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleVideoFile(fileInput.files[0]);
      }
    });

    removeBtn.addEventListener('click', () => {
      state.videoFile = null;
      if (state.videoURL) Utils.revokeObjectURL(state.videoURL);
      state.videoURL = null;
      preview.src = '';
      videoInfo.classList.remove('visible');
      dropZone.style.display = '';
      nextBtn.disabled = true;
      fileInput.value = '';
    });

    function handleVideoFile(file) {
      state.videoFile = file;
      state.videoURL = Utils.createObjectURL(file);
      preview.src = state.videoURL;

      preview.onloadedmetadata = () => {
        state.videoDuration = preview.duration;
        $('videoName').textContent = file.name;
        $('videoSize').textContent = Utils.formatFileSize(file.size);
        $('videoDuration').textContent = `Duration: ${Utils.formatTime(preview.duration)}`;
        videoInfo.classList.add('visible');
        dropZone.style.display = 'none';
        nextBtn.disabled = false;
      };

      preview.onerror = () => {
        Utils.showToast('Failed to load video. Try a different format.', 'error');
        state.videoFile = null;
      };
    }

    nextBtn.addEventListener('click', () => goToStep(2));
  }

  // ===== STEP 2: TRANSCRIPT =====
  function initTranscript() {
    const input = $('transcriptInput');
    const fileBtn = $('transcriptFileBtn');
    const fileInput = $('transcriptFileInput');
    const clearBtn = $('clearTranscriptBtn');
    const nextBtn = $('toStep3Btn');
    const statsEl = $('transcriptStats');
    const backBtn = $('backToStep1');

    function updateStats() {
      const text = input.value.trim();
      state.transcript = text;
      state.segments = TranscriptParser.parse(text);

      if (text.length > 0) {
        const stats = TranscriptParser.getStats(state.segments);
        $('wordCount').textContent = stats.wordCount.toLocaleString();
        $('timestampCount').textContent = stats.timestampCount;
        $('segmentCount').textContent = stats.segmentCount;
        statsEl.style.display = '';
        nextBtn.disabled = false;
      } else {
        statsEl.style.display = 'none';
        nextBtn.disabled = true;
      }
    }

    input.addEventListener('input', updateStats);

    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (fileInput.files.length > 0) {
        try {
          const text = await Utils.readFileAsText(fileInput.files[0]);
          input.value = text;
          updateStats();
          Utils.showToast('Transcript file loaded!', 'success');
        } catch (e) {
          Utils.showToast('Failed to read file', 'error');
        }
      }
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      updateStats();
    });

    nextBtn.addEventListener('click', () => goToStep(3));
    backBtn.addEventListener('click', () => goToStep(1));
  }

  // ===== STEP 3: CONFIGURE & EXTRACT =====
  function initConfigure() {
    const intervalSelect = $('captureInterval');
    const customRow = $('customIntervalRow');
    const qualityRange = $('imageQuality');
    const qualityVal = $('qualityValue');
    const extractBtn = $('extractBtn');
    const progressContainer = $('extractProgress');
    const progressFill = $('progressFill');
    const progressLabel = $('progressLabel');
    const progressPercent = $('progressPercent');
    const thumbStrip = $('thumbnailStrip');
    const nextBtn = $('toStep4Btn');
    const backBtn = $('backToStep2');

    intervalSelect.addEventListener('change', () => {
      customRow.style.display = intervalSelect.value === 'custom' ? '' : 'none';
    });

    qualityRange.addEventListener('input', () => {
      qualityVal.textContent = qualityRange.value + '%';
    });

    extractBtn.addEventListener('click', async () => {
      let interval = parseInt(intervalSelect.value);
      if (intervalSelect.value === 'custom') {
        interval = parseInt($('customInterval').value) || 10;
      }
      const quality = parseInt(qualityRange.value) / 100;
      const maxWidth = parseInt($('maxImgWidth').value) || 1920;

      extractBtn.disabled = true;
      extractBtn.innerHTML = '<div class="spinner" style="display:inline-block"></div> Extracting...';
      progressContainer.classList.add('visible');
      thumbStrip.style.display = 'none';
      thumbStrip.innerHTML = '';

      try {
        await VideoProcessor.loadVideo(state.videoFile);

        state.frames = await VideoProcessor.extractFrames(interval, quality, maxWidth, (percent, count) => {
          progressFill.style.width = percent + '%';
          progressPercent.textContent = percent + '%';
          progressLabel.textContent = `Extracting frames... (${count} captured)`;
        });

        // Show thumbnails using objectURLs (lightweight)
        if (state.frames.length > 0) {
          thumbStrip.style.display = 'flex';
          for (const frame of state.frames) {
            const div = document.createElement('div');
            div.className = 'thumbnail-item';
            div.innerHTML = `
              <img src="${frame.url}" alt="Frame at ${Utils.formatTime(frame.time)}" loading="lazy">
              <span class="thumbnail-time">${Utils.formatTime(frame.time)}</span>
            `;
            thumbStrip.appendChild(div);
          }
        }

        // Memory info
        const memInfo = VideoProcessor.getMemoryInfo();
        progressLabel.textContent = `✅ Done! ${state.frames.length} frames extracted. (${memInfo.totalSizeFormatted} used)`;
        nextBtn.disabled = false;
        Utils.showToast(`${state.frames.length} frames extracted! Memory: ${memInfo.totalSizeFormatted}`, 'success');

      } catch (e) {
        Utils.showToast('Frame extraction failed: ' + e.message, 'error');
        progressLabel.textContent = '❌ Extraction failed';
      }

      extractBtn.disabled = false;
      extractBtn.innerHTML = '🎬 Extract Frames & Build Document';
    });

    nextBtn.addEventListener('click', () => {
      const placement = $('screenshotPlacement').value;
      state.documentBlocks = DocumentBuilder.build(state.frames, state.segments, placement);

      const editorConfig = {
        fontFamily: $('fontFamily').value,
        fontSize: $('fontSize').value,
        lineHeight: $('lineHeight').value,
        docTheme: $('docTheme').value
      };

      Editor.render(state.documentBlocks, editorConfig);
      goToStep(4);
    });

    backBtn.addEventListener('click', () => goToStep(2));
  }

  // ===== STEP 4: EDITOR =====
  function initEditor() {
    Editor.init();

    $('backToStep3').addEventListener('click', () => goToStep(3));
    $('toStep5Btn').addEventListener('click', () => goToStep(5));
  }

  // ===== STEP 5: EXPORT =====
  function initExport() {
    const pdfCard = $('exportPdfCard');
    const docxCard = $('exportDocxCard');
    const extSpan = $('exportExt');
    const downloadBtn = $('downloadBtn');
    const progressContainer = $('exportProgress');
    const progressFill = $('exportProgressFill');
    const progressLabel = $('exportProgressLabel');
    const progressPercent = $('exportProgressPercent');
    const backBtn = $('backToStep4');
    const splitRadio = $('downloadModeSplit');
    const singleRadio = $('downloadModeSingle');
    const splitOptions = $('splitOptions');
    const splitCountInput = $('splitCount');

    function selectFormat(fmt) {
      state.exportFormat = fmt;
      pdfCard.classList.toggle('selected', fmt === 'pdf');
      docxCard.classList.toggle('selected', fmt === 'docx');
      extSpan.textContent = '.' + fmt;
    }

    pdfCard.addEventListener('click', () => selectFormat('pdf'));
    docxCard.addEventListener('click', () => selectFormat('docx'));

    singleRadio.addEventListener('change', () => {
      splitOptions.style.display = 'none';
    });
    splitRadio.addEventListener('change', () => {
      splitOptions.style.display = '';
    });
    splitCountInput.addEventListener('input', updateSplitInfo);

    downloadBtn.addEventListener('click', async () => {
      const filename = $('exportFilename').value.trim() || 'tutorial-document';
      const blocks = Editor.getStructuredContent();
      const isSplit = splitRadio.checked;
      const splitCount = parseInt(splitCountInput.value) || 2;

      const config = {
        fontFamily: $('fontFamily').value,
        fontSize: $('fontSize').value,
        lineHeight: $('lineHeight').value,
        pageSize: $('pageSize').value,
        docTheme: $('docTheme').value
      };

      downloadBtn.disabled = true;
      downloadBtn.innerHTML = '<div class="spinner" style="display:inline-block"></div> Generating...';
      progressContainer.classList.add('visible');
      progressFill.style.width = '0%';
      progressLabel.textContent = 'Generating document...';

      try {
        if (state.exportFormat === 'pdf') {
          if (isSplit) {
            const docs = await Exporter.exportPDFSplit(blocks, config, splitCount, (p) => {
              progressFill.style.width = p + '%';
              progressPercent.textContent = p + '%';
              progressLabel.textContent = `Generating split PDFs... ${p}%`;
            });

            for (let i = 0; i < docs.length; i++) {
              docs[i].save(`${filename}_part${i + 1}_of_${docs.length}.pdf`);
              await Utils.delay(800);
            }

            progressLabel.textContent = `✅ ${docs.length} PDF files generated!`;
            Utils.showToast(`${docs.length} PDF files downloaded!`, 'success');
          } else {
            const doc = await Exporter.exportPDF(blocks, config, (p) => {
              progressFill.style.width = p + '%';
              progressPercent.textContent = p + '%';
              progressLabel.textContent = `Generating PDF... ${p}%`;
            });
            doc.save(filename + '.pdf');
            progressLabel.textContent = `✅ PDF generated! (${doc.internal.getNumberOfPages()} pages)`;
            Utils.showToast('PDF downloaded successfully!', 'success');
          }
        } else {
          if (isSplit) {
            const blobs = await Exporter.exportDOCXSplit(blocks, config, splitCount, (p) => {
              progressFill.style.width = p + '%';
              progressPercent.textContent = p + '%';
              progressLabel.textContent = `Generating split DOCX files... ${p}%`;
            });

            for (let i = 0; i < blobs.length; i++) {
              saveAs(blobs[i], `${filename}_part${i + 1}_of_${blobs.length}.docx`);
              await Utils.delay(800);
            }

            progressLabel.textContent = `✅ ${blobs.length} DOCX files generated!`;
            Utils.showToast(`${blobs.length} DOCX files downloaded!`, 'success');
          } else {
            const blob = await Exporter.exportDOCX(blocks, config, (p) => {
              progressFill.style.width = p + '%';
              progressPercent.textContent = p + '%';
              progressLabel.textContent = `Generating DOCX... ${p}%`;
            });
            saveAs(blob, filename + '.docx');
            progressLabel.textContent = '✅ DOCX generated!';
            Utils.showToast('DOCX downloaded successfully!', 'success');
          }
        }
      } catch (e) {
        console.error('Export error:', e);
        Utils.showToast('Export failed: ' + e.message, 'error');
        progressLabel.textContent = '❌ Export failed: ' + e.message;

        // If single-file export failed, suggest splitting
        if (!isSplit) {
          Utils.showToast('💡 Tip: Try splitting into multiple files for long documents', 'info');
        }
      }

      downloadBtn.disabled = false;
      downloadBtn.innerHTML = '⬇️ Download';
    });

    backBtn.addEventListener('click', () => goToStep(4));
  }

  // ===== STEPPER CLICK NAVIGATION =====
  function initStepper() {
    document.querySelectorAll('.step-item').forEach(el => {
      el.addEventListener('click', () => {
        const step = parseInt(el.dataset.step);
        if (step <= state.currentStep) {
          goToStep(step);
        }
      });
    });
  }

  // ===== INIT =====
  function init() {
    initStepper();
    initVideoUpload();
    initTranscript();
    initConfigure();
    initEditor();
    initExport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
