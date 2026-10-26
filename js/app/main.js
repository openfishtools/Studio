/**
 * OpenFishTools Studio - Main JavaScript
 * Handles data fetching from FishDatabase, New Project creation,
 * Your Project listing, ContextMenu integration, and package version.
 */

// Fallback empty projects list
const FALLBACK_PROJECTS = [];

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initUiScaleForCurrentPage();
  initSettingsModal();
  initUIProtections();
  initVersionFetcher();
  initProjectsFetcher();
  initWelcomeModal();
  if (window.FolderAnim && typeof window.FolderAnim.initDesktopFolders === 'function') {
    window.FolderAnim.initDesktopFolders();
  }

  // Purge all non-essential caches when opening index.html (preserves projects and media)
  if (typeof window.cleanupAllStudioCaches === 'function') {
    window.cleanupAllStudioCaches('index_init').catch(() => {});
  }

  // Handle redirect errors from editor (ghost project guard)
  const _urlErr = new URLSearchParams(window.location.search).get('error');
  if (_urlErr) {
    const _errMessages = {
      project_not_found: 'Project tidak ditemukan atau sudah dihapus.'
    };
    setTimeout(() => showDashboardToast(_errMessages[_urlErr] || 'Project tidak valid.', 4000), 600);
    // Clean the ?error= from URL bar without reload
    history.replaceState(null, '', window.location.pathname);
  }
});

/**
 * Disables browser context menu (right click), zoom, and text selection
 */
function initUIProtections() {
  // Disable text selection drag
  document.addEventListener('selectstart', (e) => {
    // Allow input and textarea elements to be selected
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });

  // Disable Ctrl + Wheel Zoom
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  // Disable Ctrl/Cmd + (+, -, 0, =) Zoom keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', '_'].includes(e.key)) {
      e.preventDefault();
    }
  });

  // Disable Safari/iOS Multi-touch Gestures (Pinch to zoom)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());
}

/**
 * Formats raw package version into clean short form:
 * e.g., "0.1.0-pre-alpha" -> "0.1.0 PA"
 */
function formatAppVersion(raw) {
  if (!raw) return '';
  let str = String(raw).trim().replace(/^v\.?/i, '');
  
  let tag = '';
  if (/[-_.\s]pre[-_.\s]?alpha$/i.test(str)) {
    tag = 'Pre-Alpha';
    str = str.replace(/[-_.\s]pre[-_.\s]?alpha$/i, '');
  } else if (/[-_.\s]alpha$/i.test(str)) {
    tag = 'Alpha';
    str = str.replace(/[-_.\s]alpha$/i, '');
  } else if (/[-_.\s]beta$/i.test(str)) {
    tag = 'Beta';
    str = str.replace(/[-_.\s]beta$/i, '');
  }
  
  const numPart = str.replace(/[-_]/g, '.');
  return tag ? `${numPart} ${tag}` : numPart;
}

/**
 * Formats relative timestamp for project card
 */
