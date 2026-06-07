/**
 * app.js — Bulk processing main controller for TutorialForge
 * Manages multiple tasks, uploader, matched pair file-states, override configurations,
 * sequential worker queue, editor selection, and individual/merged/zipped exports.
 */

(function () {
  'use strict';

  // ===== STATE =====
  const state = {
    tasks: [],             // Array of Task objects
    activeTaskId: null,    // Currently selected task for editor/preview
    isQueueRunning: false, // Sequential worker queue active status
    exportFormat: 'pdf',   // 'pdf' | 'docx'
    estimatedPages: 0
  };

  const $ = (id) => document.getElementById(id);

  // ===== HELPERS =====
  function getGlobalConfig() {
    let interval = parseInt($('captureInterval').value);
    if ($('captureInterval').value === 'custom') {
      interval = parseInt($('customInterval').value) || 10;
    }

    return {
      captureInterval: interval,
      imageQuality: parseInt($('imageQuality').value) || 95,
      maxImgWidth: parseInt($('maxImgWidth').value) || 1280,
      screenshotPlacement: $('screenshotPlacement').value || 'above',
      splitSpeakers: $('splitSpeakers').checked,
      gapThreshold: parseFloat($('gapThreshold').value) || 30,
      timeOffset: parseFloat($('timeOffset').value) || 0
    };
  }

  function getGlobalStyleConfig() {
    return {
      fontFamily: $('fontFamily').value,
      fontSize: $('fontSize').value,
      lineHeight: $('lineHeight').value,
      pageSize: $('pageSize').value,
      docTheme: $('docTheme').value
    };
  }

  function generateId() {
    return 'task_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
  }

  // ===== TASK QUEUE MANAGEMENT =====

  function updateQueueCounters() {
    const total = state.tasks.length;
    $('queueCount').textContent = total;

    const hasQueued = state.tasks.some(t => t.status === 'queued' && t.videoFile);
    $('runQueueBtn').disabled = state.isQueueRunning || !hasQueued;
    $('clearCompletedBtn').disabled = state.isQueueRunning || !state.tasks.some(t => t.status === 'completed');
    $('clearQueueBtn').disabled = state.isQueueRunning || total === 0;

    // Enable/disable export options depending on completed tasks
    const hasCompleted = state.tasks.some(t => t.status === 'completed');
    $('mergeDownloadBtn').disabled = !hasCompleted;
    $('zipDownloadBtn').disabled = !hasCompleted;
  }

  function deleteTask(taskId) {
    if (state.isQueueRunning) return;

    FrameStore.cleanupTask(taskId);
    state.tasks = state.tasks.filter(t => t.id !== taskId);

    if (state.activeTaskId === taskId) {
      state.activeTaskId = null;
      hideEditor();
    }

    renderTaskList();
    updateQueueCounters();
    Utils.showToast('Task removed.', 'info');
  }

  function toggleOverrides(taskId) {
    const el = $(`override-${taskId}`);
    if (el) {
      el.classList.toggle('expanded');
    }
  }

  function handleOverrideChange(taskId, prop, value) {
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
      task.configOverrides[prop] = value;
    }
  }

  // ===== UI RENDERERS =====

  function renderTaskList() {
    const listEl = $('taskList');
    listEl.innerHTML = '';

    if (state.tasks.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📁</span>
          <p>No video or subtitle tasks loaded.</p>
          <p class="empty-hint">Drag and drop folder/files to auto-match files.</p>
        </div>
      `;
      return;
    }

    state.tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = `task-item ${state.activeTaskId === task.id ? 'active' : ''}`;
      card.id = `task-card-${task.id}`;

      // Status class and text
      let statusClass = 'status-queued';
      let statusText = 'Queued';
      if (task.status === 'running') {
        statusClass = 'status-running';
        statusText = `Extracting ${task.progress}%`;
      } else if (task.status === 'completed') {
        statusClass = 'status-completed';
        statusText = 'Completed';
      } else if (task.status === 'error') {
        statusClass = 'status-error';
        statusText = 'Failed';
      }

      // Title & Subtitle files names
      const videoName = task.videoFile ? task.videoFile.name : 'Missing video';
      const subName = task.subtitleFile ? task.subtitleFile.name : 'Missing transcript';

      card.innerHTML = `
        <div class="task-meta-row">
          <div class="task-title-info">
            <span class="task-filename">${videoName}</span>
            <div class="task-tags">
              ${task.videoFile ? `<span class="tag-badge tag-video">MP4</span>` : `<span class="tag-badge tag-unmatched">No Video</span>`}
              ${task.subtitleFile ? `<span class="tag-badge tag-subtitle">SRT/TXT</span>` : `<span class="tag-badge tag-unmatched">No Sub</span>`}
              ${task.status === 'completed' && task.documentBlocks ? `<span class="tag-badge tag-subtitle" style="background: rgba(124,58,237,0.1); color: var(--accent-violet)">${task.documentBlocks.filter(b => b.type==='screenshot'||b.type==='image').length} Frames</span>` : ''}
            </div>
            ${task.videoFile && task.duration ? `<span class="task-filesize">${Utils.formatFileSize(task.videoFile.size)} • ${Utils.formatTime(task.duration)}</span>` : `<span class="task-filesize">${task.videoFile ? Utils.formatFileSize(task.videoFile.size) : ''}</span>`}
          </div>

          <div class="task-actions">
            <span class="status-badge ${statusClass}">${statusText}</span>
            <button class="btn btn-secondary btn-sm" style="padding: 6px 10px;" id="cfg-btn-${task.id}" title="Overrides Settings">⚙️</button>
            <button class="btn btn-primary btn-sm" style="padding: 6px 12px;" id="edit-btn-${task.id}" ${task.status === 'completed' ? '' : 'disabled'} title="Preview and Edit">📝</button>
            <button class="btn btn-ghost btn-sm" style="padding: 6px 10px; color: var(--accent-rose);" id="del-btn-${task.id}" title="Remove Task">✕</button>
          </div>
        </div>

        <div class="task-progress" id="progress-container-${task.id}" style="${task.status === 'running' ? 'display:block' : 'display:none'}">
          <div class="task-progress-fill" id="progress-fill-${task.id}" style="width: ${task.progress}%"></div>
        </div>

        <!-- Overrides Panel -->
        <div class="task-overrides-panel" id="override-${task.id}">
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 12px; border-radius: var(--radius-sm); margin-top: 8px;">
            <div>
              <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:4px;">Capture Interval (s)</label>
              <input type="number" class="override-input" id="ov-interval-${task.id}" value="${task.configOverrides.captureInterval}" min="1" max="600" style="width:100%; padding:4px 8px; font-size:11px;">
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:4px;">Quality (%)</label>
              <input type="number" class="override-input" id="ov-quality-${task.id}" value="${task.configOverrides.imageQuality}" min="30" max="100" style="width:100%; padding:4px 8px; font-size:11px;">
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:4px;">Subtitle Offset (s)</label>
              <input type="number" class="override-input" id="ov-offset-${task.id}" step="0.5" value="${task.configOverrides.timeOffset}" style="width:100%; padding:4px 8px; font-size:11px;">
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-secondary); display:block; margin-bottom:4px;">Gap Threshold (s)</label>
              <input type="number" class="override-input" id="ov-gap-${task.id}" value="${task.configOverrides.gapThreshold}" min="0" style="width:100%; padding:4px 8px; font-size:11px;">
            </div>
            <div style="grid-column: span 2; display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
              <span style="font-size:11px; color:var(--text-secondary)">Split Speakers</span>
              <label class="switch">
                <input type="checkbox" id="ov-split-${task.id}" ${task.configOverrides.splitSpeakers ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;

      listEl.appendChild(card);

      // Event bindings
      $(`cfg-btn-${task.id}`).addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOverrides(task.id);
      });

      $(`edit-btn-${task.id}`).addEventListener('click', (e) => {
        e.stopPropagation();
        selectTask(task.id);
      });

      $(`del-btn-${task.id}`).addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });

      // Bind Override Inputs
      $(`ov-interval-${task.id}`).addEventListener('change', (e) => {
        handleOverrideChange(task.id, 'captureInterval', parseInt(e.target.value) || 10);
      });
      $(`ov-quality-${task.id}`).addEventListener('change', (e) => {
        handleOverrideChange(task.id, 'imageQuality', parseInt(e.target.value) || 95);
      });
      $(`ov-offset-${task.id}`).addEventListener('change', (e) => {
        handleOverrideChange(task.id, 'timeOffset', parseFloat(e.target.value) || 0);
      });
      $(`ov-gap-${task.id}`).addEventListener('change', (e) => {
        handleOverrideChange(task.id, 'gapThreshold', parseFloat(e.target.value) || 30);
      });
      $(`ov-split-${task.id}`).addEventListener('change', (e) => {
        handleOverrideChange(task.id, 'splitSpeakers', e.target.checked);
      });
    });
  }

  // ===== FILE LOADER & MATCHING =====

  async function handleFiles(fileList) {
    if (state.isQueueRunning) return;

    const videos = [];
    const subtitles = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.type.startsWith('video/')) {
        videos.push(file);
      } else if (file.name.endsWith('.srt') || file.name.endsWith('.vtt') || file.name.endsWith('.txt')) {
        subtitles.push(file);
      }
    }

    if (videos.length === 0 && subtitles.length === 0) {
      Utils.showToast('Please select valid video or subtitle files.', 'error');
      return;
    }

    const matched = Utils.matchFiles(videos, subtitles);
    const globalConfig = getGlobalConfig();

    for (const pair of matched) {
      const taskId = generateId();
      
      // Determine display name
      let displayName = 'Task';
      if (pair.videoFile) displayName = pair.videoFile.name;
      else if (pair.subtitleFile) displayName = pair.subtitleFile.name;

      const task = {
        id: taskId,
        name: displayName,
        videoFile: pair.videoFile,
        subtitleFile: pair.subtitleFile,
        status: pair.videoFile ? 'queued' : 'completed', // Completed if no video to extract from
        progress: 0,
        errorMessage: '',
        duration: 0,
        frames: [],
        documentBlocks: [],
        configOverrides: { ...globalConfig } // Copy global settings initially
      };

      // Load duration async
      if (pair.videoFile) {
        try {
          const tempVideo = document.createElement('video');
          tempVideo.src = Utils.createObjectURL(pair.videoFile);
          await new Promise((resolve) => {
            tempVideo.onloadedmetadata = () => {
              task.duration = tempVideo.duration;
              Utils.revokeObjectURL(tempVideo.src);
              resolve();
            };
            tempVideo.onerror = () => resolve();
          });
        } catch (e) {
          console.warn('Failed to parse video duration', e);
        }
      }

      // If text-only task, build default document blocks now
      if (!pair.videoFile && pair.subtitleFile) {
        try {
          const text = await Utils.readFileAsText(pair.subtitleFile);
          const segments = TranscriptParser.parse(text);
          const processed = TranscriptParser.postProcess(segments, task.configOverrides);
          task.documentBlocks = DocumentBuilder.build([], processed, task.configOverrides.screenshotPlacement);
        } catch (e) {
          console.error(e);
          task.status = 'error';
          task.errorMessage = e.message;
        }
      }

      state.tasks.push(task);
    }

    renderTaskList();
    updateQueueCounters();
    Utils.showToast(`Loaded ${matched.length} tasks successfully!`, 'success');
  }

  // ===== CONCURRENCY / sequential QUEUE RUNNER =====

  async function processTask(task) {
    task.status = 'running';
    task.progress = 0;
    renderTaskList();

    // 1. Read and parse Subtitles
    let segments = [];
    if (task.subtitleFile) {
      try {
        const text = await Utils.readFileAsText(task.subtitleFile);
        segments = TranscriptParser.parse(text);
      } catch (e) {
        throw new Error('Subtitle read failed: ' + e.message);
      }
    }

    // 2. Extract frames if video exists
    if (task.videoFile) {
      try {
        const metadata = await VideoProcessor.loadVideo(task.videoFile, task.id);
        task.duration = metadata.duration;

        const interval = task.configOverrides.captureInterval;
        const quality = task.configOverrides.imageQuality / 100;
        const maxW = task.configOverrides.maxImgWidth;

        task.frames = await VideoProcessor.extractFrames(task.id, interval, quality, maxW, (percent, count) => {
          task.progress = percent;
          // Update specific task card progress
          const fill = $(`progress-fill-${task.id}`);
          if (fill) fill.style.width = percent + '%';
          const badge = document.querySelector(`#task-card-${task.id} .status-badge`);
          if (badge) badge.textContent = `Extracting ${percent}%`;
        });
      } catch (e) {
        throw new Error('Video processing failed: ' + e.message);
      } finally {
        VideoProcessor.cleanup();
      }
    }

    // 3. Post-process segments
    const processedSegments = TranscriptParser.postProcess(segments, task.configOverrides);

    // 4. Merge frames and transcripts
    task.documentBlocks = DocumentBuilder.build(task.frames, processedSegments, task.configOverrides.screenshotPlacement);
    task.status = 'completed';
    task.progress = 100;
  }

  async function startQueue() {
    if (state.isQueueRunning) return;
    state.isQueueRunning = true;
    updateQueueCounters();

    const queuedTasks = state.tasks.filter(t => t.status === 'queued');
    const total = queuedTasks.length;

    $('globalProgressContainer').classList.add('visible');

    for (let i = 0; i < total; i++) {
      const task = queuedTasks[i];
      const overallPercent = Math.round((i / total) * 100);
      $('globalProgressFill').style.width = overallPercent + '%';
      $('globalProgressPercent').textContent = overallPercent + '%';
      $('globalProgressLabel').textContent = `Processing job ${i + 1} of ${total}: "${task.name}"`;

      try {
        await processTask(task);
      } catch (e) {
        console.error(e);
        task.status = 'error';
        task.errorMessage = e.message;
        Utils.showToast(`Error on "${task.name}": ${e.message}`, 'error');
      }

      renderTaskList();
      updateQueueCounters();
    }

    $('globalProgressFill').style.width = '100%';
    $('globalProgressPercent').textContent = '100%';
    $('globalProgressLabel').textContent = 'Queue Completed successfully!';
    state.isQueueRunning = false;
    updateQueueCounters();

    // Auto-select first completed task to preview
    const firstCompleted = state.tasks.find(t => t.status === 'completed');
    if (firstCompleted && !state.activeTaskId) {
      selectTask(firstCompleted.id);
    }
  }

  // ===== EDITOR CONTROL =====

  function selectTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'completed') return;

    // Save changes to active task before shifting
    saveActiveTaskChanges();

    state.activeTaskId = taskId;
    $('editorSelectedLabel').textContent = `Editing: ${task.name}`;
    
    // Set format selection UI based on active task or state
    selectFormat(state.exportFormat);
    $('exportFilename').value = task.name.replace(/\.[^/.]+$/, ""); // strip extension
    
    // Render document in editor
    const editorConfig = getGlobalStyleConfig();
    Editor.render(task.documentBlocks, editorConfig);

    // Show preview & export panel
    $('exportOptionsPanel').style.display = 'block';
    $('editorWrapper').style.display = 'flex';

    // Highlight active card
    document.querySelectorAll('.task-item').forEach(card => card.classList.remove('active'));
    const activeCard = $(`task-card-${taskId}`);
    if (activeCard) activeCard.classList.add('active');

    updatePageEstimate();
  }

  function saveActiveTaskChanges() {
    if (!state.activeTaskId) return;
    const task = state.tasks.find(t => t.id === state.activeTaskId);
    if (task && task.status === 'completed') {
      task.documentBlocks = Editor.getStructuredContent();
    }
  }

  function hideEditor() {
    $('editorSelectedLabel').textContent = 'No task selected';
    $('exportOptionsPanel').style.display = 'none';
    $('editorWrapper').style.display = 'none';
    document.querySelectorAll('.task-item').forEach(card => card.classList.remove('active'));
  }

  function updatePageEstimate() {
    if (!state.activeTaskId) return;
    const blocks = Editor.getStructuredContent();
    const config = getGlobalStyleConfig();
    
    const est = Exporter.estimatePages(blocks, config);
    state.estimatedPages = est.pages;

    $('estPageCount').textContent = est.pages;
    $('estImageCount').textContent = est.imageCount;
  }

  // ===== EXPORT TRIGGER HANDLERS =====

  function selectFormat(fmt) {
    state.exportFormat = fmt;
    $('exportPdfCard').classList.toggle('selected', fmt === 'pdf');
    $('exportDocxCard').classList.toggle('selected', fmt === 'docx');
    $('exportExt').textContent = '.' + fmt;
  }

  async function downloadActiveTask() {
    if (!state.activeTaskId) return;
    saveActiveTaskChanges();

    const task = state.tasks.find(t => t.id === state.activeTaskId);
    if (!task) return;

    const filename = $('exportFilename').value.trim() || 'tutorial-document';
    const config = getGlobalStyleConfig();
    const progressEl = $('exportProgress');
    const fill = $('exportProgressFill');
    const label = $('exportProgressLabel');
    const percent = $('exportProgressPercent');

    progressEl.style.display = 'block';
    fill.style.width = '0%';
    percent.textContent = '0%';
    label.textContent = 'Preparing generation...';

    const downloadBtn = $('downloadBtn');
    downloadBtn.disabled = true;

    try {
      if (state.exportFormat === 'pdf') {
        const doc = await Exporter.exportPDF(task.documentBlocks, config, (p) => {
          fill.style.width = p + '%';
          percent.textContent = p + '%';
          label.textContent = `Generating PDF... ${p}%`;
        });
        doc.save(`${filename}.pdf`);
        label.textContent = 'PDF downloaded!';
        Utils.showToast('PDF downloaded successfully!', 'success');
      } else {
        const blob = await Exporter.exportDOCX(task.documentBlocks, config, (p) => {
          fill.style.width = p + '%';
          percent.textContent = p + '%';
          label.textContent = `Generating DOCX... ${p}%`;
        });
        saveAs(blob, `${filename}.docx`);
        label.textContent = 'DOCX downloaded!';
        Utils.showToast('DOCX downloaded successfully!', 'success');
      }
    } catch (e) {
      console.error(e);
      label.textContent = 'Export failed';
      Utils.showToast('Export failed: ' + e.message, 'error');
    } finally {
      downloadBtn.disabled = false;
      setTimeout(() => {
        progressEl.style.display = 'none';
      }, 3000);
    }
  }

  async function downloadMerged() {
    saveActiveTaskChanges();

    const completedTasks = state.tasks.filter(t => t.status === 'completed');
    if (completedTasks.length === 0) {
      Utils.showToast('No completed tasks to merge!', 'error');
      return;
    }

    const filename = prompt('Enter name for the merged document:', 'merged-tutorial-document');
    if (!filename) return;

    const config = getGlobalStyleConfig();
    const progressEl = $('exportProgress');
    const fill = $('exportProgressFill');
    const label = $('exportProgressLabel');
    const percent = $('exportProgressPercent');

    progressEl.style.display = 'block';
    fill.style.width = '0%';
    percent.textContent = '0%';
    label.textContent = 'Merging documents...';

    const mergeBtn = $('mergeDownloadBtn');
    mergeBtn.disabled = true;

    try {
      // Build merged block array: inject heading for each task and page break in between
      const mergedBlocks = [];
      for (let i = 0; i < completedTasks.length; i++) {
        const task = completedTasks[i];
        
        // Add separator page break if not the first task
        if (i > 0) {
          mergedBlocks.push({ type: 'page-break' });
        }

        // Add task title heading
        mergedBlocks.push({ type: 'heading', content: task.name.replace(/\.[^/.]+$/, "") });

        // Add task blocks
        mergedBlocks.push(...task.documentBlocks);
      }

      if (state.exportFormat === 'pdf') {
        const doc = await Exporter.exportPDF(mergedBlocks, config, (p) => {
          fill.style.width = p + '%';
          percent.textContent = p + '%';
          label.textContent = `Generating Merged PDF... ${p}%`;
        });
        doc.save(`${filename}.pdf`);
        label.textContent = 'Merged PDF downloaded!';
        Utils.showToast('Merged PDF downloaded successfully!', 'success');
      } else {
        const blob = await Exporter.exportDOCX(mergedBlocks, config, (p) => {
          fill.style.width = p + '%';
          percent.textContent = p + '%';
          label.textContent = `Generating Merged DOCX... ${p}%`;
        });
        saveAs(blob, `${filename}.docx`);
        label.textContent = 'Merged DOCX downloaded!';
        Utils.showToast('Merged DOCX downloaded successfully!', 'success');
      }
    } catch (e) {
      console.error(e);
      label.textContent = 'Merge failed';
      Utils.showToast('Merge failed: ' + e.message, 'error');
    } finally {
      mergeBtn.disabled = false;
      setTimeout(() => {
        progressEl.style.display = 'none';
      }, 3000);
    }
  }

  async function downloadZIP() {
    saveActiveTaskChanges();

    const completedTasks = state.tasks.filter(t => t.status === 'completed');
    if (completedTasks.length === 0) {
      Utils.showToast('No completed tasks to export!', 'error');
      return;
    }

    const zipFilename = prompt('Enter name for the ZIP archive:', 'tutorial-documents-package');
    if (!zipFilename) return;

    const config = getGlobalStyleConfig();
    const progressEl = $('exportProgress');
    const fill = $('exportProgressFill');
    const label = $('exportProgressLabel');
    const percent = $('exportProgressPercent');

    progressEl.style.display = 'block';
    fill.style.width = '0%';
    percent.textContent = '0%';
    label.textContent = 'Compiling ZIP package...';

    const zipBtn = $('zipDownloadBtn');
    zipBtn.disabled = true;

    try {
      const zipBlob = await Exporter.exportBulkZip(completedTasks, config, state.exportFormat, (p, text) => {
        fill.style.width = p + '%';
        percent.textContent = p + '%';
        label.textContent = text;
      });

      saveAs(zipBlob, `${zipFilename}.zip`);
      label.textContent = 'ZIP package downloaded!';
      Utils.showToast('ZIP archive downloaded successfully!', 'success');
    } catch (e) {
      console.error(e);
      label.textContent = 'ZIP creation failed';
      Utils.showToast('ZIP export failed: ' + e.message, 'error');
    } finally {
      zipBtn.disabled = false;
      setTimeout(() => {
        progressEl.style.display = 'none';
      }, 3000);
    }
  }

  // ===== DASHBOARD INITIALIZATION =====

  function initBulkUploader() {
    const dropZone = $('bulkDropZone');
    const fileInput = $('bulkFileInput');

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
      if (files.length > 0) {
        handleFiles(files);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFiles(fileInput.files);
      }
    });
  }

  function initSettingsBindings() {
    // Quality range label update
    $('imageQuality').addEventListener('input', (e) => {
      $('qualityValue').textContent = e.target.value + '%';
    });

    // Custom capture interval input toggle
    $('captureInterval').addEventListener('change', (e) => {
      $('customIntervalRow').style.display = e.target.value === 'custom' ? 'flex' : 'none';
    });

    // Font selection triggers page estimate refresh
    ['fontFamily', 'fontSize', 'lineHeight', 'pageSize', 'docTheme'].forEach(id => {
      $(id).addEventListener('change', () => {
        if (state.activeTaskId) {
          const config = getGlobalStyleConfig();
          const task = state.tasks.find(t => t.id === state.activeTaskId);
          if (task) {
            Editor.render(task.documentBlocks, config);
            updatePageEstimate();
          }
        }
      });
    });
  }

  function initQueueControls() {
    $('runQueueBtn').addEventListener('click', startQueue);

    $('clearCompletedBtn').addEventListener('click', () => {
      if (state.isQueueRunning) return;
      const completedIds = state.tasks.filter(t => t.status === 'completed').map(t => t.id);
      completedIds.forEach(id => {
        FrameStore.cleanupTask(id);
      });
      state.tasks = state.tasks.filter(t => t.status !== 'completed');
      if (completedIds.includes(state.activeTaskId)) {
        state.activeTaskId = null;
        hideEditor();
      }
      renderTaskList();
      updateQueueCounters();
      Utils.showToast('Cleared completed tasks from queue.', 'info');
    });

    $('clearQueueBtn').addEventListener('click', () => {
      if (state.isQueueRunning) return;
      if (confirm('Are you sure you want to clear the entire queue? All unsaved edits will be lost.')) {
        FrameStore.cleanup();
        state.tasks = [];
        state.activeTaskId = null;
        hideEditor();
        renderTaskList();
        updateQueueCounters();
        $('globalProgressContainer').classList.remove('visible');
        $('globalProgressFill').style.width = '0%';
        $('globalProgressPercent').textContent = '0%';
        $('globalProgressLabel').textContent = 'Queue Idle';
        Utils.showToast('Entire queue cleared.', 'info');
      }
    });
  }

  function initExportFormat() {
    $('exportPdfCard').addEventListener('click', () => selectFormat('pdf'));
    $('exportDocxCard').addEventListener('click', () => selectFormat('docx'));
    $('downloadBtn').addEventListener('click', downloadActiveTask);
    $('mergeDownloadBtn').addEventListener('click', downloadMerged);
    $('zipDownloadBtn').addEventListener('click', downloadZIP);
  }

  // ===== INITIALIZER =====

  function init() {
    // 1. Initialize core submodules
    Editor.init();

    // 2. Bind dashboard events
    initBulkUploader();
    initSettingsBindings();
    initQueueControls();
    initExportFormat();

    // Reset initial UI states
    updateQueueCounters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
