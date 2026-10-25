const $ = (id) => document.getElementById(id);
const typeLabels = { article: '文章', photography: '照片', interview: '面试八股' };
const fields = ['title', 'description', 'date', 'tags', 'draft', 'directory', 'body'];
const state = {
  type: 'article',
  entries: [],
  current: null,
  photos: [],
  coverId: '',
  history: [],
  dirty: false,
  busy: false,
  mode: 'edit',
  restore: null,
  draftTimer: null,
  previewTimer: null,
  previewVersion: 0,
  previewController: null,
  dragId: '',
  replaceId: ''
};
const objectUrls = new Set();
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[char]
  );
// randomUUID is unavailable on ordinary HTTP LAN origins.
const uid = () =>
  crypto.randomUUID?.() ||
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
const parseTags = (value) => [
  ...new Set(
    value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  )
];
const slugify = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
function generatedSlug() {
  const filename =
    state.current?.slug?.split('/').pop() ||
    `${$('date').value || today()}-${slugify($('title').value) || 'untitled'}`;
  if (state.type === 'interview')
    return [$('directory').value.trim().replace(/\\/g, '/'), filename].filter(Boolean).join('/');
  return state.current?.slug || filename;
}
function assetUrl(src) {
  if (!src) return '';
  if (src.startsWith('../../assets/photos/'))
    return `/src/assets/photos/${encodeURIComponent(src.slice('../../assets/photos/'.length))}`;
  return src;
}
function photoUrl(photo, width) {
  const url = photo.url || assetUrl(photo.src);
  return width && url.startsWith('/src/assets/photos/') ? `${url}?width=${width}` : url;
}
function objectUrl(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return url;
}
function cleanUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}
function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').hidden = !message;
  $('status').classList.toggle('error', error);
}
function setBusy(busy, message = '') {
  state.busy = busy;
  $('workspace').inert = busy;
  document.querySelector('.library-actions').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('.library button, .header-actions button').forEach((button) => {
    button.disabled = busy;
  });
  $('save-entry').innerHTML = busy
    ? escapeHtml(message || '处理中…')
    : '保存 Markdown <kbd>⌘ / Ctrl S</kbd>';
}
async function api(url, payload, signal) {
  const response = await fetch(
    url,
    payload === undefined
      ? { signal }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal
        }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

// IndexedDB stores File objects as well as text, so pending photos survive a refresh.
let database;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('wenri-content-workbench', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
async function draftStore(action, key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('drafts');
    const request =
      action === 'put'
        ? store.put(value, key)
        : action === 'delete'
          ? store.delete(key)
          : store.get(key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('本机暂存失败'));
  });
}
function draftKey() {
  return `${state.type}:${state.current?.slug || '__new__'}`;
}
function snapshot() {
  return {
    fields: Object.fromEntries(fields.map((id) => [id, $(id).value])),
    photos: state.photos.map(({ id, src, caption, file, name }) => ({
      id,
      src,
      caption,
      file,
      name
    })),
    coverId: state.coverId,
    revision: state.current?.revision,
    updatedAt: Date.now()
  };
}
async function stash() {
  clearTimeout(state.draftTimer);
  if (!state.dirty) return true;
  try {
    await draftStore('put', draftKey(), snapshot());
    $('save-state').textContent = '未保存 · 已暂存本机';
    return true;
  } catch {
    $('save-state').textContent = '未保存 · 本机暂存失败';
    setStatus('浏览器无法暂存修改，请保存 Markdown 后再离开。', true);
    return false;
  }
}
function rememberSelection() {
  try {
    localStorage.setItem(
      'wenri-admin-selection',
      JSON.stringify({ type: state.type, slug: state.current?.slug || '' })
    );
  } catch {
    /* Storage can be unavailable in private mode. */
  }
}
async function fill(entry, { showRecovery = true } = {}) {
  clearTimeout(state.draftTimer);
  clearTimeout(state.previewTimer);
  state.previewVersion++;
  state.previewController?.abort();
  cleanUrls();
  state.current = entry;
  state.history = [];
  state.dirty = false;
  state.restore = null;
  $('recovery-banner').hidden = true;
  $('title').value = entry?.data.title || '';
  $('description').value = entry?.data.description || '';
  $('date').value = String(entry?.data.date || today()).slice(0, 10);
  $('tags').value = (entry?.data.tags || []).join(', ');
  $('draft').value = String(entry ? Boolean(entry.data.draft) : true);
  $('directory').value =
    state.type === 'interview' ? (entry?.slug || '').split('/').slice(0, -1).join('/') : '';
  $('body').value = entry?.body || '';
  const gallery = Array.isArray(entry?.data.gallery) ? entry.data.gallery : [];
  const cover = entry?.data.cover || '';
  const photos =
    cover && !gallery.some((photo) => photo.src === cover)
      ? [{ src: cover, caption: '' }, ...gallery]
      : gallery;
  state.photos = photos.map((photo) => ({ ...photo, id: uid(), name: photo.src.split('/').pop() }));
  state.coverId =
    state.photos.find((photo) => photo.src === cover)?.id || state.photos[0]?.id || '';
  $('delete-entry').disabled = !entry?.slug;
  $('save-state').textContent = entry ? '所有修改已保存' : '新内容 · 尚未保存';
  $('save-state').classList.remove('dirty');
  renderGallery();
  renderEntries();
  updateDocument();
  rememberSelection();
  if (showRecovery) {
    const key = draftKey();
    try {
      const draft = await draftStore('get', key);
      if (draft && key === draftKey() && !state.dirty) {
        state.restore = draft;
        const time = new Date(draft.updatedAt).toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        const stale = draft.revision && draft.revision !== entry?.revision;
        $('recovery-message').textContent =
          `发现 ${time} 的本机暂存${stale ? '；项目文件已更新，恢复后请检查内容' : '，包含尚未保存的修改'}。`;
        $('recovery-banner').hidden = false;
      }
    } catch {
      /* Editing still works when storage is unavailable. */
    }
  }
}
function markDirty() {
  state.dirty = true;
  $('save-state').textContent = '有未保存的修改';
  $('save-state').classList.add('dirty');
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(stash, 500);
  updateDocument();
}
function updateDocument() {
  const draft = $('draft').value === 'true';
  $('editor-context').textContent =
    `${typeLabels[state.type]} / ${state.current?.slug ? '编辑' : '新建'}`;
  $('editor-heading').textContent =
    state.type === 'photography'
      ? '整理摄影作品'
      : state.type === 'interview'
        ? '整理面试笔记'
        : '编写文章';
  $('entry-state').textContent = draft ? '草稿' : '公开';
  $('entry-state').classList.toggle('is-draft', draft);
  const count = $('body').value.replace(/\s/g, '').length;
  $('word-count').textContent =
    `${count.toLocaleString('zh-CN')} 字 · 约 ${Math.max(1, Math.ceil(count / 400))} 分钟`;
  $('entry-path').textContent =
    `src/content/${{ article: 'articles', photography: 'photos', interview: 'interviews' }[state.type]}/${generatedSlug()}.md`;
  updateCover();
  queuePreview();
}
function updateCover() {
  const cover = state.photos.find((photo) => photo.id === state.coverId);
  $('cover-preview').hidden = !cover;
  if (cover) $('cover-preview').src = photoUrl(cover, 480);
  else $('cover-preview').removeAttribute('src');
  $('cover-hint').textContent = cover
    ? `第 ${state.photos.indexOf(cover) + 1} 张 · ${cover.name || '照片'}`
    : '添加照片后选择封面';
}
function renderEntries() {
  let entries = state.entries.filter((entry) => {
    const query = $('filter').value.trim().toLowerCase();
    const status = $('status-filter').value;
    return (
      (!query ||
        [entry.slug, entry.data.title, entry.data.description, ...(entry.data.tags || [])]
          .join(' ')
          .toLowerCase()
          .includes(query)) &&
      (status === 'all' || Boolean(entry.data.draft) === (status === 'draft'))
    );
  });
  const order = $('list-sort').value;
  entries = [...entries].sort((a, b) =>
    order === 'title'
      ? a.data.title.localeCompare(b.data.title, 'zh-CN')
      : String(a.data.date).localeCompare(String(b.data.date)) * (order === 'oldest' ? 1 : -1)
  );
  $('entries').innerHTML =
    entries
      .map((entry) => {
        const active = state.current?.slug === entry.slug;
        const src = entry.data.cover || entry.data.gallery?.[0]?.src;
        return `<button type="button" class="entry${active ? ' active' : ''}" data-slug="${escapeHtml(entry.slug)}" aria-current="${active ? 'true' : 'false'}">
      ${src ? `<img src="${escapeHtml(photoUrl({ src }, 96))}" alt="" loading="lazy">` : ''}
      <span class="entry-copy"><strong>${escapeHtml(entry.data.title || entry.slug)}</strong><span class="entry-meta"><span>${escapeHtml(String(entry.data.date || '').slice(0, 10))}</span><span class="${entry.data.draft ? 'draft-dot' : ''}">${entry.data.draft ? '草稿' : '公开'}</span></span>${state.type === 'interview' ? `<span class="entry-directory">${escapeHtml(entry.slug)}</span>` : ''}</span></button>`;
      })
      .join('') ||
    `<p class="empty-state">${state.entries.length ? '没有匹配内容，试试其他关键词。' : '还没有内容，点击上方新建。'}</p>`;
  $('library-count').textContent = state.entries.length;
  $('summary').textContent =
    `${entries.length} / ${state.entries.length} 条${typeLabels[state.type]}内容`;
}
async function loadEntries(preferredSlug) {
  setBusy(true, '加载中…');
  try {
    document.body.dataset.type = state.type;
    document
      .querySelectorAll('[data-tab]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.tab === state.type))
      );
    $('new-entry').textContent =
      `＋ 新建${state.type === 'photography' ? '作品' : state.type === 'interview' ? '笔记' : '文章'}`;
    state.entries = await api(`/api/entries?type=${state.type}`);
    const selected =
      preferredSlug === ''
        ? null
        : state.entries.find((entry) => entry.slug === preferredSlug) || state.entries[0] || null;
    await fill(selected);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function pushHistory() {
  state.history.push({
    photos: state.photos.map((photo) => ({ ...photo })),
    coverId: state.coverId
  });
  if (state.history.length > 30) state.history.shift();
}
function galleryChanged(focusId, action) {
  renderGallery();
  markDirty();
  if (focusId && action)
    $('gallery-editor').querySelector(`[data-id="${focusId}"] [data-action="${action}"]`)?.focus();
}
function renderGallery() {
  $('photo-count').textContent = state.photos.length;
  $('undo-gallery').disabled = !state.history.length;
  $('photo-dropzone').classList.toggle('has-photos', state.photos.length > 0);
  $('gallery-editor').innerHTML = state.photos
    .map((photo, index) => {
      const cover = photo.id === state.coverId;
      return `<div class="gallery-item${cover ? ' is-cover' : ''}" data-id="${photo.id}">
      <div class="photo-frame"><button type="button" class="photo-zoom" data-action="edit" aria-label="查看和编辑第 ${index + 1} 张照片"><img src="${escapeHtml(photoUrl(photo, 480))}" alt="${escapeHtml(photo.caption || photo.name || '照片')}" loading="lazy"></button>${cover ? '<span class="cover-badge">封面</span>' : ''}${photo.file ? '<span class="pending-badge">待保存</span>' : ''}</div>
      <div class="gallery-fields"><div class="photo-order"><button type="button" class="drag-handle" draggable="true" data-action="drag" aria-label="拖动第 ${index + 1} 张照片排序" title="拖动排序">⠿</button><label class="order-label">序号<input type="number" data-position min="1" max="${state.photos.length}" value="${index + 1}" aria-label="第 ${index + 1} 张照片的序号"></label><button type="button" data-action="up" aria-label="前移第 ${index + 1} 张照片" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" data-action="down" aria-label="后移第 ${index + 1} 张照片" ${index === state.photos.length - 1 ? 'disabled' : ''}>→</button></div>
      <span class="photo-name" title="${escapeHtml(photo.name || photo.src)}">${escapeHtml(photo.name || photo.src)}</span>
      <label>说明<input data-caption value="${escapeHtml(photo.caption || '')}" placeholder="为这张照片写一句说明…"></label>
      <div class="gallery-actions"><button type="button" data-action="cover" ${cover ? 'disabled' : ''}>${cover ? '当前封面' : '设为封面'}</button><button type="button" data-action="edit">编辑</button><button type="button" data-action="replace">替换</button><button type="button" data-action="remove" class="text-danger">移除</button></div></div></div>`;
    })
    .join('');
  updateCover();
}
function movePhoto(id, to) {
  const from = state.photos.findIndex((photo) => photo.id === id);
  if (from < 0 || to < 0 || to >= state.photos.length || from === to) return;
  pushHistory();
  state.photos.splice(to, 0, state.photos.splice(from, 1)[0]);
  galleryChanged(id, 'drag');
  setStatus(`照片已移至第 ${to + 1} 位，点击保存后生效。`);
}
async function validateFiles(files) {
  for (const file of files) {
    if (!/\.(jpe?g|png|webp|avif|svg)$/i.test(file.name))
      throw new Error(`不支持 ${file.name}，请使用 JPG、PNG、WebP、AVIF 或 SVG。`);
    if (!file.size || file.size > 30 * 1024 * 1024)
      throw new Error(`${file.name} 超出限制，每张照片最多 30 MB。`);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      throw new Error(`无法读取 ${file.name}，请检查图片文件。`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
async function addPhotos(files) {
  if (state.busy || !files.length) return;
  setBusy(true, '读取照片…');
  try {
    await validateFiles(files);
    pushHistory();
    state.photos.push(
      ...files.map((file) => ({
        id: uid(),
        file,
        url: objectUrl(file),
        name: file.name,
        caption: '',
        src: ''
      }))
    );
    if (!state.coverId) state.coverId = state.photos[0].id;
    galleryChanged();
    setStatus(`已添加 ${files.length} 张照片。可以继续编辑和排序，保存时一起写入项目。`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    $('photo-files').value = '';
    setBusy(false);
  }
}
$('gallery-editor').addEventListener('input', (event) => {
  if (!event.target.matches('[data-caption]')) return;
  const photo = state.photos.find(
    (item) => item.id === event.target.closest('[data-id]').dataset.id
  );
  // Text edits are included in the local draft; structural edits use the gallery undo stack.
  photo.caption = event.target.value;
  markDirty();
});
$('gallery-editor').addEventListener('change', (event) => {
  if (event.target.matches('[data-position]')) {
    const position = Number(event.target.value);
    if (!Number.isInteger(position) || position < 1 || position > state.photos.length) {
      renderGallery();
      return;
    }
    movePhoto(event.target.closest('[data-id]').dataset.id, position - 1);
  }
});
$('gallery-editor').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || state.busy) return;
  const id = button.closest('[data-id]').dataset.id;
  const index = state.photos.findIndex((photo) => photo.id === id);
  const action = button.dataset.action;
  if (action === 'up' || action === 'down') movePhoto(id, index + (action === 'up' ? -1 : 1));
  if (action === 'cover') {
    pushHistory();
    state.coverId = id;
    galleryChanged();
  }
  if (action === 'remove') {
    pushHistory();
    state.photos.splice(index, 1);
    if (state.coverId === id) state.coverId = state.photos[0]?.id || '';
    galleryChanged();
    setStatus('已移除照片，可点击「撤销」恢复。');
  }
  if (action === 'replace') {
    state.replaceId = id;
    $('replace-photo-file').click();
  }
  if (action === 'edit') openImageEditor(id);
});
$('gallery-editor').addEventListener('dragstart', (event) => {
  const handle = event.target.closest('.drag-handle');
  if (!handle) {
    event.preventDefault();
    return;
  }
  state.dragId = handle.closest('[data-id]').dataset.id;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', state.dragId);
  const card = handle.closest('.gallery-item');
  event.dataTransfer.setDragImage(card, 30, 30);
  card.classList.add('dragging');
});
$('gallery-editor').addEventListener('dragover', (event) => {
  if (!state.dragId) return;
  const card = event.target.closest('.gallery-item');
  if (!card) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop-target').forEach((item) => item.classList.remove('drop-target'));
  card.classList.add('drop-target');
});
$('gallery-editor').addEventListener('drop', (event) => {
  if (!state.dragId) return;
  event.preventDefault();
  const card = event.target.closest('.gallery-item');
  if (card)
    movePhoto(
      state.dragId,
      state.photos.findIndex((photo) => photo.id === card.dataset.id)
    );
  state.dragId = '';
});
$('gallery-editor').addEventListener('dragend', () => {
  state.dragId = '';
  document
    .querySelectorAll('.drop-target, .dragging')
    .forEach((item) => item.classList.remove('drop-target', 'dragging'));
});
$('undo-gallery').addEventListener('click', () => {
  const previous = state.history.pop();
  if (!previous) return;
  // Keep descriptions typed after a reorder, while restoring removed images and replaced sources.
  const captions = new Map(state.photos.map((photo) => [photo.id, photo.caption]));
  state.photos = previous.photos.map((photo) => ({
    ...photo,
    caption: captions.get(photo.id) ?? photo.caption
  }));
  state.coverId = previous.coverId;
  galleryChanged();
  setStatus('已撤销上一次图片操作。');
});
$('choose-photos').addEventListener('click', () => $('photo-files').click());
$('photo-dropzone').addEventListener('click', () => $('photo-files').click());
$('photo-dropzone').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('photo-files').click();
  }
});
$('photo-files').addEventListener('change', (event) => addPhotos([...event.target.files]));
$('photo-dropzone').addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  $('photo-dropzone').classList.add('dragover');
});
$('photo-dropzone').addEventListener('dragleave', () =>
  $('photo-dropzone').classList.remove('dragover')
);
$('photo-dropzone').addEventListener('drop', (event) => {
  event.preventDefault();
  $('photo-dropzone').classList.remove('dragover');
  addPhotos([...event.dataTransfer.files]);
});
$('replace-photo-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const photo = state.photos.find((item) => item.id === state.replaceId);
  if (!file || !photo) return;
  setBusy(true, '读取照片…');
  try {
    await validateFiles([file]);
    pushHistory();
    Object.assign(photo, { file, url: objectUrl(file), name: file.name, src: '' });
    galleryChanged();
    setStatus('照片已替换，说明、封面和顺序已保留。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    event.target.value = '';
    setBusy(false);
  }
});