function formatRelativeTime(isoString) {
  if (!isoString) return 'Just now';
  const timestamp = new Date(isoString).getTime();
  if (isNaN(timestamp)) return 'Just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Dynamically detects latest version tag and synchronizes version pills/badges
 * across Studio navbar and Welcome changelog modal without hardcoding tag literals.
 */
function syncWelcomeVersionTags(pkgVersion) {
  let detected = pkgVersion;
  if (!detected) {
    const firstPill = document.querySelector('.welcome-changelog-feed .welcome-version-pill');
    if (firstPill && firstPill.textContent) {
      detected = firstPill.textContent.trim();
    }
  }
  if (!detected) {
    return;
  }

  const cleanNum = String(detected).trim().replace(/^v\.?/i, '');
  const displayTag = `v${cleanNum}`;
  if (typeof window !== 'undefined') {
    window.OFT_VERSION = cleanNum;
  }

  // 1. Sync Studio top navbar badge
  const badgeEl = document.getElementById('studio-version-badge');
  if (badgeEl) {
    badgeEl.textContent = formatAppVersion(cleanNum);
  }

  // 2. Sync Welcome modal header badge
  const welcomeBadge = document.querySelector('.welcome-header-title-box .welcome-badge');
  if (welcomeBadge) {
    welcomeBadge.textContent = displayTag;
  }

  // 3. Dynamically assign Latest badge only to the first version block
  const blocks = document.querySelectorAll('.welcome-changelog-feed .welcome-version-block');
  blocks.forEach((block, index) => {
    const header = block.querySelector('.welcome-version-header');
    let latestBadge = block.querySelector('.welcome-version-badge-latest');
    if (index === 0) {
      if (!latestBadge && header) {
        latestBadge = document.createElement('span');
        latestBadge.className = 'welcome-version-badge-latest';
        latestBadge.textContent = 'Latest';
        const pill = header.querySelector('.welcome-version-pill');
        if (pill && pill.nextSibling) {
          header.insertBefore(latestBadge, pill.nextSibling);
        } else {
          header.appendChild(latestBadge);
        }
      }
      const pill = block.querySelector('.welcome-version-pill');
      if (pill && !pill.textContent.trim()) {
        pill.textContent = displayTag;
      }
    } else {
      if (latestBadge) {
        latestBadge.remove();
      }
    }
  });
}

/**
 * Fetches version metadata and updates the badges dynamically
 */
async function initVersionFetcher() {
  if (window.location.protocol === 'file:') {
    syncWelcomeVersionTags();
    return;
  }

  try {
    const response = await fetch('./version.json');
    if (response.ok) {
      const data = await response.json();
      if (data && data.version) {
        syncWelcomeVersionTags(data.version);
        return;
      }
    }
  } catch (_) {}

  syncWelcomeVersionTags();
}

/**
 * Loads projects from FishDatabase and populates the "Your Project" list and "Uploaded Projects" list
 */
async function initProjectsFetcher() {
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');
  const uploadedListContainer = document.getElementById('uploaded-projects-container');
  const uploadedCountBadge = document.getElementById('uploaded-count-badge');

  const tabLocal = document.getElementById('tab-local-projects');
  const tabUploaded = document.getElementById('tab-uploaded-projects');
  const panelLocal = document.getElementById('panel-local-projects');
  const panelUploaded = document.getElementById('panel-uploaded-projects');

  async function loadAndRender() {
    // 1. Instant zero-latency render from synchronous mirror (0ms latency!)
    if (window.FishDatabase && typeof window.FishDatabase.getProjectsSync === 'function') {
      try {
        const instant = window.FishDatabase.getProjectsSync();
        if (Array.isArray(instant)) {
          renderProjects(instant, listContainer, countBadge);
        }
      } catch (_) {}
    }

    // 2. Background revalidation from database
    let projects = [];
    if (window.FishDatabase && typeof window.FishDatabase.getProjects === 'function') {
      try {
        projects = await window.FishDatabase.getProjects();
      } catch (e) {
        projects = [];
      }
    }
    if (Array.isArray(projects) && projects.length >= 0) {
      renderProjects(projects, listContainer, countBadge);
    }
  }
  window.loadAndRender = loadAndRender;

  function loadAndRenderUploaded() {
    let uploaded = [];
    if (window.FishDatabase && typeof window.FishDatabase.getUploadedProjects === 'function') {
      try {
        uploaded = window.FishDatabase.getUploadedProjects();
      } catch (e) {
        uploaded = [];
      }
    }
    renderUploadedProjects(uploaded, uploadedListContainer, uploadedCountBadge);
  }

  // Dual tab switcher (Your Projects vs Uploaded Projects)
  if (tabLocal && tabUploaded) {
    tabLocal.addEventListener('click', () => {
      tabLocal.classList.add('is-active');
      tabLocal.setAttribute('aria-selected', 'true');
      tabUploaded.classList.remove('is-active');
      tabUploaded.setAttribute('aria-selected', 'false');
      if (panelLocal) panelLocal.style.display = 'flex';
      if (panelUploaded) panelUploaded.style.display = 'none';
    });

    tabUploaded.addEventListener('click', () => {
      tabUploaded.classList.add('is-active');
      tabUploaded.setAttribute('aria-selected', 'true');
      tabLocal.classList.remove('is-active');
      tabLocal.setAttribute('aria-selected', 'false');
      if (panelLocal) panelLocal.style.display = 'none';
      if (panelUploaded) panelUploaded.style.display = 'flex';
      loadAndRenderUploaded();
    });
  }

  // Initial load
  if (listContainer) await loadAndRender();
  if (uploadedListContainer) loadAndRenderUploaded();

  // Listen to custom DB project update events
  window.addEventListener('fish-db-projects-updated', () => {
    loadAndRender();
  });
  window.addEventListener('fish-db-uploaded-projects-updated', () => {
    loadAndRenderUploaded();
  });

  // Local Project item left-click navigation (delegated)
  if (listContainer) {
    listContainer.addEventListener('click', (e) => {
      const swipeBox = e.target.closest('.project-swipe-container');
      if (swipeBox && swipeBox._hasSwiped) {
        return;
      }
      const item = e.target.closest('.project-item');
      if (!item) return;
      const projectId = item.dataset.id;
      if (projectId) {
        const targetPage = resolveTargetEditorPage();
        window.location.href = `${targetPage}?id=${encodeURIComponent(projectId)}`;
      }
    });
  }

  // Uploaded Project item actions (delegated)
  if (uploadedListContainer) {
    uploadedListContainer.addEventListener('click', async (e) => {
      // 1. Copy link button (icon only)
      const copyBtn = e.target.closest('.btn-copy-uploaded-link');
      if (copyBtn) {
        e.stopPropagation();
        const url = copyBtn.dataset.url;
        if (url) {
          const cleanUrl = url.replace(/^https?:\/\//i, '');
          try {
            await navigator.clipboard.writeText(cleanUrl);
            showDashboardToast('Link copied to clipboard!');
          } catch (_) {}
        }
        return;
      }

      // 2. View QR button (icon only)
      const qrBtn = e.target.closest('.btn-view-uploaded-qr');
      if (qrBtn) {
        e.stopPropagation();
        const id = qrBtn.dataset.id;
        const list = window.FishDatabase ? window.FishDatabase.getUploadedProjects() : [];
        const item = list.find(p => p && String(p.id) === String(id));
        if (item) {
          openDashboardQRModal(item);
        }
        return;
      }

      // 3. Remove button (icon only)
      const removeBtn = e.target.closest('.btn-remove-uploaded');
      if (removeBtn) {
        e.stopPropagation();
        const id = removeBtn.dataset.id;
        if (id && window.FishDatabase) {
          window.FishDatabase.removeUploadedProject(id);
          loadAndRenderUploaded();
          showDashboardToast('Removed from uploaded projects');
        }
        return;
      }

      // 4. Clicked card body -> trigger preset import preview
      const card = e.target.closest('.uploaded-project-item');
      if (card) {
        const id = card.dataset.id;
        const list = window.FishDatabase ? window.FishDatabase.getUploadedProjects() : [];
        const item = list.find(p => p && String(p.id) === String(id));
        if (item) {
          triggerUploadedProjectImport(item);
        }
      }
    });
  }

  // Attach Right-Click & Press-Hold ContextMenu
  if (window.ContextMenu && typeof window.ContextMenu.bindTrigger === 'function') {
    window.ContextMenu.bindTrigger(listContainer, '.project-item', (target) => {
      const projectId = target.dataset.id || target.closest('.project-swipe-container')?.dataset?.id || '';
      const projectName = target.querySelector('.project-name')?.textContent || target.closest('.project-swipe-container')?.dataset?.name || 'Project';
      return [
        {
          label: 'Save as .ofts',
          icon: '<i class="fticon fticon-export-presets-json" aria-hidden="true"></i>',
          action: (el) => exportProjectAction(projectId || el?.dataset?.id, projectName || el?.querySelector('.project-name')?.textContent)
        },
        {
          label: 'Share as Link',
          icon: '<i class="fticon fticon-icon-8" aria-hidden="true"></i>',
          action: (el) => openShareProjectLinkModal(projectId || el?.dataset?.id, projectName || el?.querySelector('.project-name')?.textContent)
        },
        {
          label: 'Project Settings',
          icon: '<i class="fticon fticon-icon-9" aria-hidden="true"></i>',
          action: (el) => openProjectSettingsModal(projectId || el?.dataset?.id)
        },
        {
          label: 'Duplicate',
          icon: '<i class="fticon fticon-copy-link" aria-hidden="true"></i>',
          action: async (el) => {
            const pid = projectId || el?.dataset?.id;
            if (pid && window.FishDatabase) {
              await window.FishDatabase.duplicateProject(pid);
              await loadAndRender();
            }
          }
        },
        { divider: true },
        {
          label: 'Remove project',
          icon: '<i class="fticon fticon-delete-beatmark" aria-hidden="true"></i>',
          danger: true,
          action: (el) => openDeleteModal(projectId || el?.dataset?.id, projectName || el?.querySelector('.project-name')?.textContent)
        }
      ];
    });
  }
}

/**
 * Resolves whether to open desktop.html or editor.html (mobile)
 * Automatically routes mobile/Android/iOS/narrow screens (< 900px) to editor.html.
 */
function resolveTargetEditorPage() {
  if (typeof getAlwaysMobileSetting === 'function' && getAlwaysMobileSetting()) {
    return 'editor.html';
  }

  const ua = navigator.userAgent || '';
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|SM-G/i.test(ua) ||
    (window.matchMedia && window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches) ||
    window.innerWidth < 900;

  const preferred = localStorage.getItem('oft_preferred_view');

  if (isMobile) {
    if (preferred === 'desktop' && window.innerWidth >= 900) {
      return 'desktop.html';
    }
    return 'editor.html';
  }

  if (preferred === 'mobile') {
    return 'editor.html';
  }
  return 'desktop.html';
}
window.resolveTargetEditorPage = resolveTargetEditorPage;



/**
 * Renders project cards inside the Your Project list with swipe actions
 */
function renderProjects(projects, container, countBadge) {
  if (countBadge) {
    countBadge.textContent = String(projects ? projects.length : 0);
    countBadge.setAttribute('title', `${projects ? projects.length : 0} Total Projects`);
  }

  if (!container) return;

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="projects-empty">
        <div class="projects-empty-icon" aria-hidden="true">
          <i class='fticon fticon-icon-10' aria-hidden='true'></i>
        </div>
        <span>No projects found in database</span>
      </div>
    `;
    return;
  }

  container.innerHTML = projects.map(project => {
    const name = project.name || 'Untitled Project';
    const size = project.size || '12 KB';
    const savedTime = formatRelativeTime(project.updatedAt || project.createdAt);
    const specs = `${escapeHtml(project.resolution || '1080p')} • ${escapeHtml(project.fps || '60')} fps`;

    return `
      <div class="project-swipe-container" data-id="${escapeHtml(project.id)}" data-name="${escapeHtml(name)}">
        <!-- Slide RIGHT reveals Delete (Left side) -->
        <div class="project-swipe-action action-delete" aria-hidden="true" title="Slide right to delete">
          <i class='fticon fticon-delete-selected-layer' aria-hidden='true'></i>
          <span>Delete</span>
        </div>

        <!-- Slide LEFT reveals Export to .ofts (Right side) -->
        <div class="project-swipe-action action-export" aria-hidden="true" title="Slide left to export">
          <span>Export .ofts</span>
          <i class='fticon fticon-slide-left-to-export' aria-hidden='true'></i>
        </div>

        <!-- Top Layer Project Item Card -->
        <article class="project-item" data-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Project: ${escapeHtml(name)}">
          <div class="project-thumb-box" aria-hidden="true">
            ${project.thumbnail ? `
              <img class="project-thumb-img" src="${project.thumbnail}" alt="" loading="lazy" />
            ` : `
              <div class="project-thumb-placeholder">
                <i class='fticon fticon-share-project-link-dialog' aria-hidden='true'></i>
              </div>
            `}
          </div>
          <div class="project-info">
            <div class="project-row-main">
              <span class="project-name">${escapeHtml(name)}</span>
              <span class="project-size" data-project-size-id="${escapeHtml(project.id)}">${escapeHtml(size)}</span>
            </div>
            <div class="project-row-sub">
              <span class="project-saved">${escapeHtml(savedTime)}</span>
              <span class="project-specs">${specs}</span>
            </div>
          </div>
        </article>
      </div>
    `;
  }).join('');

  bindProjectSwipeGestures(container);

  // Asynchronously compute and hydrate true total project size (JSON + Media + Frame Caches)
  if (window.FishDatabase && typeof window.FishDatabase.getProjectTotalSize === 'function') {
    (projects || []).forEach(project => {
      if (!project || !project.id) return;
      window.FishDatabase.getProjectTotalSize(project.id).then(res => {
        if (!res || !res.formatted) return;
        const selector = (window.CSS && typeof window.CSS.escape === 'function')
          ? `.project-size[data-project-size-id="${window.CSS.escape(project.id)}"]`
          : `.project-size[data-project-size-id="${project.id}"]`;
        const sizeBadge = container.querySelector(selector);
        if (sizeBadge) {
          sizeBadge.textContent = res.formatted;
          const tooltip = `${res.formatted} (${res.bytes.toLocaleString()} bytes)\n• Project: ${res.breakdown.jsonFormatted}\n• Media: ${res.breakdown.mediaFormatted}\n• Cache: ${res.breakdown.cacheFormatted}`;
          sizeBadge.setAttribute('title', tooltip);
        }
        if (project.size !== res.formatted) {
          project.size = res.formatted;
          project.sizeBytes = res.bytes;
          if (typeof window.FishDatabase.updateProjectSize === 'function') {
            window.FishDatabase.updateProjectSize(project.id, res.formatted, res.bytes);
          }
        }
      }).catch(() => {});
    });
  }
}

/**
 * Renders uploaded/shared projects in the Uploaded Projects tab
 */
function renderUploadedProjects(projects, container, countBadge) {
  if (countBadge) {
    countBadge.textContent = String(projects ? projects.length : 0);
    countBadge.setAttribute('title', `${projects ? projects.length : 0} Uploaded Projects`);
  }

  if (!container) return;

  if (!projects || projects.length === 0) {
    container.innerHTML = `
      <div class="projects-empty">
        <div class="projects-empty-icon" aria-hidden="true">
          <i class='fticon fticon-icon-11' aria-hidden='true'></i>
        </div>
        <span>No uploaded projects yet</span>
        <span style="font-size:12px;color:var(--text-muted);margin-top:4px;">Projects exported as link will appear here</span>
      </div>
    `;
    return;
  }

  container.innerHTML = projects.map(project => {
    const name = project.name || 'Untitled Project';
    const size = project.size || '1.0 MB';
    const savedTime = formatRelativeTime(project.createdAt || Date.now());
    const specs = `${escapeHtml(project.specs || '1080p • 60 fps')}`;
    const shareUrl = project.shareUrl || `${window.location.origin}/${project.id}`;

    return `
      <div class="project-swipe-container" data-id="${escapeHtml(project.id)}">
        <article class="project-item uploaded-project-item" data-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Uploaded Project: ${escapeHtml(name)}">
          <div class="project-thumb-box" aria-hidden="true">
            ${project.thumbnail ? `
              <img class="project-thumb-img" src="${project.thumbnail}" alt="" loading="lazy" />
            ` : `
              <div class="project-thumb-placeholder">
                <i class='fticon fticon-share-project-link-dialog' aria-hidden='true'></i>
              </div>
            `}
          </div>
          <div class="project-info">
            <div class="project-row-main">
              <span class="project-name">${escapeHtml(name)}</span>
              <span class="project-size">${escapeHtml(size)}</span>
            </div>
            <div class="project-row-sub">
              <span class="project-saved">${escapeHtml(savedTime)}</span>
              <span class="project-specs">${specs}</span>
            </div>
          </div>
          <!-- Action Buttons (Copy Link, QR, Remove - Icon only) -->
          <div class="uploaded-actions">
            <button type="button" class="uploaded-btn-action btn-copy-uploaded-link" data-url="${escapeHtml(shareUrl)}" title="Copy Link" aria-label="Copy Link">
              <i class='fticon fticon-btn-generate-project-link' style='width:16px;height:16px;font-size:16px;line-height:1;' aria-hidden='true'></i>
            </button>
            <button type="button" class="uploaded-btn-action btn-view-uploaded-qr" data-id="${escapeHtml(project.id)}" title="View QR Code" aria-label="View QR Code">
              <i class='fticon fticon-view-qr-code' style='width:16px;height:16px;font-size:16px;line-height:1;' aria-hidden='true'></i>
            </button>
            <button type="button" class="uploaded-btn-action btn-remove-uploaded" data-id="${escapeHtml(project.id)}" title="Remove" aria-label="Remove">
              <i class='fticon fticon-delete-selected-layer' style='width:15px;height:15px;font-size:15px;line-height:1;' aria-hidden='true'></i>
            </button>
          </div>
        </article>
      </div>
    `;
  }).join('');
}

const STUDIO_REMOTE_ORIGIN = 'https://studio.cutefish.my.id';

function getStudioApiUrl(apiPath) {
  if (
    window.location.protocol === 'file:' ||
    window.__OFT_NATIVE_APP__ ||
    (window.location.hostname &&
      window.location.hostname !== 'studio.cutefish.my.id' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1')
  ) {
    return STUDIO_REMOTE_ORIGIN + apiPath;
  }
  return apiPath;
}
window.getStudioApiUrl = getStudioApiUrl;

/**
 * Triggers link project import flow when clicking an uploaded project card
 */
async function triggerUploadedProjectImport(project) {
  if (!project || !project.id) return;
  showDashboardToast('Fetching project...');
  try {
    const res = await fetch(getStudioApiUrl(`/api/project?id=${encodeURIComponent(project.id)}`));
    const data = await res.json();
    if (res.ok && data.success && data.project) {
      showPresetConfirmModal(data.project);
      return;
    }
  } catch (_) {}
  showPresetConfirmModal(project);
}

/**
 * Binds touch & pointer swipe gestures for project cards:
 * Slide RIGHT -> Delete project
 * Slide LEFT  -> Export project to .ofts
 */
function bindProjectSwipeGestures(container) {
  const swipeContainers = container.querySelectorAll('.project-swipe-container');

  swipeContainers.forEach(swipeBox => {
    const itemEl = swipeBox.querySelector('.project-item');
    const deleteAction = swipeBox.querySelector('.action-delete');
    const exportAction = swipeBox.querySelector('.action-export');
    if (!itemEl) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isPointerDown = false;
    let isDragging = false;
    let isLockedDirection = false;
    let isVerticalScroll = false;
    let activePointerId = null;

    const SWIPE_TRIGGER_THRESHOLD = 75; // px to trigger action
    const MAX_DRAG_DISTANCE = 140; // max visual drag boundary

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;

      startX = e.clientX;
      startY = e.clientY;
      currentX = 0;
      isPointerDown = true;
      isDragging = false;
      isLockedDirection = false;
      isVerticalScroll = false;
      activePointerId = e.pointerId;

      itemEl.style.transition = 'none';
    };

    const onPointerMove = (e) => {
      if (!isPointerDown || e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!isLockedDirection) {
        if (Math.hypot(dx, dy) >= 6) {
          isLockedDirection = true;
          if (Math.abs(dy) > Math.abs(dx)) {
            isVerticalScroll = true;
            return;
          } else {
            isDragging = true;
            try {
              itemEl.setPointerCapture(e.pointerId);
            } catch (err) {}
          }
        } else {
          return;
        }
      }

      if (isVerticalScroll || !isDragging) return;

      e.preventDefault();

      // Non-linear drag resistance beyond 85px
      let targetX = dx;
      if (Math.abs(targetX) > 85) {
        const excess = Math.abs(targetX) - 85;
        const sign = targetX > 0 ? 1 : -1;
        targetX = sign * (85 + excess * 0.35);
      }
      currentX = Math.max(-MAX_DRAG_DISTANCE, Math.min(MAX_DRAG_DISTANCE, targetX));
      itemEl.style.transform = `translateX(${currentX}px)`;

      // Dynamic action reveal feedback
      if (currentX > 0) {
        // Swiping RIGHT -> Delete
        if (deleteAction) {
          deleteAction.style.opacity = '1';
          if (currentX >= SWIPE_TRIGGER_THRESHOLD) {
            deleteAction.classList.add('is-ready');
          } else {
            deleteAction.classList.remove('is-ready');
          }
        }
        if (exportAction) exportAction.style.opacity = '0';
      } else if (currentX < 0) {
        // Swiping LEFT -> Export
        if (exportAction) {
          exportAction.style.opacity = '1';
          if (Math.abs(currentX) >= SWIPE_TRIGGER_THRESHOLD) {
            exportAction.classList.add('is-ready');
          } else {
            exportAction.classList.remove('is-ready');
          }
        }
        if (deleteAction) deleteAction.style.opacity = '0';
      } else {
        if (deleteAction) deleteAction.style.opacity = '0';
        if (exportAction) exportAction.style.opacity = '0';
      }
    };

    const onPointerEnd = (e) => {
      if (!isPointerDown || (e.pointerId !== activePointerId && activePointerId !== null)) return;
      isPointerDown = false;

      try {
        if (itemEl.hasPointerCapture(e.pointerId)) {
          itemEl.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      if (isDragging) {
        swipeBox._hasSwiped = true;
        setTimeout(() => {
          swipeBox._hasSwiped = false;
        }, 320);

        const finalX = currentX;

        // Animate snap-back to origin
        itemEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
        itemEl.style.transform = 'translateX(0px)';

        if (finalX >= SWIPE_TRIGGER_THRESHOLD) {
          // Slide RIGHT -> Delete confirmation modal
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          openDeleteModal(projectId, projectName);
        } else if (finalX <= -SWIPE_TRIGGER_THRESHOLD) {
          // Slide LEFT -> Export to .ofts
          const projectId = swipeBox.dataset.id;
          const projectName = swipeBox.dataset.name;
          exportProjectAction(projectId, projectName);
        }

        setTimeout(() => {
          if (deleteAction) {
            deleteAction.style.opacity = '';
            deleteAction.classList.remove('is-ready');
          }
          if (exportAction) {
            exportAction.style.opacity = '';
            exportAction.classList.remove('is-ready');
          }
          itemEl.style.transition = '';
        }, 240);
      }

      activePointerId = null;
      isDragging = false;
      isLockedDirection = false;
      isVerticalScroll = false;
    };

    itemEl.addEventListener('pointerdown', onPointerDown);
    itemEl.addEventListener('pointermove', onPointerMove);
    itemEl.addEventListener('pointerup', onPointerEnd);
    itemEl.addEventListener('pointercancel', onPointerEnd);

    // Direct click fallback on revealed actions
    if (deleteAction) {
      deleteAction.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(swipeBox.dataset.id, swipeBox.dataset.name);
      });
    }
    if (exportAction) {
      exportAction.addEventListener('click', (e) => {
        e.stopPropagation();
        exportProjectAction(swipeBox.dataset.id, swipeBox.dataset.name);
      });
    }
  });
}

/**
 * Basic XSS sanitizer for safe template string rendering
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Opens the Project Settings Modal and populates existing configuration
 */
async function openProjectSettingsModal(projectId) {
  if (!projectId) return;

  let project = null;
  if (window.FishDatabase && typeof window.FishDatabase.getProject === 'function') {
    try {
      project = await window.FishDatabase.getProject(projectId);
    } catch (e) {
      console.warn('Failed to load project for settings:', e);
    }
  }

  if (!project) return;

  const idInput = document.getElementById('settings-project-id');
  const nameInput = document.getElementById('settings-input-name');
  if (idInput) idInput.value = projectId;
  if (nameInput) nameInput.value = project.name || '';

  // 1. Aspect Ratio Frame
  const aspectVal = project.aspectRatio || '16:9';
  const aspectGrid = document.getElementById('settings-options-aspect-ratio');
  if (aspectGrid) {
    aspectGrid.querySelectorAll('.aspect-ratio-frame').forEach(f => {
      f.classList.toggle('is-selected', f.dataset.val === aspectVal);
    });
  }

    // 2. Resolution Dropdown / Custom
  const resVal = project.resolution || '1080p';
  const resDropdown = document.getElementById('settings-dropdown-resolution');
  
  if (aspectVal === 'Custom' || resVal.includes('x')) {
    const parts = resVal.split('x');
    const w = document.getElementById('settings-custom-res-w');
    const h = document.getElementById('settings-custom-res-h');
    if (w && parts[0]) w.value = parts[0];
    if (h && parts[1]) h.value = parts[1];
    window.toggleResolutionUI('settings-container-resolution', 'Custom');
  } else {
    window.toggleResolutionUI('settings-container-resolution', aspectVal);
    if (resDropdown) {
      resDropdown.dataset.value = resVal;
      const label = resDropdown.querySelector('.custom-dropdown-label');
      if (label) label.textContent = resVal;
      resDropdown.querySelectorAll('.custom-dropdown-item').forEach(item => {
        item.classList.toggle('is-selected', item.dataset.val === resVal);
      });
    }
  }

    // 3. FPS Input
  const fpsVal = String(project.fps || '60');
  const fpsInput = document.getElementById('settings-input-fps');
  if (fpsInput) fpsInput.value = fpsVal;

  // 4. Background Color Swatch
  const bgVal = project.bgColor || 'transparent';
  const bgRow = document.getElementById('settings-options-bgcolor');
  if (bgRow) {
    bgRow.querySelectorAll('.modal-color-swatch').forEach(s => {
      s.classList.toggle('is-selected', s.dataset.val === bgVal);
    });
    // Stored custom color: reflect it on the custom swatch when no preset matches
    if (!bgRow.querySelector('.modal-color-swatch.is-selected') && /^#[0-9a-f]{6}$/i.test(bgVal || '')) {
      const custom = bgRow.querySelector('.swatch-custom');
      if (custom) {
        custom.dataset.val = bgVal;
        custom.style.backgroundColor = bgVal;
        custom.classList.add('is-selected', 'is-picked');
      }
    }
  }

  if (window.Modal) {
    window.Modal.open('modal-project-settings');
  }

  setTimeout(() => {
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }, 80);
}

/**
 * Saves updated project settings (name, aspect ratio, resolution, fps, background color)
 */
async function saveProjectSettingsAction() {
  const idInput = document.getElementById('settings-project-id');
  const nameInput = document.getElementById('settings-input-name');
  const projectId = idInput ? idInput.value : '';
  if (!projectId || !window.FishDatabase) return;

  const newName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Project';
    const selectedRatio = document.querySelector('#settings-options-aspect-ratio .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
  let selectedRes = '1080p';
  if (selectedRatio === 'Custom') {
    const w = document.getElementById('settings-custom-res-w')?.value || '1920';
    const h = document.getElementById('settings-custom-res-h')?.value || '1080';
    selectedRes = `${w}x${h}`;
  } else {
    selectedRes = document.getElementById('settings-dropdown-resolution')?.dataset.value || '1080p';
  }
  const selectedFps = document.getElementById('settings-input-fps')?.value || '60';
  const selectedBg = document.querySelector('#settings-options-bgcolor .modal-color-swatch.is-selected')?.dataset.val || 'transparent';

  if (window.Modal) {
    window.Modal.close();
  }

  try {
    const project = await window.FishDatabase.getProject(projectId);
    if (project) {
      project.name = newName;
      project.aspectRatio = selectedRatio;
      project.resolution = selectedRes;
      project.fps = selectedFps;
      project.bgColor = selectedBg;
      await window.FishDatabase.saveProject(project);
      showDashboardToast('Project settings saved');
    }
  } catch (err) {
    console.warn('Failed to save project settings:', err);
    showDashboardToast('Failed to save settings');
  }
}

/**
 * Legacy compatibility wrappers
 */
function openRenameModal(projectId, currentName) {
  openProjectSettingsModal(projectId);
}

async function saveRenameProjectAction() {
  await saveProjectSettingsAction();
}

/**
 * Opens the Delete Project Confirmation Modal
 */
function openDeleteModal(projectId, currentName) {
  const modal = document.getElementById('modal-delete-project');
  const idInput = document.getElementById('delete-project-id');
  const targetNameEl = document.getElementById('delete-target-name');
  const promptEl = document.getElementById('delete-project-prompt');
  if (!modal || !idInput) return;

  idInput.value = projectId || '';
  const displayName = `"${currentName || 'Untitled'}"`;
  if (targetNameEl) {
    targetNameEl.textContent = displayName;
  } else if (promptEl) {
    promptEl.textContent = `Delete project ${displayName}?`;
  }

  if (window.Modal) {
    window.Modal.open('modal-delete-project');
  }
}

/**
 * Confirms deletion of project from modal
 */
async function confirmDeleteProjectAction() {
  const idInput = document.getElementById('delete-project-id');
  let projectId = idInput ? idInput.value : '';

  if (window.Modal) {
    window.Modal.close('modal-delete-project');
  }

  // Immediately remove card from DOM for instant feedback
  const listContainer = document.getElementById('projects-container');
  const countBadge = document.getElementById('project-count-badge');

  // Fallback: If projectId was empty, match by target name or single remaining card
  if (!projectId) {
    const targetNameEl = document.getElementById('delete-target-name');
    const rawName = targetNameEl ? targetNameEl.textContent.replace(/^"|"$/g, '').trim() : '';
    if (rawName && window.FishDatabase) {
      try {
        const all = await window.FishDatabase.getProjects();
        const found = all.find(p => p && (p.name === rawName || p.id === rawName));
        if (found) projectId = found.id;
      } catch (_) {}
    }
    if (!projectId && listContainer) {
      const cards = listContainer.querySelectorAll('.project-swipe-container');
      if (cards.length === 1 && cards[0].dataset.id) {
        projectId = cards[0].dataset.id;
      }
    }
  }

  if (listContainer && projectId) {
    const cards = listContainer.querySelectorAll('.project-swipe-container');
    cards.forEach(card => {
      if (card.dataset.id === projectId || card.dataset.name === projectId) {
        card.remove();
      }
    });
    const remaining = listContainer.querySelectorAll('.project-swipe-container').length;
    if (countBadge) {
      countBadge.textContent = String(remaining);
      countBadge.setAttribute('title', `${remaining} Total Projects`);
    }
    if (remaining === 0) {
      renderProjects([], listContainer, countBadge);
    }
  }

  if (projectId && window.FishDatabase) {
    try {
      await window.FishDatabase.deleteProject(projectId);
      showDashboardToast('Project deleted successfully');
    } catch (e) {
      console.warn('Delete project error:', e);
      showDashboardToast('Failed to delete project');
    }
  }

  // Refresh project list from database
  if (listContainer && window.FishDatabase) {
    try {
      let projects = await window.FishDatabase.getProjects();
      if (projectId) {
        projects = projects.filter(p => p && p.id !== projectId && String(p.id).trim() !== String(projectId).trim());
      }
      renderProjects(projects, listContainer, countBadge);
    } catch (_) {}
  }
}

/**
 * Exports project as .ofts package
 */
async function exportProjectAction(projectId, projectName) {
  showDashboardToast(`Exporting ${projectName || 'project'}...`);

  if (window.FishDatabase && typeof window.FishDatabase.exportProjectToOFTS === 'function') {
    try {
      await window.FishDatabase.exportProjectToOFTS(projectId);
      showDashboardToast('.ofts export completed');
    } catch (err) {
      console.warn('Export project error:', err);
      showDashboardToast('Failed to export .ofts file');
    }
  }
}

/**
 * Opens Share Project Link modal from dashboard
 */
/**
 * Re-compresses project thumbnail to tiny 200px JPEG (~3-5KB) to guarantee minimal KV storage
 */
async function compressThumbnailForShare(thumbDataUrl, maxDim = 200, quality = 0.55) {
  if (!thumbDataUrl || typeof thumbDataUrl !== 'string') return '';
  if (thumbDataUrl.length < 8000 && (thumbDataUrl.startsWith('data:image/jpeg;base64,') || thumbDataUrl.startsWith('data:image/webp;base64,'))) {
    return thumbDataUrl;
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 200;
          const h = img.naturalHeight || img.height || 112;
          let targetW = maxDim;
          let targetH = Math.max(1, Math.round(maxDim * (h / w)));
          if (h > w) {
            targetH = maxDim;
            targetW = Math.max(1, Math.round(maxDim * (w / h)));
          }
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed || (thumbDataUrl.length <= 30000 ? thumbDataUrl : ''));
        } catch (_) {
          resolve(thumbDataUrl.length <= 30000 ? thumbDataUrl : '');
        }
      };
      img.onerror = () => resolve(thumbDataUrl.length <= 30000 ? thumbDataUrl : '');
      img.src = thumbDataUrl;
    } catch (_) {
      resolve('');
    }
  });
}
window.compressThumbnailForShare = compressThumbnailForShare;

/**
 * Generates an HD 3:4 (900x1200) thumbnail Blob from project thumbnail
 */
async function generateHDQRThumbnailBlob(thumbSrc) {
  if (!thumbSrc || typeof thumbSrc !== 'string') return null;
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = 900, H = 1200;
          const off = document.createElement('canvas');
          off.width = W;
          off.height = H;
          const ctx = off.getContext('2d');
          ctx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim() || 'transparent');
          ctx.fillRect(0, 0, W, H);
          const iW = img.naturalWidth || img.width;
          const iH = img.naturalHeight || img.height;
          const scale = Math.max(W / iW, H / iH);
          const sW = W / scale;
          const sH = H / scale;
          const sX = (iW - sW) / 2;
          const sY = (iH - sH) / 2;
          ctx.drawImage(img, sX, sY, sW, sH, 0, 0, W, H);
          off.toBlob((blob) => {
            resolve(blob);
          }, 'image/jpeg', 0.85);
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = thumbSrc;
    } catch (_) {
      resolve(null);
    }
  });
}

async function openShareProjectLinkModal(projectId, projectName) {
  if (!projectId || !window.FishDatabase) return;
  const project = await window.FishDatabase.getProject(projectId);
  if (!project) return;

  showDashboardToast('Packaging project for share link...');

  try {
    // Generate HD 3:4 (900x1200) thumbnail for archive and Catbox
    const hdThumbBlob = await generateHDQRThumbnailBlob(project.thumbnail || '');

    const zipBlob = await window.FishDatabase.exportProjectToOFTS(projectId, {
      skipDownload: true,
      thumbnailBlob: hdThumbBlob
    });

    if (!zipBlob) {
      showDashboardToast('Failed to package project');
      return;
    }

    const MAX_SHARE_SIZE = 15 * 1024 * 1024; // 15MB
    if (zipBlob.size > MAX_SHARE_SIZE) {
      const formattedSize = window.FishDatabase ? window.FishDatabase.formatBytes(zipBlob.size) : (zipBlob.size / (1024 * 1024)).toFixed(1) + ' MB';
      alert(`Project size (${formattedSize}) exceeds the 15MB share limit.\n\nCloud link sharing is limited to 15MB. Please save the project directly to your local device (.ofts).`);
      return;
    }

    showDashboardToast('Uploading to storage...');

    // Guarantee ultra-compressed fallback thumbnail (~3-5KB)
    const compressedThumb = await compressThumbnailForShare(project.thumbnail || '');

    const fd = new FormData();
    fd.append('file', zipBlob, (project.name || 'Project') + '.ofts');
    if (hdThumbBlob) {
      fd.append('thumbnailFile', hdThumbBlob, `${(project.name || 'Project').replace(/[^a-zA-Z0-9_-]/g, '_')}_thumb.jpg`);
    }
    fd.append('name', project.name || 'Untitled Project');
    fd.append('specs', `${project.resolution || '1080p'} • ${project.fps || 60} fps`);
    fd.append('aspectRatio', project.aspectRatio || '16:9');
    fd.append('size', window.FishDatabase ? window.FishDatabase.formatBytes(zipBlob.size) : (zipBlob.size / (1024 * 1024)).toFixed(1) + ' MB');
    fd.append('thumbnail', compressedThumb);

    const shareToken = localStorage.getItem('oft_share_token') || '';
    const headers = {};
    if (shareToken) headers['x-share-token'] = shareToken;

    const res = await fetch(getStudioApiUrl('/api/share'), {
      method: 'POST',
      headers,
      body: fd
    });

    let json = {};
    try {
      json = await res.json();
    } catch (_) {}

    if (!res.ok || !json.success || !json.shareUrl) {
      const errMsg = json.error || (res.status === 401 ? 'Token tidak ada, cek .env mu' : 'Share upload failed');
      showDashboardToast(errMsg);
      return;
    }

    // Save to persistent uploaded projects
    const rec = {
      id: String(json.id),
      name: (json.record && json.record.name) || project.name || 'Untitled Project',
      specs: (json.record && json.record.specs) || `${project.resolution || '1080p'} • ${project.fps || 60} fps`,
      size: (json.record && json.record.size) || window.FishDatabase.formatBytes(zipBlob.size),
      aspectRatio: (json.record && json.record.aspectRatio) || project.aspectRatio || '16:9',
      thumbnail: (json.record && json.record.thumbnail) || project.thumbnail || '',
      shareUrl: json.shareUrl,
      fileUrl: (json.record && json.record.fileUrl) || json.catboxUrl || '',
      createdAt: (json.record && json.record.createdAt) || Date.now()
    };

    window.FishDatabase.saveUploadedProject(rec);
    showDashboardToast('Share link created!');

    // Open QR modal directly
    openDashboardQRModal(rec);
  } catch (err) {
    console.error('[Dashboard:ShareLink]', err);
    showDashboardToast('Failed to generate project link: ' + (err.message || err));
  }
}
window.openShareProjectLinkModal = openShareProjectLinkModal;

let dashboardToastTimer = null;

/**
 * Displays a non-intrusive dashboard toast notification
 */
function showDashboardToast(text, duration = 2400, type = 'info') {
  let toast = document.getElementById('dashboard-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dashboard-toast';
    toast.className = 'dashboard-toast';
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  if (type === 'error' || type === 'warn') {
    toast.classList.add('toast-error');
  } else {
    toast.classList.remove('toast-error');
  }
  toast.classList.add('is-visible');

  if (dashboardToastTimer) {
    clearTimeout(dashboardToastTimer);
  }

  dashboardToastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.classList.remove('toast-error');
  }, duration);
}

/**
 * Creates project and navigates to editor
 */
let isCreatingNewProject = false;

async function createNewProjectAction() {
  if (isCreatingNewProject) return;
  isCreatingNewProject = true;

  const createBtn = document.querySelector('#modal-new-project .modal-btn-create');
  if (createBtn) {
    createBtn.style.opacity = '0.6';
    createBtn.style.pointerEvents = 'none';
  }

  try {
    const nameInput = document.getElementById('project-input-name');
    const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'New_Project';
    
        const selectedRatio = document.querySelector('#options-aspect-ratio .aspect-ratio-frame.is-selected')?.dataset.val || '16:9';
    let selectedRes = '1080p';
    if (selectedRatio === 'Custom') {
      const w = document.getElementById('custom-res-w')?.value || '1920';
      const h = document.getElementById('custom-res-h')?.value || '1080';
      selectedRes = `${w}x${h}`;
    } else {
      selectedRes = document.getElementById('dropdown-resolution')?.dataset.value || '1080p';
    }
    const selectedFps = document.getElementById('input-fps')?.value || '60';
    const selectedBg = document.querySelector('#options-bgcolor .modal-color-swatch.is-selected')?.dataset.val || 'transparent';

    const projectId = 'prj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    if (window.FishDatabase && typeof window.FishDatabase.createProject === 'function') {
      try {
        await Promise.race([
          window.FishDatabase.createProject({
            id: projectId,
            name: name,
            aspectRatio: selectedRatio,
            resolution: selectedRes,
            fps: selectedFps,
            bgColor: selectedBg
          }),
          new Promise(function (r) { setTimeout(r, 200); })
        ]);
      } catch (err) {
        console.warn('FishDatabase createProject error, using fallback:', err);
      }
    }

    // Close modal without triggering history.back (prevents navigation abort in Safari)
    if (window.Modal) {
      window.Modal.close(false);
    }

    const query = new URLSearchParams({
      id: projectId,
      name: name,
      aspect: selectedRatio,
      resolution: selectedRes,
      fps: selectedFps,
      bg: selectedBg
    });

    const targetPage = typeof resolveTargetEditorPage === 'function' ? resolveTargetEditorPage() : 'editor.html';
    window.location.href = `${targetPage}?${query.toString()}`;
  } catch (err) {
    console.error('Failed to create new project:', err);
    isCreatingNewProject = false;
    if (createBtn) {
      createBtn.style.opacity = '1';
      createBtn.style.pointerEvents = 'auto';
    }
  }
}

/**
 * Initializes interactive option selectors for modal dialogs (Custom Dropdowns, Aspect Frames, Swatches)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Custom Themed Dropdowns
  document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
    const trigger = dropdown.querySelector('.custom-dropdown-trigger');
    const label = dropdown.querySelector('.custom-dropdown-label');
    const items = dropdown.querySelectorAll('.custom-dropdown-item');

    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown.is-open').forEach(other => {
          if (other !== dropdown) other.classList.remove('is-open');
        });
        dropdown.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', dropdown.classList.contains('is-open'));
      });
    }

    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = item.dataset.val;
        dropdown.dataset.value = val;
        if (label) label.textContent = item.textContent;
        items.forEach(i => i.classList.remove('is-selected'));
        item.classList.add('is-selected');
        dropdown.classList.remove('is-open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    });
  });

  // Close custom dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown.is-open').forEach(dropdown => {
      dropdown.classList.remove('is-open');
      const trigger = dropdown.querySelector('.custom-dropdown-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  });

  // Aspect Ratio Visual Frames
  document.querySelectorAll('.modal-aspect-grid').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const frame = e.target.closest('.aspect-ratio-frame');
      if (!frame) return;
      grid.querySelectorAll('.aspect-ratio-frame').forEach(f => f.classList.remove('is-selected'));
      frame.classList.add('is-selected');

      const isSettings = grid.id === 'settings-options-aspect-ratio';
      const containerId = isSettings ? 'settings-container-resolution' : 'container-resolution';
      if (typeof window.toggleResolutionUI === 'function') {
        window.toggleResolutionUI(containerId, frame.dataset.val);
      }
    });
  });

  // Color Swatches
  document.querySelectorAll('.modal-color-swatches').forEach(row => {
    row.addEventListener('click', (e) => {
      const swatch = e.target.closest('.modal-color-swatch');
      if (!swatch) return;
      row.querySelectorAll('.modal-color-swatch').forEach(s => s.classList.remove('is-selected'));
      swatch.classList.add('is-selected');
    });
    // Custom background swatch: universal FishColorPicker popover (above the modal)
    row.addEventListener('click', (e) => {
      const custom = e.target.closest('.swatch-custom');
      if (!custom || !window.FishColorPicker || typeof window.FishColorPicker.open !== 'function') return;
      const apply = (hex) => {
        if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
        custom.dataset.val = hex;
        custom.style.backgroundColor = hex;
        custom.classList.add('is-picked');
        row.querySelectorAll('.modal-color-swatch').forEach(s => s.classList.remove('is-selected'));
        custom.classList.add('is-selected');
      };
      window.FishColorPicker.open({
        anchor: custom,
        color: (/^#[0-9a-f]{6}$/i.test(custom.dataset.val || '') ? custom.dataset.val : '#ffffff'),
        onChange: (hex) => apply(hex),
        onCommit: (hex) => apply(hex),
        onClose: () => {
          const pop = document.getElementById('popover-color-picker');
          if (pop) pop.style.zIndex = '';
        }
      });
      const pop = document.getElementById('popover-color-picker');
      if (pop) pop.style.zIndex = '10002';
    });
  });

  // Modular Settings Category Accordion Expand/Collapse (Capture phase)
  document.addEventListener('click', (e) => {
    const header = e.target.closest('.settings-category-header');
    if (!header) return;
    const category = header.closest('.settings-category');
    if (!category) return;
    const isCollapsed = category.classList.toggle('is-collapsed');
    header.setAttribute('aria-expanded', String(!isCollapsed));
  }, true);

  // Modular Drag & Drop Zones
  document.querySelectorAll('.modal-dropzone').forEach(dropzone => {
    const fileInput = dropzone.querySelector('input[type="file"]');
    const statusEl = dropzone.querySelector('.dropzone-file-status');

    dropzone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });

    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (fileInput) fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files, dropzone, statusEl);
      }
    });

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          handleImportedFiles(fileInput.files, dropzone, statusEl);
        }
      });
    }
  });

  // Enter key support for project inputs
  const newNameInput = document.getElementById('project-input-name');
  if (newNameInput) {
    newNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createNewProjectAction();
      }
    });
  }

  const renameInput = document.getElementById('rename-input-name');
  if (renameInput) {
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRenameProjectAction();
      }
    });
  }

  const settingsInput = document.getElementById('settings-input-name');
  if (settingsInput) {
    settingsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveProjectSettingsAction();
      }
    });
  }

  // Wire Copy button for dashboard Share Link modal
  const btnIndexCopy = document.getElementById('btn-index-copy-project-link');
  if (btnIndexCopy && !btnIndexCopy._wired) {
    btnIndexCopy._wired = true;
    btnIndexCopy.addEventListener('click', async (e) => {
      e.preventDefault();
      const input = document.getElementById('index-share-project-link-input');
      if (input && input.value) {
        const cleanVal = input.value.replace(/^https?:\/\//i, '');
        try {
          await navigator.clipboard.writeText(cleanVal);
          const orig = btnIndexCopy.textContent;
          btnIndexCopy.textContent = 'Copied!';
          showDashboardToast('Link copied to clipboard!');
          setTimeout(() => { btnIndexCopy.textContent = orig; }, 1800);
        } catch (_) {}
      }
    });
  }

  // ==========================================================================
  // MODULAR POP-UP: IMPORT PROJECT (File Dropzone & Link Switcher + Preset Confirm)
  // ==========================================================================
  setupImportProjectModal();
});

// Active shared project state
let activeSharedProject = null;

function extractProjectId(raw) {
  if (!raw) return '';
  const str = String(raw).trim().replace(/^#/, '');
  // Handle ofts://import/<id> or fishtools://import/<id> or ofts://<id>
  const schemeMatch = str.match(/^(?:ofts|fishtools):\/\/(?:import\/|project\/|p\/)?([a-zA-Z0-9_-]+)/i);
  if (schemeMatch && schemeMatch[1]) return schemeMatch[1].trim();
  // Handle #import=<id> or ?import=<id> or deeplink=<url>
  if (str.startsWith('import=') || str.startsWith('deeplink=')) {
    const eqVal = decodeURIComponent(str.split('=').slice(1).join('='));
    return extractProjectId(eqVal);
  }
  try {
    const normalized = /^https?:\/\//i.test(str) ? str : (str.includes('cutefish.my.id') ? 'https://' + str : str);
    const parsed = new URL(normalized, window.location.origin && window.location.origin !== 'null' ? window.location.origin : STUDIO_REMOTE_ORIGIN);
    const queryId = parsed.searchParams.get('import') || parsed.searchParams.get('p') || parsed.searchParams.get('project') || parsed.searchParams.get('id');
    if (queryId) return queryId.replace(/[^a-zA-Z0-9_-]/g, '').trim();
    const dl = parsed.searchParams.get('deeplink');
    if (dl) return extractProjectId(dl);
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length > 0) {
      const last = segs[segs.length - 1].trim();
      if (!last.endsWith('.html')) return last.replace(/[^a-zA-Z0-9_-]/g, '');
    }
  } catch (_) {}
  const parts = str.split('/');
  return parts[parts.length - 1].replace(/[^a-zA-Z0-9_-]/g, '').trim();
}

function isRunningInsideNativeApp() {
  try {
    const proto = (window.location && window.location.protocol) || '';
    const ua = (navigator && navigator.userAgent) || '';
    return (
      proto === 'file:' ||
      proto === 'tauri:' ||
      proto === 'asset:' ||
      proto === 'app:' ||
      Boolean(window.__OFT_NATIVE_APP__) ||
      Boolean(window.__TAURI_INTERNALS__) ||
      Boolean(window.__TAURI__) ||
      /FishToolsStudio/i.test(ua)
    );
  } catch (_) {
    return false;
  }
}

function triggerOpenInFishToolsApp(projectId) {
  if (!projectId || isRunningInsideNativeApp()) return;
  const safeId = encodeURIComponent(projectId);
  const deepLinkUri = `ofts://import/${safeId}`;
  try {
    // Direct navigation triggers browser external protocol prompt ("Open FishTools Studio.app?")
    window.location.href = deepLinkUri;
  } catch (_) {
    try {
      const a = document.createElement('a');
      a.href = deepLinkUri;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
    } catch (_) {}
  }
}

function showPresetConfirmModal(project) {
  activeSharedProject = project;
  const nameEl = document.getElementById('preset-confirm-name');
  const specsEl = document.getElementById('preset-confirm-specs');
  const thumbBox = document.getElementById('preset-confirm-thumb-box');
  const statusEl = document.getElementById('preset-confirm-status');
  const btn = document.getElementById('btn-do-preset-import');

  if (nameEl) nameEl.textContent = project.name || 'Shared Project';
  if (specsEl) {
    const parts = [project.specs, project.size].filter(Boolean);
    specsEl.textContent = parts.join(' • ') || 'Ready to import';
  }
  if (statusEl) {
    statusEl.className = 'modal-import-status';
    statusEl.textContent = '';
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Import';
  }

  if (thumbBox) {
    thumbBox.textContent = '';
    const isSafeThumb = typeof project.thumbnail === 'string' &&
      (project.thumbnail.startsWith('data:image/') ||
       project.thumbnail.startsWith('https://') ||
       project.thumbnail.startsWith('http://'));
    if (isSafeThumb) {
      thumbBox.classList.add('skeleton-loading');
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.2s ease;';
      img.onload = () => {
        thumbBox.classList.remove('skeleton-loading');
        img.style.opacity = '1';
      };
      img.onerror = () => {
        thumbBox.classList.remove('skeleton-loading');
        thumbBox.innerHTML = '<i class="fticon fticon-icon-12" style="width:22px;height:22px;font-size:22px;line-height:1;" aria-hidden="true"></i>';
      };
      img.src = project.thumbnail;
      thumbBox.appendChild(img);
    } else {
      thumbBox.classList.remove('skeleton-loading');
      const ph = document.createElement('div');
      ph.className = 'project-thumb-placeholder';
      ph.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--color-primary);background-color:var(--bg-canvas);';
      ph.innerHTML = '<i class="fticon fticon-icon-12" style="width:22px;height:22px;font-size:22px;line-height:1;" aria-hidden="true"></i>';
      thumbBox.appendChild(ph);
    }
  }

  // Close welcome modal or import modal before opening preset confirm to prevent modal/morph collision
  const welcomeEl = document.getElementById('modal-welcome');
  if (welcomeEl && welcomeEl.classList.contains('is-active')) {
    welcomeEl.classList.remove('is-active');
  }
  const importModalEl = document.getElementById('modal-import-project');
  if (importModalEl && (importModalEl.classList.contains('is-active') || importModalEl._isClosingWithMorph)) {
    if (window.FolderAnim && typeof window.FolderAnim._resetModalInstantly === 'function') {
      window.FolderAnim._resetModalInstantly(importModalEl);
    } else {
      importModalEl.classList.remove('is-active');
    }
  }
  if (window.Modal) {
    if (window.Modal.activeModal && (window.Modal.activeModal.id === 'modal-welcome' || window.Modal.activeModal.id === 'modal-import-project')) {
      window.Modal.activeModal = null;
    }
    window.Modal.open('modal-preset-confirm');
  }
}

function setupImportProjectModal() {
  const tabFile = document.getElementById('import-tab-file');
  const tabLink = document.getElementById('import-tab-link');
  const panelFile = document.getElementById('import-panel-file');
  const panelLink = document.getElementById('import-panel-link');
  const linkInput = document.getElementById('import-project-link-input');
  const statusText = document.getElementById('import-link-status-text');
  const btnSubmitLink = document.getElementById('btn-submit-import-link');
  const fileDropzone = document.getElementById('import-file-dropzone');
  const fileInput = document.getElementById('import-file-input');
  const fileStatus = document.getElementById('import-file-status');

  // 1. Icon-only Tab Switcher (File vs Link)
  if (tabFile && tabLink) {
    tabFile.addEventListener('click', () => {
      tabFile.classList.add('is-active');
      tabFile.setAttribute('aria-selected', 'true');
      tabLink.classList.remove('is-active');
      tabLink.setAttribute('aria-selected', 'false');
      if (panelFile) panelFile.style.display = 'block';
      if (panelLink) panelLink.style.display = 'none';
    });

    tabLink.addEventListener('click', () => {
      tabLink.classList.add('is-active');
      tabLink.setAttribute('aria-selected', 'true');
      tabFile.classList.remove('is-active');
      tabFile.setAttribute('aria-selected', 'false');
      if (panelFile) panelFile.style.display = 'none';
      if (panelLink) panelLink.style.display = 'block';
      if (linkInput) linkInput.focus();
    });
  }

  // 2. File Ingestion (.ofts dropzone)
  if (fileDropzone && fileInput) {
    fileDropzone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(name => {
      fileDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend'].forEach(name => {
      fileDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.remove('is-dragover');
      });
    });

    fileDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropzone.classList.remove('is-dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportedFiles(e.dataTransfer.files, fileDropzone, fileStatus);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleImportedFiles(fileInput.files, fileDropzone, fileStatus);
      }
    });
  }

  // 3. Link Ingestion: NOT realtime! Only fetch when clicking Import or Enter
  async function triggerLinkFetch() {
    const val = (linkInput?.value || '').trim();
    if (!val) {
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Please enter a project link or ID';
      }
      return;
    }

    const id = extractProjectId(val);
    if (!id) {
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Invalid link or project ID';
      }
      return;
    }

    // Offline pre-check
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
      if (statusText) {
        statusText.className = 'modal-import-status is-error';
        statusText.textContent = 'Tidak ada koneksi internet';
      }
      if (btnSubmitLink) {
        btnSubmitLink.disabled = false;
        btnSubmitLink.textContent = 'Import';
      }
      return;
    }

    if (btnSubmitLink) {
      btnSubmitLink.disabled = true;
      btnSubmitLink.textContent = 'Checking...';
    }
    if (statusText) {
      statusText.className = 'modal-import-status';
      statusText.textContent = 'Checking project availability...';
    }

    try {
      const res = await fetch(getStudioApiUrl(`/api/project?id=${encodeURIComponent(id)}`));
      const data = await res.json();

      if (!res.ok || !data.success || !data.project) {
        if (statusText) {
          statusText.className = 'modal-import-status is-error';
          statusText.textContent = 'Project Not Found';
        }
        if (btnSubmitLink) {
          btnSubmitLink.disabled = false;
          btnSubmitLink.textContent = 'Import';
        }
        return;
      }

      // Found: close link modal & open clean preset confirmation modal
      if (btnSubmitLink) {
        btnSubmitLink.disabled = false;
        btnSubmitLink.textContent = 'Import';
      }
      if (statusText) statusText.textContent = '';
      showPresetConfirmModal(data.project);
    } catch (err) {
      const isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        (err && (err.name === 'TypeError' || /network|fetch|offline|failed|abort/i.test(err.message || '')));
      if (isOffline) {
        showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
        if (statusText) {
          statusText.className = 'modal-import-status is-error';
          statusText.textContent = 'Tidak ada koneksi internet';
        }
      } else {
        if (statusText) {
          statusText.className = 'modal-import-status is-error';
          statusText.textContent = 'Project Not Found';
        }
      }
      if (btnSubmitLink) {
        btnSubmitLink.disabled = false;
        btnSubmitLink.textContent = 'Import';
      }
    }
  }

  if (btnSubmitLink) {
    btnSubmitLink.addEventListener('click', (e) => {
      e.preventDefault();
      triggerLinkFetch();
    });
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerLinkFetch();
      }
    });
  }

  // 4. Confirm Preset Import button
  const btnDoPresetImport = document.getElementById('btn-do-preset-import');
  if (btnDoPresetImport) {
    btnDoPresetImport.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!activeSharedProject || !activeSharedProject.id) return;

      // Offline pre-check
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
        const confirmStatus = document.getElementById('preset-confirm-status');
        if (confirmStatus) {
          confirmStatus.className = 'modal-import-status is-error';
          confirmStatus.textContent = 'Tidak ada koneksi internet. Gagal mengunduh paket preset.';
        }
        return;
      }

      // If opened in a regular web browser on studio.cutefish.my.id, trigger opening FishTools Studio app
      if (!isRunningInsideNativeApp()) {
        triggerOpenInFishToolsApp(activeSharedProject.id);
      }

      const confirmStatus = document.getElementById('preset-confirm-status');
      if (confirmStatus) {
        confirmStatus.className = 'modal-import-status';
        confirmStatus.textContent = 'Downloading package from Catbox storage...';
      }
      btnDoPresetImport.disabled = true;
      btnDoPresetImport.textContent = 'Importing...';

      try {
        const downloadUrl = getStudioApiUrl(`/api/project?id=${encodeURIComponent(activeSharedProject.id)}&download=1`);
        let res = null;
        try {
          res = await fetch(downloadUrl);
        } catch (_) {}
        if ((!res || !res.ok) && activeSharedProject.fileUrl) {
          res = await fetch(activeSharedProject.fileUrl);
        }
        if (!res || !res.ok) throw new Error('Download failed: ' + (res ? res.status : 'network error'));
        const blob = await res.blob();

        if (confirmStatus) confirmStatus.textContent = 'Extracting layers & assets into IndexedDB...';
        const file = new File([blob], (activeSharedProject.name || 'Project') + '.ofts', { type: 'application/octet-stream' });

        if (!window.FishDatabase || typeof window.FishDatabase.importOFTSPackage !== 'function') {
          throw new Error('Database import module unavailable');
        }

        const imported = await window.FishDatabase.importOFTSPackage(file, (stageMsg) => {
          if (confirmStatus && stageMsg) confirmStatus.textContent = stageMsg;
        });
        if (confirmStatus) {
          confirmStatus.className = 'modal-import-status is-ready';
          confirmStatus.textContent = 'Import successful! Opening project...';
        }

        setTimeout(() => {
          if (window.Modal) window.Modal.close(false);
          const targetPage = resolveTargetEditorPage();
          window.location.href = `${targetPage}?id=${encodeURIComponent(imported.id)}&template=1`;
        }, 250);
      } catch (err) {
        console.error('[FishImport:Preset]', err);
        const isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
          (err && (err.name === 'TypeError' || /network|fetch|offline|failed|abort/i.test(err.message || '')));
        if (isOffline) {
          showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
        }
        if (confirmStatus) {
          confirmStatus.className = 'modal-import-status is-error';
          confirmStatus.textContent = isOffline
            ? 'Tidak ada koneksi internet. Gagal mengunduh paket preset.'
            : 'Import failed: ' + (err.message || err);
        }
        btnDoPresetImport.disabled = false;
        btnDoPresetImport.textContent = 'Import';
      }
    });
  }

  // Auto-detect incoming project link in URL (/1 or ?import=1 or deep link)
  checkIncomingProjectImportLink();
}

function clearIncomingImportUrl() {
  try {
    sessionStorage.removeItem('oft_pending_import_id');
    window.__OFT_DEEPLINK__ = null;
    if (window.history && typeof window.history.replaceState === 'function') {
      const url = new URL(window.location.href);
      let changed = false;
      ['import', 'project', 'p', 'deeplink'].forEach((k) => {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      });
      if (url.hash && /import/i.test(url.hash)) {
        url.hash = '';
        changed = true;
      }
      if (window.location.protocol !== 'file:') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 1 && !['index.html', 'editor.html', 'desktop.html', 'demo.html', 'privacy.html', 'terms.html'].includes(segments[0])) {
          url.pathname = '/';
          changed = true;
        }
      }
      if (changed) {
        const cleanSearch = url.searchParams.toString() ? '?' + url.searchParams.toString() : '';
        const cleanHash = url.hash || '';
        window.history.replaceState({}, document.title, (url.pathname || '/') + cleanSearch + cleanHash);
      }
    }
  } catch (_) {}
}

let _lastOpenedPresetId = '';
let _lastOpenedPresetTime = 0;
let _isOpeningPreset = false;

async function openPresetById(importId) {
  if (!importId) return;
  clearIncomingImportUrl();
  const now = Date.now();
  if (_lastOpenedPresetId === importId && (now - _lastOpenedPresetTime) < 3000) {
    return;
  }
  _lastOpenedPresetId = importId;
  _lastOpenedPresetTime = now;
  _isOpeningPreset = true;

  // Offline pre-check
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _isOpeningPreset = false;
    showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
    return;
  }

  try {
    const res = await fetch(getStudioApiUrl(`/api/project?id=${encodeURIComponent(importId)}`));
    const data = await res.json();
    if (res.ok && data.success && data.project) {
      setTimeout(() => {
        showPresetConfirmModal(data.project);
      }, 150);
    } else {
      _isOpeningPreset = false;
      alert('Project Not Found (file may have been deleted or expired).');
    }
  } catch (err) {
    _isOpeningPreset = false;
    const isOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      (err && (err.name === 'TypeError' || /network|fetch|offline|failed|abort/i.test(err.message || '')));
    if (isOffline) {
      showDashboardToast('Tidak ada koneksi internet. Periksa jaringan Anda untuk mengimpor preset.', 4000, 'error');
    } else {
      alert('Project Not Found');
    }
  }
}
window.openPresetById = openPresetById;