// Live reading preview includes pending images and never writes to content files.
function setMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;
  $('preview-pane').hidden = mode === 'edit';
  $('toggle-preview').textContent = mode === 'edit' ? '预览' : '返回编写';
  document
    .querySelectorAll('[data-mode]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  queuePreview();
}
function queuePreview() {
  const version = ++state.previewVersion;
  clearTimeout(state.previewTimer);
  state.previewController?.abort();
  if (state.mode === 'edit') return;
  $('preview-title').textContent = $('title').value || '未命名内容';
  $('preview-description').textContent = $('description').value;
  $('preview-meta').textContent =
    `${$('date').value} · ${typeLabels[state.type]}${$('draft').value === 'true' ? ' · 草稿' : ''}`;
  $('preview-tags').innerHTML = parseTags($('tags').value)
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join('');
  $('preview-gallery').innerHTML =
    state.type === 'photography'
      ? state.photos
          .map(
            (photo, index) =>
              `<figure><img src="${escapeHtml(photoUrl(photo, 1440))}" alt="${escapeHtml(photo.caption || $('title').value)}"><figcaption>${String(index + 1).padStart(2, '0')}${photo.caption ? ' / ' + escapeHtml(photo.caption) : ''}</figcaption></figure>`
          )
          .join('')
      : '';
  state.previewTimer = setTimeout(async () => {
    state.previewController = new AbortController();
    try {
      const { html } = await api(
        '/api/preview',
        { body: $('body').value },
        state.previewController.signal
      );
      if (version !== state.previewVersion) return;
      $('preview-body').innerHTML = html || '<p class="hint">正文还没有内容。</p>';
      $('preview-body')
        .querySelectorAll('img')
        .forEach((image) => {
          image.src = assetUrl(image.getAttribute('src'));
        });
      $('preview-body')
        .querySelectorAll('a')
        .forEach((link) => {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        });
    } catch (error) {
      if (error.name === 'AbortError' || version !== state.previewVersion) return;
      $('preview-body').textContent = '预览暂时无法加载，请检查管理服务是否运行。';
    }
  }, 250);
}
$('toggle-preview').addEventListener('click', () =>
  setMode(state.mode === 'edit' ? 'preview' : 'edit')
);
document
  .querySelectorAll('[data-mode]')
  .forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-preview-size]').forEach((button) =>
  button.addEventListener('click', () => {
    $('preview-document').classList.toggle('phone', button.dataset.previewSize === 'phone');
    document
      .querySelectorAll('[data-preview-size]')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  })
);
document.querySelectorAll('[data-format]').forEach((button) =>
  button.addEventListener('click', () => {
    const input = $('body');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = input.value.slice(start, end);
    const formats = {
      heading: ['## ', '', '标题'],
      bold: ['**', '**', '粗体文字'],
      italic: ['*', '*', '斜体文字'],
      quote: ['> ', '', '引用文字'],
      list: ['- ', '', '列表项目'],
      link: ['[', '](https://example.com)', '链接文字'],
      code: ['```\n', '\n```', '代码']
    };
    let [before, after, placeholder] = formats[button.dataset.format];
    if (
      ['heading', 'quote', 'list', 'code'].includes(button.dataset.format) &&
      start > 0 &&
      input.value[start - 1] !== '\n'
    )
      before = '\n' + before;
    input.setRangeText(before + (selected || placeholder) + after, start, end, 'select');
    input.focus();
    input.setSelectionRange(
      start + before.length,
      start + before.length + (selected || placeholder).length
    );
    markDirty();
  })
);