window.onNativeDeepLinkReceived = function (url) {
  if (!url) return;
  const id = extractProjectId(url);
  if (id) {
    openPresetById(id);
  }
};

async function checkIncomingProjectImportLink() {
  const url = new URL(window.location.href);
  let importId = url.searchParams.get('import') || url.searchParams.get('p') || url.searchParams.get('project');

  if (!importId && url.searchParams.get('deeplink')) {
    importId = extractProjectId(url.searchParams.get('deeplink'));
  }
  if (!importId && window.location.hash && window.location.hash.length > 1) {
    importId = extractProjectId(decodeURIComponent(window.location.hash.slice(1)));
  }
  if (!importId && window.__OFT_DEEPLINK__) {
    importId = extractProjectId(window.__OFT_DEEPLINK__);
    window.__OFT_DEEPLINK__ = null;
  }
  if (!importId) {
    try {
      const pending = sessionStorage.getItem('oft_pending_import_id');
      if (pending) {
        sessionStorage.removeItem('oft_pending_import_id');
        importId = extractProjectId(pending);
      }
    } catch (_) {}
  }
  if (!importId && window.location.protocol !== 'file:') {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length === 1 && !['index.html', 'editor.html', 'desktop.html', 'demo.html', 'privacy.html', 'terms.html'].includes(segments[0])) {
      importId = segments[0];
    }
  }

  if (importId) {
    clearIncomingImportUrl();
    _isOpeningPreset = true;
    if (!isRunningInsideNativeApp()) {
      triggerOpenInFishToolsApp(importId);
    }
    await openPresetById(importId);
  }

  if (!window.__oftDeepLinkWatcherStarted) {
    window.__oftDeepLinkWatcherStarted = true;
    window.addEventListener('hashchange', () => {
      if (window.location.hash && window.location.hash.length > 1) {
        const hid = extractProjectId(decodeURIComponent(window.location.hash.slice(1)));
        clearIncomingImportUrl();
        if (hid) openPresetById(hid);
      }
    });
  }
}

/**
 * Handles imported .ofts project file
 */
async function handleImportedFiles(files, dropzone, statusEl) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file || !file.name.toLowerCase().endsWith('.ofts')) {
    alert('Only .ofts files are supported');
    return;
  }

  dropzone.classList.add('has-file');
  if (statusEl) {
    statusEl.textContent = `Importing ${file.name}...`;
  }

  let importedProject = null;

  if (window.FishDatabase && typeof window.FishDatabase.importOFTSPackage === 'function') {
    try {
      importedProject = await window.FishDatabase.importOFTSPackage(file);
    } catch (e) {
      console.warn('OFTS package import error:', e);
      alert('Failed to import .ofts file');
    }
  }

  setTimeout(() => {
    if (window.Modal) window.Modal.close(false);
    dropzone.classList.remove('has-file');
    if (statusEl) statusEl.textContent = '';
    
    if (importedProject && importedProject.id) {
      const targetPage = resolveTargetEditorPage();
      window.location.href = `${targetPage}?id=${encodeURIComponent(importedProject.id)}&template=1`;
    } else {
      if (typeof window.loadAndRender === 'function') window.loadAndRender();
    }
  }, 300);
}

/**
 * Storage usage status in Settings modal & Welcome modal.
 * Simple: "X MB of Y GB" + progress bar. No hyperbole.
 */