// Crop/rotate creates a new staged file; source assets are never overwritten.
let imageEdit = null;
async function openImageEditor(id) {
  const photo = state.photos.find((item) => item.id === id);
  if (!photo) return;
  $('image-error').textContent = '';
  $('apply-image').disabled = true;
  $('image-dialog-title').textContent = `编辑照片 · 第 ${state.photos.indexOf(photo) + 1} 张`;
  $('image-dialog').showModal();
  $('image-canvas').width = 1;
  $('image-canvas').height = 1;
  try {
    const image = new Image();
    image.src = photoUrl(photo);
    await image.decode();
    if (!$('image-dialog').open) return;
    imageEdit = { id, image, rotation: 0 };
    $('crop-ratio').value = 'original';
    $('crop-x').value = '50';
    $('crop-y').value = '50';
    drawImageEditor();
  } catch {
    $('image-error').textContent = '无法读取这张照片，请替换图片后重试。';
  }
}
function drawImageEditor() {
  if (!imageEdit) return;
  const { image, rotation } = imageEdit;
  const rotated = document.createElement('canvas');
  const sideways = rotation % 180 !== 0;
  rotated.width = sideways ? image.naturalHeight : image.naturalWidth;
  rotated.height = sideways ? image.naturalWidth : image.naturalHeight;
  const context = rotated.getContext('2d');
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  const ratio =
    $('crop-ratio').value === 'original'
      ? rotated.width / rotated.height
      : Number($('crop-ratio').value);
  const width = Math.min(rotated.width, rotated.height * ratio);
  const height = width / ratio;
  const x = ((rotated.width - width) * Number($('crop-x').value)) / 100;
  const y = ((rotated.height - height) * Number($('crop-y').value)) / 100;
  const canvas = $('image-canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  canvas
    .getContext('2d')
    .drawImage(rotated, x, y, width, height, 0, 0, canvas.width, canvas.height);
  $('crop-position').hidden = $('crop-ratio').value === 'original';
  $('crop-x').disabled = rotated.width - width < 1;
  $('crop-y').disabled = rotated.height - height < 1;
  $('apply-image').disabled = rotation === 0 && $('crop-ratio').value === 'original';
}
$('rotate-left').addEventListener('click', () => {
  if (imageEdit) {
    imageEdit.rotation = (imageEdit.rotation + 270) % 360;
    drawImageEditor();
  }
});
$('rotate-right').addEventListener('click', () => {
  if (imageEdit) {
    imageEdit.rotation = (imageEdit.rotation + 90) % 360;
    drawImageEditor();
  }
});
for (const id of ['crop-ratio', 'crop-x', 'crop-y'])
  $(id).addEventListener('input', drawImageEditor);
$('reset-image').addEventListener('click', () => {
  if (!imageEdit) return;
  imageEdit.rotation = 0;
  $('crop-ratio').value = 'original';
  $('crop-x').value = '50';
  $('crop-y').value = '50';
  drawImageEditor();
});
$('image-dialog').addEventListener('close', () => {
  imageEdit = null;
  $('image-canvas').width = 1;
  $('image-canvas').height = 1;
});
$('apply-image').addEventListener('click', async () => {
  if (!imageEdit) return;
  const photo = state.photos.find((item) => item.id === imageEdit.id);
  $('apply-image').disabled = true;
  try {
    const blob = await new Promise((resolve) => $('image-canvas').toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成编辑后的图片。');
    if (blob.size > 30 * 1024 * 1024) throw new Error('编辑后的图片超过 30 MB，请减小裁剪范围。');
    const file = new File([blob], `${(photo.name || 'photo').replace(/\.[^.]+$/, '')}-edited.png`, {
      type: 'image/png'
    });
    pushHistory();
    Object.assign(photo, { file, url: objectUrl(file), name: file.name, src: '' });
    galleryChanged();
    $('image-dialog').close();
    setStatus('已应用图片修改，点击保存后写入项目。');
  } catch (error) {
    $('image-error').textContent = error.message;
    $('apply-image').disabled = false;
  }
});

async function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}
async function save() {
  if (state.busy || !$('editor').reportValidity()) return false;
  if (state.type === 'photography' && !state.photos.length) {
    setStatus('请至少添加一张照片。', true);
    setMode('edit');
    return false;
  }
  const key = draftKey();
  clearTimeout(state.draftTimer);
  setBusy(true, '保存中…');
  try {
    const pending = state.photos.filter((photo) => photo.file);
    for (const [index, photo] of pending.entries()) {
      $('save-entry').textContent = `上传照片 ${index + 1} / ${pending.length}…`;
      const result = await api('/api/photos', {
        files: [
          { name: photo.file.name, slug: generatedSlug(), data: await fileAsBase64(photo.file) }
        ]
      });
      photo.src = result.gallery[0].src;
      photo.file = undefined;
      // Stash successful uploads, so retrying a failed save never uploads them twice.
      if (state.dirty) await draftStore('put', key, snapshot()).catch(() => {});
    }
    const data = {
      ...state.current?.data,
      title: $('title').value.trim(),
      description: $('description').value.trim(),
      date: $('date').value,
      tags: parseTags($('tags').value),
      draft: $('draft').value === 'true'
    };
    if (state.type === 'photography') {
      data.cover =
        state.photos.find((photo) => photo.id === state.coverId)?.src || state.photos[0].src;
      data.gallery = state.photos.map((photo) => ({
        src: photo.src,
        ...(photo.caption ? { caption: photo.caption } : {})
      }));
    }
    const body = $('body').value;
    const saved = await api('/api/entry', {
      type: state.type,
      slug: generatedSlug(),
      originalSlug: state.current?.slug || '',
      revision: state.current?.revision,
      data,
      body
    });
    await draftStore('delete', key).catch(() => {});
    // Keep focus on the exact saved entry, including after a directory move.
    const entry = { ...saved, data, body: body.trim(), type: state.type };
    state.entries = state.entries.filter(
      (item) => item.slug !== state.current?.slug && item.slug !== saved.slug
    );
    state.entries.push(entry);
    await fill(entry, { showRecovery: false });
    setStatus(
      `已保存 ${saved.file}${pending.length ? `，包含 ${pending.length} 张新增或修改的照片` : ''}。`
    );
    return true;
  } catch (error) {
    state.dirty = true;
    renderGallery();
    await stash();
    setStatus(error.message, true);
    return false;
  } finally {
    setBusy(false);
  }
}
$('editor').addEventListener('submit', (event) => {
  event.preventDefault();
  save();
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!document.querySelector('dialog[open]')) save();
  }
});
fields.forEach((id) => $(id).addEventListener('input', markDirty));
window.addEventListener('beforeunload', (event) => {
  if (state.dirty || state.busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  if (state.dirty) stash();
});

let navigationAction;
async function navigate(action) {
  if (state.busy || $('navigation-dialog').open) return;
  if (!state.dirty) {
    setStatus('');
    await action();
    return;
  }
  navigationAction = action;
  $('navigation-dialog').showModal();
}
document.querySelectorAll('[data-navigation]').forEach((button) =>
  button.addEventListener('click', async () => {
    const choice = button.dataset.navigation;
    if (choice === 'cancel') {
      $('navigation-dialog').close();
      navigationAction = null;
      return;
    }
    document.querySelectorAll('[data-navigation]').forEach((item) => {
      item.disabled = true;
    });
    try {
      const ready = choice === 'save' ? await save() : await stash();
      if (!ready) {
        $('navigation-dialog').close();
        return;
      }
      $('navigation-dialog').close();
      const action = navigationAction;
      navigationAction = null;
      setStatus('');
      await action?.();
    } finally {
      document.querySelectorAll('[data-navigation]').forEach((item) => {
        item.disabled = false;
      });
    }
  })
);
$('new-entry').addEventListener('click', () =>
  navigate(async () => {
    await fill(null);
    setMode('edit');
    $('title').focus();
  })
);
$('entries').addEventListener('click', (event) => {
  const button = event.target.closest('[data-slug]');
  if (!button || state.current?.slug === button.dataset.slug) return;
  navigate(() => fill(state.entries.find((entry) => entry.slug === button.dataset.slug)));
});
document.querySelectorAll('[data-tab]').forEach((button) =>
  button.addEventListener('click', () => {
    if (state.type === button.dataset.tab) return;
    navigate(async () => {
      state.type = button.dataset.tab;
      $('filter').value = '';
      $('status-filter').value = 'all';
      $('import-results').textContent = '';
      await loadEntries();
    });
  })
);
for (const id of ['filter', 'status-filter', 'list-sort'])
  $(id).addEventListener('input', renderEntries);
$('restore-draft').addEventListener('click', () => {
  const draft = state.restore;
  if (!draft) return;
  for (const id of fields) $(id).value = draft.fields[id] ?? '';
  state.photos = draft.photos.map((photo) => ({
    ...photo,
    ...(photo.file ? { url: objectUrl(photo.file) } : {})
  }));
  state.coverId = draft.coverId;
  $('recovery-banner').hidden = true;
  renderGallery();
  markDirty();
  setStatus('已恢复本机暂存，点击保存 Markdown 后写入项目。');
});
$('discard-draft').addEventListener('click', async () => {
  try {
    await draftStore('delete', draftKey());
    $('recovery-banner').hidden = true;
    state.restore = null;
  } catch {
    setStatus('暂存无法删除，请稍后重试。', true);
  }
});
$('delete-entry').addEventListener('click', () => {
  if (!state.current?.slug) return;
  $('delete-message').textContent =
    `「${state.current.data.title}」将移到 .local-admin-trash，图片文件保留。${state.dirty ? '当前未保存的修改将被丢弃。' : ''}`;
  $('delete-dialog').showModal();
});
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('confirm-delete').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true, '删除中…');
  $('confirm-delete').disabled = true;
  try {
    clearTimeout(state.draftTimer);
    const result = await api('/api/delete', { type: state.type, slug: state.current.slug });
    if (!result.deleted) throw new Error('未找到文件，请刷新内容库。');
    await draftStore('delete', draftKey()).catch(() => {});
    state.dirty = false;
    $('delete-dialog').close();
    await loadEntries();
    setStatus('内容已移到本地回收站。');
  } catch (error) {
    $('delete-dialog').close();
    setStatus(error.message, true);
  } finally {
    setBusy(false);
    $('confirm-delete').disabled = false;
  }
});
$('open-import').addEventListener('click', () => $('import-dialog').showModal());
document
  .querySelectorAll('[data-close-dialog]')
  .forEach((button) =>
    button.addEventListener('click', () => $(button.dataset.closeDialog).close())
  );