async function updateStorageDurabilityUI() {
  const statusEl = document.getElementById('settings-storage-status') || document.getElementById('welcome-storage-status');
  const fillEl = document.getElementById('settings-storage-fill') || document.getElementById('welcome-storage-fill');
  const btnEl = document.getElementById('settings-storage-btn') || document.getElementById('welcome-storage-btn');
  const usedEl = document.getElementById('settings-storage-used');
  const totalEl = document.getElementById('settings-storage-total');
  if (!statusEl && !fillEl) return;

  function renderBar(pct) {
    if (fillEl) {
      const clamped = Math.max(0, Math.min(100, pct || 0));
      fillEl.style.width = clamped.toFixed(1) + '%';
    }
  }

  function fmtBytes(b) {
    if (typeof b !== 'number' || isNaN(b) || b <= 0) return '0 MB';
    const mb = b / (1024 * 1024);
    if (mb < 1024) return mb.toFixed(1) + ' MB';
    return (mb / 1024).toFixed(2) + ' GB';
  }

  if (!window.FishDatabase || typeof window.FishDatabase.checkStoragePersistence !== 'function') {
    if (statusEl) statusEl.textContent = 'Storage ready';
    if (usedEl) usedEl.textContent = '0 MB';
    if (totalEl) totalEl.textContent = '/ --';
    renderBar(0);
    if (btnEl) btnEl.style.display = 'none';
    return;
  }

  let info = null;
  try {
    info = await window.FishDatabase.checkStoragePersistence();
  } catch (_) {
    info = null;
  }
  if (!info) {
    if (statusEl) statusEl.textContent = 'Storage ready';
    if (usedEl) usedEl.textContent = '0 MB';
    if (totalEl) totalEl.textContent = '/ --';
    renderBar(0);
    if (btnEl) btnEl.style.display = 'none';
    return;
  }

  if (info.usage && info.quota) {
    const pct = (info.usage / info.quota) * 100;
    if (usedEl) usedEl.textContent = fmtBytes(info.usage);
    if (totalEl) totalEl.textContent = '/ ' + fmtBytes(info.quota) + ' quota';
    if (statusEl) statusEl.textContent = pct.toFixed(1) + '% quota used • ' + (info.persisted ? 'Protected persistent database' : 'Sandbox storage expands on demand');
    renderBar(pct);
  } else if (info.usage) {
    if (usedEl) usedEl.textContent = fmtBytes(info.usage);
    if (totalEl) totalEl.textContent = '/ --';
    if (statusEl) statusEl.textContent = fmtBytes(info.usage) + ' used • Storage active';
    renderBar(0);
  } else {
    if (usedEl) usedEl.textContent = '0 MB';
    if (totalEl) totalEl.textContent = '/ --';
    if (statusEl) statusEl.textContent = 'Storage ready';
    renderBar(0);
  }

  // Only offer Protect when browser reports best-effort (not persisted, not native/PWA).
  let showProtect = false;
  try {
    const isNative = isRunningInsideNativeApp();
    const isPWA = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                  (typeof navigator !== 'undefined' && navigator.standalone === true);
    showProtect = !isNative && !isPWA && !info.persisted;
  } catch (_) {
    showProtect = false;
  }
  if (btnEl) btnEl.style.display = showProtect ? 'inline-flex' : 'none';
}

window.requestStudioStoragePersist = async function () {
  const btnEl = document.getElementById('settings-storage-btn') || document.getElementById('welcome-storage-btn');
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Protecting...';
  }

  let granted = false;
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      granted = await navigator.storage.persist();
    }
  } catch (_) {}

  if (window.FishDatabase && typeof window.FishDatabase.requestPersistentStorage === 'function') {
    await window.FishDatabase.requestPersistentStorage();
  }
  await updateStorageDurabilityUI();

  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = 'Protect';
  }

  const isPersisted = granted || (navigator.storage && typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted());
  if (isPersisted) {
    showDashboardToast('Penyimpanan persisten aktif! Project Anda terlindungi dari pembersihan browser.');
  } else {
    // Mobile browsers (Chrome/Safari) require adding to home screen (PWA) to unlock persistent storage
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    if (isMobile) {
      if (typeof window.triggerPWAInstall === 'function') {
        window.triggerPWAInstall();
      } else {
        showDashboardToast('Di browser mobile, instal aplikasi ke Layar Utama (Add to Home screen) untuk mengaktifkan penyimpanan permanen.', 5000);
      }
    } else {
      showDashboardToast('Penyimpanan best-effort aktif. Bookmark atau instal aplikasi untuk izin persisten.', 4000);
    }
  }
};

async function resetStudioToFactoryAction() {
  const confirmed = window.confirm(
    "Reset ke Kondisi Awal (Factory Reset)?\n\nSemua project lokal, file media, cache preview, dan pengaturan akan dihapus secara permanen. Aplikasi akan kembali bersih seperti baru pertama kali diunduh/dibuka.\n\nApakah Anda yakin ingin melanjutkan?"
  );
  if (!confirmed) return;

  const resetBtn = document.getElementById('btn-settings-factory-reset');
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerHTML = `<span>Resetting...</span>`;
  }

  try {
    if (window.FishDatabase && typeof window.FishDatabase.factoryReset === 'function') {
      await window.FishDatabase.factoryReset();
    } else {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      if (typeof indexedDB !== 'undefined') {
        try { indexedDB.deleteDatabase('FishStudioDB'); } catch (_) {}
        try { indexedDB.deleteDatabase('FishFrameCacheDB'); } catch (_) {}
      }
    }
  } catch (err) {
    console.error('[FishStudio] Factory reset error:', err);
  }

  // Reload back to clean origin without query parameters or hash
  const cleanUrl = window.location.href.split('?')[0].split('#')[0];
  window.location.replace(cleanUrl);
}



/**
 * Checks if current page was opened with an incoming shared project/preset link
 */
function hasIncomingProjectPresetLink() {
  if (_isOpeningPreset || activeSharedProject) return true;
  try {
    const url = new URL(window.location.href);
    const importId = url.searchParams.get('import') || url.searchParams.get('p') || url.searchParams.get('project') || url.searchParams.get('deeplink');
    if (importId) return true;
    if (window.location.hash && window.location.hash.length > 1) return true;
    if (window.__OFT_DEEPLINK__) return true;
    if (sessionStorage.getItem('oft_pending_import_id')) return true;
    if (window.location.protocol !== 'file:') {
      const segments = window.location.pathname.split('/').filter(Boolean);
      if (segments.length === 1 && !['index.html', 'editor.html', 'desktop.html', 'demo.html', 'privacy.html', 'terms.html'].includes(segments[0])) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

/**
 * Automatically displays Welcome modal on first visit unless dismissed
 */
function initWelcomeModal() {
  syncWelcomeVersionTags();
  updateStorageDurabilityUI().catch(() => {});
  // Do NOT show welcome modal if user accessed studio from a shared project/preset link
  if (hasIncomingProjectPresetLink()) {
    return;
  }
  try {
    const hasDismissed = localStorage.getItem('oft_seen_welcome_v1');
    if (!hasDismissed) {
      setTimeout(() => {
        // Double check in case preset confirmation opened in the meantime
        if (hasIncomingProjectPresetLink()) return;
        if (window.Modal && (!window.Modal.activeModal || window.Modal.activeModal.id === 'modal-welcome')) {
          window.Modal.open('modal-welcome');
        }
      }, 450);
    }
  } catch (e) {
    console.warn('Welcome modal init error:', e);
  }
}

/**
 * Closes welcome modal and saves dismissal preference if checked
 */
function closeWelcomeModal() {
  const checkbox = document.getElementById('welcome-dismiss-checkbox');
  if (checkbox && checkbox.checked) {
    try {
      localStorage.setItem('oft_seen_welcome_v1', '1');
    } catch (e) {
      console.warn('[Storage] Failed to save welcome dismissal:', e);
    }
  }
  if (window.Modal) {
    window.Modal.close();
  }
}

/**
 * Opens donate modal from inside welcome modal
 */
function openDonateFromWelcome() {
  const checkbox = document.getElementById('welcome-dismiss-checkbox');
  if (checkbox && checkbox.checked) {
    try {
      localStorage.setItem('oft_seen_welcome_v1', '1');
    } catch (e) {
      console.warn('[Storage] Failed to save welcome dismissal:', e);
    }
  }
  if (window.Modal) {
    window.Modal.open('modal-donate');
  }
}

/**
 * Toggles accordion preview for QRIS donation
 */
function toggleQrisDisplay() {
  const content = document.getElementById('donate-qris-content');
  const arrow = document.getElementById('qris-arrow-icon');
  if (!content) return;

  const isHidden = content.style.display === 'none' || !content.style.display;
  if (isHidden) {
    content.style.display = 'flex';
    if (arrow) arrow.classList.add('is-open');
  } else {
    content.style.display = 'none';
    if (arrow) arrow.classList.remove('is-open');
  }
}

// ==========================================================================
// DASHBOARD QR CODE SHARE MODAL CONTROLLER
// ==========================================================================
let _dashboardQRShareUrl = '';
let _dashboardCachedQRCardDataUrl = '';

// Dynamically load QRCode.js if not already available
if (typeof window !== 'undefined' && !window.QRCode) {
  const s = document.createElement('script');
  s.src = 'vendor/qrcode.min.js';
  document.head.appendChild(s);
}

function drawImageCover(ctx, img, targetX, targetY, targetW, targetH) {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) return;
  const scale = Math.max(targetW / imgW, targetH / imgH);
  const sW = targetW / scale;
  const sH = targetH / scale;
  const sX = (imgW - sW) / 2;
  const sY = (imgH - sH) / 2;
  ctx.drawImage(img, sX, sY, sW, sH, targetX, targetY, targetW, targetH);
}

async function generateDashboardQRCardCanvas(shareUrl, record) {
  const W = 900, H = 1200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // 1. Base dark background
  ctx.fillStyle = '#0d1109';
  ctx.fillRect(0, 0, W, H);

  // 2. Background thumbnail (COVER aspect ratio, NEVER stretched)
  let thumbSrc = (record && record.thumbnail) || null;
  if (thumbSrc && typeof thumbSrc === 'string') {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = thumbSrc;
      });
      ctx.save();
      ctx.globalAlpha = 0.40;
      drawImageCover(ctx, img, 0, 0, W, H);
      ctx.restore();
    } catch (_) {}
  }

  // Dark overlay on thumbnail to guarantee high contrast
  ctx.fillStyle = 'rgba(13, 17, 9, 0.75)';
  ctx.fillRect(0, 0, W, H);

  // Card border inside canvas
  ctx.strokeStyle = '#222d1b';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  // 3. Header: Project Name (Centered, Cal Sans, truncated with ellipsis if long)
  ctx.fillStyle = '#98ce7b';
  ctx.font = 'bold 46px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let pName = (record && record.name) || 'Untitled Project';
  pName = String(pName).trim();
  if (ctx.measureText(pName).width > 740) {
    while (pName.length > 3 && ctx.measureText(pName + '…').width > 740) {
      pName = pName.slice(0, -1);
    }
    pName += '…';
  }
  ctx.fillText(pName, W / 2, 95);

  // Project Specs Subtitle
  const specsText = [record && record.specs, record && record.size].filter(Boolean).join(' • ') || '1080p • 60 fps';
  ctx.fillStyle = '#8fad84';
  ctx.font = '600 24px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(specsText, W / 2, 145);

  // 4. QR Code Box (White container card with rounded corners, prominent & scannable)
  const qrBoxSize = 640;
  const qrBoxX = (W - qrBoxSize) / 2;
  const qrBoxY = 195;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 32);
  } else {
    ctx.rect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
  }
  ctx.fill();

  // Draw QR code from scratch element
  const qrWrap = document.getElementById('qr-share-qr-wrap');
  const qrCanvas = qrWrap ? qrWrap.querySelector('canvas') : null;
  const qrImg = qrWrap ? qrWrap.querySelector('img') : null;
  const pad = 36;
  const qrInnerSize = qrBoxSize - pad * 2;

  if (qrCanvas) {
    ctx.drawImage(qrCanvas, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
  } else if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
    ctx.drawImage(qrImg, qrBoxX + pad, qrBoxY + pad, qrInnerSize, qrInnerSize);
  } else {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(shareUrl, W / 2, qrBoxY + qrBoxSize / 2);
  }

  // 5. Action Instruction Prompt
  ctx.fillStyle = '#c0dbc0';
  ctx.font = '600 23px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Scan with camera to import project', W / 2, 905);

  // 6. Branding Footer: Premium Capsule Pill Badge (App Icon + "FishTools Studio")
  let iconLoaded = false;
  const appIcon = new Image();
  try {
    await new Promise((res, rej) => {
      appIcon.onload = res;
      appIcon.onerror = rej;
      appIcon.src = 'assets/icon-192.png';
    });
    iconLoaded = true;
  } catch (_) {
    try {
      await new Promise((res, rej) => {
        appIcon.onload = res;
        appIcon.onerror = rej;
        appIcon.src = 'assets/icon.svg';
      });
      iconLoaded = true;
    } catch (_) {}
  }

  const brandPillY = 1015;
  const brandPillH = 72;
  const iconSize = 44;
  const gap = 16;
  const brandText = 'FishTools Studio';

  ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  const textW = ctx.measureText(brandText).width;
  const innerW = (iconLoaded ? iconSize + gap : 0) + textW;
  const pillPaddingX = 32;
  const pillW = innerW + pillPaddingX * 2;
  const pillX = (W - pillW) / 2;
  const pillY = brandPillY - brandPillH / 2;

  ctx.fillStyle = '#151c12';
  ctx.strokeStyle = '#2d3e26';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, brandPillH, brandPillH / 2);
  } else {
    ctx.rect(pillX, pillY, pillW, brandPillH);
  }
  ctx.fill();
  ctx.stroke();

  const contentStartX = pillX + pillPaddingX;
  if (iconLoaded) {
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize, 10);
    } else {
      ctx.rect(contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
    }
    ctx.clip();
    ctx.drawImage(appIcon, contentStartX, brandPillY - iconSize / 2, iconSize, iconSize);
    ctx.restore();
  }

  const textStartX = iconLoaded ? contentStartX + iconSize + gap : contentStartX;
  ctx.fillStyle = '#98ce7b';
  ctx.font = 'bold 30px "Cal Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(brandText, textStartX, brandPillY);

  return c;
}

async function openDashboardQRModal(record) {
  const backdrop = document.getElementById('qr-share-backdrop');
  if (!backdrop || !record) return;

  _dashboardQRShareUrl = record.shareUrl || `${window.location.origin}/${record.id}`;

  const qrWrap = document.getElementById('qr-share-qr-wrap');
  if (qrWrap) {
    if (!window.QRCode) {
      await new Promise(r => setTimeout(r, 400));
    }
    qrWrap.innerHTML = '';
    if (window.QRCode) {
      try {
        new window.QRCode(qrWrap, {
          text: _dashboardQRShareUrl,
          width: 500,
          height: 500,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.H
        });
      } catch (_) {}
    }
    await new Promise(r => setTimeout(r, 80));
  }

  const cardContainer = backdrop.querySelector('.qr-share-card');
  const renderedImg = document.getElementById('qr-share-rendered-img');
  if (cardContainer) cardContainer.classList.add('skeleton-loading');
  if (renderedImg) renderedImg.classList.add('is-hidden');

  backdrop.classList.add('is-active');

  try {
    const cardCanvas = await generateDashboardQRCardCanvas(_dashboardQRShareUrl, record);
    _dashboardCachedQRCardDataUrl = cardCanvas.toDataURL('image/png');
    if (renderedImg) {
      renderedImg.src = _dashboardCachedQRCardDataUrl;
      renderedImg.onload = () => {
        if (cardContainer) cardContainer.classList.remove('skeleton-loading');
        renderedImg.classList.remove('is-hidden');
      };
      if (renderedImg.complete) {
        if (cardContainer) cardContainer.classList.remove('skeleton-loading');
        renderedImg.classList.remove('is-hidden');
      }
    }
  } catch (err) {
    console.error('[FishDashboard:QRCard]', err);
    if (cardContainer) cardContainer.classList.remove('skeleton-loading');
    if (renderedImg) renderedImg.classList.remove('is-hidden');
  }
}