$('import-interviews').addEventListener('click', async () => {
  const files = [...$('interview-files').files, ...$('interview-folder').files].filter((file) =>
    /\.md$/i.test(file.name)
  );
  if (!files.length) {
    $('import-results').textContent = '请选择 Markdown 文件或文件夹。';
    return;
  }
  const button = $('import-interviews');
  button.disabled = true;
  try {
    const encoded = await Promise.all(
      files.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        markdown: await file.text()
      }))
    );
    const data = await api('/api/interviews/import', { files: encoded });
    $('import-results').textContent = data.results
      .map(
        (item) =>
          `${item.saved ? '已导入' : '失败'} ${item.path}${item.error ? '：' + item.error : ''}`
      )
      .join('\n');
    $('interview-files').value = '';
    $('interview-folder').value = '';
    // Importing refreshes only the library; the open editor and unsaved text stay intact.
    state.entries = await api(`/api/entries?type=${state.type}`);
    renderEntries();
    setStatus(
      `已导入 ${data.results.filter((item) => item.saved).length} / ${files.length} 篇面试文章。`
    );
  } catch (error) {
    $('import-results').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
async function publishToSite() {
  if (state.busy) return;
  if (state.dirty) {
    const saved = await save();
    if (!saved) return;
  }
  const draft = $('draft').value === 'true';
  const warning = draft ? '当前内容仍是草稿：源文件会提交，但不会出现在公开站点。\n\n' : '';
  const confirmed = window.confirm(
    `${warning}将执行：检查并构建站点 → 只提交 src/content 与 src/assets/photos → push 到 main。\n\n这会把当前分支上已有的本地提交一并推送。继续？`
  );
  if (!confirmed) return;
  setBusy(true, '构建并发布…');
  setStatus('正在检查并构建站点，随后提交内容并 push 到 main，请稍候…');
  try {
    const result = await api('/api/publish', {});
    setStatus(result.message);
    $('save-state').textContent = result.pushed ? '已发布到线上' : '构建完成';
    $('save-state').classList.remove('dirty');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}
$('publish-site').addEventListener('click', publishToSite);

let selection;
try {
  selection = JSON.parse(localStorage.getItem('wenri-admin-selection'));
} catch {
  /* Start with the article library. */
}
if (selection && typeLabels[selection.type]) state.type = selection.type;
loadEntries(selection?.slug);