// Bind QR backdrop controls on dashboard
document.addEventListener('DOMContentLoaded', () => {
  const qrCloseBtn = document.getElementById('qr-btn-close');
  if (qrCloseBtn) {
    qrCloseBtn.addEventListener('click', () => {
      const backdrop = document.getElementById('qr-share-backdrop');
      if (backdrop) backdrop.classList.remove('is-active');
    });
  }

  const qrBackdropEl = document.getElementById('qr-share-backdrop');
  if (qrBackdropEl) {
    qrBackdropEl.addEventListener('click', (e) => {
      if (e.target === qrBackdropEl) {
        qrBackdropEl.classList.remove('is-active');
      }
    });
  }

  const qrCopyBtn = document.getElementById('qr-btn-copy');
  if (qrCopyBtn) {
    qrCopyBtn.addEventListener('click', async () => {
      if (_dashboardQRShareUrl) {
        const cleanUrl = _dashboardQRShareUrl.replace(/^https?:\/\//i, '');
        try {
          await navigator.clipboard.writeText(cleanUrl);
          showDashboardToast('Link copied to clipboard!');
        } catch (_) {}
      }
    });
  }

  const qrDownloadBtn = document.getElementById('qr-btn-download');
  if (qrDownloadBtn) {
    qrDownloadBtn.addEventListener('click', () => {
      if (!_dashboardCachedQRCardDataUrl) return;
      const a = document.createElement('a');
      a.href = _dashboardCachedQRCardDataUrl;
      a.download = `Project_QR.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); }, 1000);
    });
  }
});

// Global exposes for HTML onclick handlers & module interop
window.openDeleteModal = openDeleteModal;
window.confirmDeleteProjectAction = confirmDeleteProjectAction;
window.exportProjectAction = exportProjectAction;
window.showDashboardToast = showDashboardToast;
window.openRenameModal = openRenameModal;
window.saveRenameProjectAction = saveRenameProjectAction;
window.openProjectSettingsModal = openProjectSettingsModal;
window.saveProjectSettingsAction = saveProjectSettingsAction;
window.syncWelcomeVersionTags = syncWelcomeVersionTags;
window.createNewProjectAction = createNewProjectAction;
window.closeWelcomeModal = closeWelcomeModal;
window.openDonateFromWelcome = openDonateFromWelcome;
window.toggleQrisDisplay = toggleQrisDisplay;
window.openAppSettingsModal = openAppSettingsModal;
window.resetStudioToFactoryAction = resetStudioToFactoryAction;
window.updateStorageDurabilityUI = updateStorageDurabilityUI;
window.setStudioTheme = setStudioTheme;
window.getStudioTheme = getStudioTheme;
window.initSettingsModal = initSettingsModal;
window.initTheme = initTheme;
window.getUiScale = getUiScale;
window.setUiScale = setUiScale;
window.applyUiScale = applyUiScale;
window.initUiScaleForCurrentPage = initUiScaleForCurrentPage;
window.initUiScaleSliders = initUiScaleSliders;

// ==========================================================================
// APP THEME & ACCENT COLOR MANAGER (bright accents only, no dark tones)
// ==========================================================================
const STUDIO_THEMES = [
  { id: 'default', name: 'Matcha Tea', desc: 'Default Brand', color: '#aef380', checkFill: '#12170e' },
  { id: 'sakura-milk', name: 'Sakura Milk', desc: 'Pastel Pink', color: '#ffb3d1', checkFill: '#2a121a' },
  { id: 'lemon-soda', name: 'Lemon Soda', desc: 'Bright Citrus', color: '#ffe45e', checkFill: '#241d05' },
  { id: 'sky-candy', name: 'Sky Candy', desc: 'Soft Cyan', color: '#8ee6ff', checkFill: '#0a1a22' },
  { id: 'mint-pop', name: 'Mint Pop', desc: 'Fresh Mint', color: '#7dfcc8', checkFill: '#0a2018' },
  { id: 'peach-glow', name: 'Peach Glow', desc: 'Warm Peach', color: '#ffc49b', checkFill: '#2a1a0e' }
];

function isValidStudioTheme(id) {
  return STUDIO_THEMES.some(t => t.id === id);
}

function getStudioTheme() {
  try {
    const v = localStorage.getItem('oft_theme') || 'default';
    if (!isValidStudioTheme(v)) {
      try { localStorage.setItem('oft_theme', 'default'); } catch (_) {}
      return 'default';
    }
    return v;
  } catch (_) {
    return 'default';
  }
}

function setStudioTheme(themeId) {
  if (!isValidStudioTheme(themeId)) themeId = 'default';
  try {
    localStorage.setItem('oft_theme', themeId);
  } catch (_) {}
  try {
    if (window.FishDatabase && typeof window.FishDatabase.saveSettings === 'function') {
      window.FishDatabase.getSettings().then(s => {
        s = s || {};
        s.config = s.config || {};
        s.config.accent = themeId;
        return window.FishDatabase.saveSettings(s);
      }).catch(() => {});
    }
  } catch (_) {}

  if (themeId && themeId !== 'default') {
    document.documentElement.setAttribute('data-theme', themeId);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  // Sync UI state in modal-settings
  const labelEl = document.getElementById('settings-current-theme-label');
  const found = STUDIO_THEMES.find(t => t.id === themeId) || STUDIO_THEMES[0];
  if (labelEl) {
    labelEl.textContent = found.name;
  }

  const grid = document.getElementById('settings-theme-grid');
  if (grid) {
    grid.querySelectorAll('.theme-card-item').forEach(card => {
      const cid = card.getAttribute('data-theme-val');
      if (cid === themeId) {
        card.classList.add('is-selected');
        card.setAttribute('aria-selected', 'true');
      } else {
        card.classList.remove('is-selected');
        card.setAttribute('aria-selected', 'false');
      }
    });
  }

  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: themeId } }));
}

function initTheme() {
  const current = getStudioTheme();
  if (current && current !== 'default') {
    document.documentElement.setAttribute('data-theme', current);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// ==========================================================================
// UI SCALE MANAGER (Index / Editor / Desktop, default 100%)
// Uses CSS `zoom` on <html> so layout scales without breaking canvas math.
// Persisted to localStorage (sync) + FishDatabase settings (durable for standalone).
// ==========================================================================
const UI_SCALE_PAGES = ['index', 'editor', 'desktop'];
const UI_SCALE_MIN = 80;
const UI_SCALE_MAX = 130;

function clampUiScale(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 100;
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, n));
}

function getUiScale(page) {
  try {
    const raw = localStorage.getItem('oft_ui_scale_' + page);
    if (raw !== null && raw !== undefined && raw !== '') return clampUiScale(raw);
  } catch (_) {}
  try {
    const generic = localStorage.getItem('oft_ui_scale');
    if (generic !== null && generic !== undefined && generic !== '') return clampUiScale(generic);
  } catch (_) {}
  return 100;
}

function updateSliderTrackFill(slider) {
  if (!slider) return;
  const min = parseFloat(slider.min) || 80;
  const max = parseFloat(slider.max) || 130;
  const val = parseFloat(slider.value) || 100;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  slider.style.setProperty('--slider-fill', pct.toFixed(1) + '%');
}

function applyUiScale(page, val) {
  const scale = clampUiScale(val);
  try {
    document.documentElement.style.setProperty('--oft-ui-scale', String(scale / 100));
    // Zoom on <html> scales UI chrome; canvas internal resolution stays independent.
    // Clear at 100% so no residual transform affects fixed overlays / splitters.
    if (scale === 100) {
      document.documentElement.style.zoom = '';
      document.documentElement.style.removeProperty('zoom');
    } else {
      document.documentElement.style.zoom = String(scale / 100);
      document.documentElement.style.setProperty('zoom', String(scale / 100));
    }
    window.__OFT_ZOOM = scale / 100;
    document.documentElement.classList.toggle('is-scaled', scale !== 100);

    // Clean up any residual counter-zoom on settings card
    const settingsCard = document.querySelector('#modal-settings .modal-card');
    if (settingsCard) {
      settingsCard.style.zoom = '';
      settingsCard.style.removeProperty('zoom');
    }

    window.dispatchEvent(new Event('oft-ui-scale-changed'));
  } catch (_) {}
  return scale;
}

function setUiScale(page, val) {
  const scale = clampUiScale(val);
  try {
    localStorage.setItem('oft_ui_scale_' + page, String(scale));
  } catch (_) {}
  try {
    if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
      window.FishDatabase.getSettings().then(s => {
        s = s || {};
        s.config = s.config || {};
        s.config['uiScale_' + page] = scale;
        return window.FishDatabase.saveSettings(s);
      }).catch(() => {});
    }
  } catch (_) {}
  // Apply live only if this slider belongs to the current page.
  try {
    const cur = detectCurrentUiScalePage();
    if (!page || page === cur) applyUiScale(cur, page === cur ? scale : getUiScale(cur));
  } catch (_) {}
  syncUiScaleSliderLabels();
  return scale;
}

function detectCurrentUiScalePage() {
  try {
    const p = (window.location && window.location.pathname) || '';
    if (p.indexOf('editor') !== -1) return 'editor';
    if (p.indexOf('desktop') !== -1) return 'desktop';
  } catch (_) {}
  return 'index';
}

function initUiScaleForCurrentPage() {
  const page = detectCurrentUiScalePage();
  const stored = getUiScale(page);
  applyUiScale(page, stored);
  // Hydrate from FishDatabase when localStorage was empty (standalone first run).
  try {
    if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
      const hadLocal = (() => {
        try { return localStorage.getItem('oft_ui_scale_' + page) !== null; } catch (_) { return true; }
      })();
      if (!hadLocal) {
        window.FishDatabase.getSettings().then(s => {
          const v = s && s.config && s.config['uiScale_' + page];
          if (v) {
            try { localStorage.setItem('oft_ui_scale_' + page, String(clampUiScale(v))); } catch (_) {}
            applyUiScale(page, v);
            syncUiScaleSliderLabels();
          }
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

function syncUiScaleSliderLabels() {
  UI_SCALE_PAGES.forEach(page => {
    const slider = document.getElementById('ui-scale-' + page);
    const label = document.getElementById('ui-scale-' + page + '-val');
    if (!slider) return;
    const v = getUiScale(page);
    try {
      if (String(slider.value) !== String(v)) slider.value = String(v);
    } catch (_) {}
    if (label) label.textContent = v + '%';
    updateSliderTrackFill(slider);
  });
}

function initUiScaleSliders() {
  syncUiScaleSliderLabels();
  UI_SCALE_PAGES.forEach(page => {
    const slider = document.getElementById('ui-scale-' + page);
    if (!slider) return;
    updateSliderTrackFill(slider);
    if (slider._oftScaleWired) return;
    slider._oftScaleWired = true;

    slider.addEventListener('input', () => {
      const v = clampUiScale(slider.value);
      const label = document.getElementById('ui-scale-' + page + '-val');
      if (label) label.textContent = v + '%';
      updateSliderTrackFill(slider);
    });

    slider.addEventListener('change', () => {
      setUiScale(page, slider.value);
      updateSliderTrackFill(slider);
    });
  });
}

function getAlwaysMobileSetting() {
  try {
    const raw = localStorage.getItem('oft_always_mobile');
    if (raw !== null && raw !== undefined && raw !== '') {
      return raw === 'true';
    }
    const tsv = localStorage.getItem('oft_tablet_split_view');
    if (tsv !== null && tsv !== undefined && tsv !== '') {
      return tsv === 'false';
    }
  } catch (_) {}
  return false;
}
window.getAlwaysMobileSetting = getAlwaysMobileSetting;

function setAlwaysMobileSetting(enabled) {
  const isAlwaysMobile = Boolean(enabled);
  try {
    localStorage.setItem('oft_always_mobile', isAlwaysMobile ? 'true' : 'false');
    localStorage.setItem('oft_tablet_split_view', isAlwaysMobile ? 'false' : 'true');
    if (isAlwaysMobile) {
      localStorage.setItem('oft_preferred_view', 'mobile');
    } else if (localStorage.getItem('oft_preferred_view') === 'mobile') {
      localStorage.removeItem('oft_preferred_view');
    }
  } catch (_) {}
  try {
    if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
      window.FishDatabase.getSettings().then(s => {
        s = s || {};
        s.config = s.config || {};
        s.config.alwaysMobile = isAlwaysMobile;
        s.config.tabletSplitView = !isAlwaysMobile;
        return window.FishDatabase.saveSettings(s);
      }).catch(() => {});
    }
  } catch (_) {}

  const sw = document.getElementById('settings-always-mobile-switch');
  if (sw && sw.checked !== isAlwaysMobile) {
    sw.checked = isAlwaysMobile;
  }
  return isAlwaysMobile;
}
window.setAlwaysMobileSetting = setAlwaysMobileSetting;

function initAlwaysMobileSwitch() {
  const sw = document.getElementById('settings-always-mobile-switch');
  if (sw) {
    sw.checked = getAlwaysMobileSetting();
    if (!sw._oftAlwaysMobileWired) {
      sw._oftAlwaysMobileWired = true;
      sw.addEventListener('change', () => {
        setAlwaysMobileSetting(sw.checked);
      });
    }
  }

  // Hydrate from FishDatabase if localStorage was empty
  try {
    if (window.FishDatabase && typeof window.FishDatabase.getSettings === 'function') {
      const hadLocal = (() => {
        try {
          return localStorage.getItem('oft_always_mobile') !== null ||
            localStorage.getItem('oft_tablet_split_view') !== null;
        } catch (_) {
          return true;
        }
      })();
      if (!hadLocal) {
        window.FishDatabase.getSettings().then(s => {
          if (s && s.config) {
            if (typeof s.config.alwaysMobile === 'boolean') {
              setAlwaysMobileSetting(s.config.alwaysMobile);
            } else if (typeof s.config.tabletSplitView === 'boolean') {
              setAlwaysMobileSetting(!s.config.tabletSplitView);
            }
          }
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

function initSettingsModal() {
  const grid = document.getElementById('settings-theme-grid');
  if (grid) {
    const currentTheme = getStudioTheme();
    const found = STUDIO_THEMES.find(t => t.id === currentTheme) || STUDIO_THEMES[0];

    const labelEl = document.getElementById('settings-current-theme-label');
    if (labelEl) {
      labelEl.textContent = found.name;
    }

    grid.innerHTML = STUDIO_THEMES.map(t => {
      const isSelected = t.id === currentTheme;
      return `
      <button type="button" class="theme-card-item ${isSelected ? 'is-selected' : ''}" data-theme-val="${t.id}" title="${escapeHtml(t.name)}" aria-selected="${isSelected ? 'true' : 'false'}">
        <div class="theme-card-color-dot" style="background-color: ${t.color};">
          <svg class="theme-card-check" viewBox="0 0 24 24" width="14" height="14" fill="${t.checkFill}">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
        <div class="theme-card-meta">
          <span class="theme-card-name">${escapeHtml(t.name)}</span>
          <span class="theme-card-desc">${escapeHtml(t.desc)}</span>
        </div>
      </button>
    `;
    }).join('');

    grid.querySelectorAll('.theme-card-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-theme-val');
        if (val) setStudioTheme(val);
      });
    });
  }

  initUiScaleSliders();
  initAlwaysMobileSwitch();
}

function openAppSettingsModal() {
  initSettingsModal();
  updateStorageDurabilityUI().catch(() => {});
  if (window.Modal && typeof window.Modal.open === 'function') {
    window.Modal.open('modal-settings');
  }
}


// UI Helper for Custom Resolution / Aspect Ratio Toggle
window.toggleResolutionUI = function(containerId, aspectVal) {
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.getElementById('container-resolution') || document.getElementById('settings-container-resolution');
    }
    if (!container) return;
    const dropdown = container.querySelector('.custom-dropdown');
    const inputs = container.querySelector('#custom-resolution-inputs, #settings-custom-resolution-inputs, .custom-res-liquid-wrap, .custom-res-composite, .custom-resolution-inputs');
    if (aspectVal === 'Custom') {
        if (dropdown) dropdown.style.display = 'none';
        if (inputs) inputs.style.display = 'flex';
    } else {
        if (dropdown) dropdown.style.display = 'block';
        if (inputs) inputs.style.display = 'none';
    }
};

document.addEventListener('click', e => {
    const frame = e.target.closest('.aspect-ratio-frame');
    if (frame) {
        const grid = frame.closest('.modal-aspect-grid');
        if (grid) {
            const isSettings = grid.id === 'settings-options-aspect-ratio';
            const containerId = isSettings ? 'settings-container-resolution' : 'container-resolution';
            window.toggleResolutionUI(containerId, frame.dataset.val);
        }
    }
}, true);

// Res Lock Link Logic
const resLocks = { new: 16/9, settings: 16/9 };
function setupResLink(btnId, wId, hId, type) {
    const btn = document.getElementById(btnId);
    const w = document.getElementById(wId);
    const h = document.getElementById(hId);
    if (!btn || !w || !h) return;

    function updateRatio() {
        const wv = parseFloat(w.value) || 1920;
        const hv = parseFloat(h.value) || 1080;
        if (hv > 0) resLocks[type] = wv / hv;
    }
    updateRatio();

    function syncLock() {
        const wrap = btn.closest('.custom-res-liquid-wrap');
        if (wrap) wrap.classList.toggle('is-locked', btn.classList.contains('is-locked'));
    }
    syncLock();

    btn.addEventListener('click', () => {
        btn.classList.toggle('is-locked');
        syncLock();
        if (btn.classList.contains('is-locked')) {
            updateRatio();
        }
    });

    w.addEventListener('input', () => {
        if (btn.classList.contains('is-locked')) {
            const wv = parseFloat(w.value);
            if (!isNaN(wv) && wv > 0 && resLocks[type] > 0) {
                h.value = Math.max(1, Math.round(wv / resLocks[type]));
            }
        }
    });

    h.addEventListener('input', () => {
        if (btn.classList.contains('is-locked')) {
            const hv = parseFloat(h.value);
            if (!isNaN(hv) && hv > 0 && resLocks[type] > 0) {
                w.value = Math.max(1, Math.round(hv * resLocks[type]));
            }
        }
    });
}

function initAllResLinks() {
    setupResLink('btn-link-res', 'custom-res-w', 'custom-res-h', 'new');
    setupResLink('settings-btn-link-res', 'settings-custom-res-w', 'settings-custom-res-h', 'settings');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllResLinks);
} else {
    initAllResLinks();
}
