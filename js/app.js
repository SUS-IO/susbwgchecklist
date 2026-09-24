/* ===========================================================
   IEC-BWG — app.js
   =========================================================== */
const $ = (id) => document.getElementById(id);
const CATEGORY_OPTIONS = ['Apartment','Hotel','Restaurant','School','College','Hospital','IT Park','Office','Other'];
const PAGE_SIZE = 10;

let currentUser = null;
let zoneSS, wardSS, categorySS, filterZoneSS;
let editingEntryId = null;
let currentImageBase64 = null;     // newly picked image (base64) — null if unchanged
let existingImageUrl = '';         // image already on the entry, when editing
let myEntriesPage = 1;
let allEntriesPage = 1;
let allEntriesView = 'table';
let allEntriesFilters = {};

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(message, isError){
  const t = $('toast');
  t.textContent = message;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 4200);
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal(innerHtml){
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal-sheet">${innerHtml}</div></div>`;
  root.querySelector('#modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
  const closeBtn = root.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}
function closeModal(){ $('modalRoot').innerHTML = ''; }

function confirmDialog(title, message, onConfirm){
  openModal(`
    <div class="modal-head"><h3>${title}</h3><button class="modal-close">✕</button></div>
    <p style="font-size:14px;color:var(--ink-muted);margin:0 0 18px;">${message}</p>
    <div style="display:flex;gap:10px;">
      <button class="btn-ghost sm" id="confirmCancel" style="flex:1;justify-content:center;">Cancel</button>
      <button class="btn-primary sm" id="confirmOk" style="flex:1;background:var(--err);color:#fff;box-shadow:none;">Confirm</button>
    </div>
  `);
  $('confirmCancel').addEventListener('click', closeModal);
  $('confirmOk').addEventListener('click', () => { closeModal(); onConfirm(); });
}

/* ============================================================
   LOGIN
   ============================================================ */
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  $('loginErr').textContent = '';
  if (!username || !password){ $('loginErr').textContent = 'Enter username and password'; return; }

  $('loginBtn').disabled = true;
  $('loginBtnLabel').textContent = 'Logging in…';
  $('loginSpinner').hidden = false;
  try{
    const res = await apiPost('login', { username, password });
    if (!res.success){ $('loginErr').textContent = res.error || 'Login failed'; return; }
    Auth.set(res.token, res.user);
    boot();
  }catch(err){
    $('loginErr').textContent = 'Could not reach server. Check your connection.';
  }finally{
    $('loginBtn').disabled = false;
    $('loginBtnLabel').textContent = 'Log In';
    $('loginSpinner').hidden = true;
  }
});

$('logoutBtn').addEventListener('click', () => {
  Auth.clear();
  location.reload();
});

// auto-logout watcher
setInterval(() => {
  if (!Auth.isLoggedIn() && !$('appShell').hidden){ location.reload(); }
}, 60000);

/* ============================================================
   BOOT / TABS
   ============================================================ */
function boot(){
  const auth = Auth.get();
  if (!auth){ $('loginView').hidden = false; $('appShell').hidden = true; return; }
  currentUser = auth.user;
  $('loginView').hidden = true;
  $('appShell').hidden = false;
  $('userName').textContent = currentUser.name;
  $('userRole').textContent = currentUser.role;
  $('adminTabBtn').hidden = currentUser.role !== 'admin';
  $('iecStaff').value = currentUser.name;

  setupSearchableSelects();
  loadZones();
  updateEntryDateTime();
  setInterval(updateEntryDateTime, 30000);
  switchTab('newEntry');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach(v => v.hidden = true);
  $('view-' + tab).hidden = false;
  if (tab === 'myEntries') loadMyEntries(1);
  if (tab === 'allEntries') loadAllEntries(1);
  if (tab === 'admin') loadUsers();
}

/* ============================================================
   ZONE / WARD / CATEGORY (searchable selects)
   ============================================================ */
function setupSearchableSelects(){
  zoneSS = createSearchableSelect($('zoneSelect'), { placeholder: 'Search zone…' });
  wardSS = createSearchableSelect($('wardSelect'), { placeholder: 'Select zone first' });
  categorySS = createSearchableSelect($('categorySelect'), { placeholder: 'Search category…' });
  filterZoneSS = createSearchableSelect($('filterZoneSelect'), { placeholder: 'Filter by zone (all)' });

  categorySS.setOptions(CATEGORY_OPTIONS);
  wardSS.setDisabled(true);

  zoneSS.onChange(async (zone) => {
    clearFieldError('zone');
    wardSS.clear();
    if (!zone){ wardSS.setOptions([]); wardSS.setDisabled(true); return; }
    wardSS.setDisabled(false);
    wardSS.setOptions(['Loading…']);
    const res = await apiGet('getWards', { zone });
    wardSS.setOptions(res.wards || []);
    RememberedZoneWard.set(zone, '');
  });
  wardSS.onChange((ward) => {
    clearFieldError('ward');
    const rem = RememberedZoneWard.get() || {};
    RememberedZoneWard.set(rem.zone || zoneSS.getValue(), ward);
  });
  categorySS.onChange((cat) => {
    clearFieldError('category');
    $('categoryOtherField').hidden = cat !== 'Other';
    if (cat !== 'Other') $('categoryOther').value = '';
  });
}

async function loadZones(){
  const res = await apiGet('getZones');
  zoneSS.setOptions(res.zones || []);
  filterZoneSS.setOptions(res.zones || []);

  // reapply remembered zone/ward (kept until user changes it manually)
  const rem = RememberedZoneWard.get();
  if (rem && rem.zone){
    zoneSS.setValue(rem.zone, true);
    wardSS.setDisabled(false);
    const wardsRes = await apiGet('getWards', { zone: rem.zone });
    wardSS.setOptions(wardsRes.wards || []);
    if (rem.ward) wardSS.setValue(rem.ward, true);
  }
}

function updateEntryDateTime(){
  const now = new Date();
  $('entryDateTime').value = now.toLocaleString();
}

/* ============================================================
   CHECKLIST GROUP HELPERS
   ============================================================ */
function getCheckedValues(group){
  return Array.from(document.querySelectorAll(`.check-grid[data-group="${group}"] input:checked`)).map(cb => cb.value);
}
function setCheckedValues(group, values){
  values = values || [];
  document.querySelectorAll(`.check-grid[data-group="${group}"] input`).forEach(cb => {
    cb.checked = values.includes(cb.value);
    cb.closest('.check-pill').classList.toggle('on', cb.checked);
  });
}
document.addEventListener('change', (e) => {
  if (e.target.matches('.check-pill input[type=checkbox]')){
    e.target.closest('.check-pill').classList.toggle('on', e.target.checked);
  }
});

$('compostingCheck').addEventListener('change', (e) => {
  $('compostingCapacity').disabled = !e.target.checked;
  if (!e.target.checked) $('compostingCapacity').value = '';
  clearFieldError('wasteProcessing');
});
$('processingCheck').addEventListener('change', (e) => {
  $('processingDetails').disabled = !e.target.checked;
  if (!e.target.checked) $('processingDetails').value = '';
  clearFieldError('wasteProcessing');
});

/* ============================================================
   PHOTO
   ============================================================ */
function handleImageFile(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentImageBase64 = reader.result;
    $('preview').src = reader.result;
    $('photoInput').classList.add('filled');
  };
  reader.readAsDataURL(file);
}
$('imageCamera').addEventListener('change', (e) => handleImageFile(e.target.files[0]));
$('imageGallery').addEventListener('change', (e) => handleImageFile(e.target.files[0]));

/* ============================================================
   VALIDATION
   ============================================================ */
function setFieldError(name, msg){
  const el = document.querySelector(`.err[data-for="${name}"]`);
  if (el) el.textContent = msg;
}
function clearFieldError(name){
  const el = document.querySelector(`.err[data-for="${name}"]`);
  if (el) el.textContent = '';
}
function clearAllErrors(){ document.querySelectorAll('.err').forEach(e => e.textContent = ''); }

function validateEntryForm(){
  clearAllErrors();
  let ok = true;
  const reqField = (id, name, msg) => {
    const el = $(id);
    if (!el.value || !String(el.value).trim()){ setFieldError(name, msg); ok = false; }
  };

  if (!zoneSS.getValue()){ setFieldError('zone', 'Select a zone'); ok = false; }
  if (!wardSS.getValue()){ setFieldError('ward', 'Select a ward'); ok = false; }
  reqField('bwgName', 'bwgName', 'Enter BWG name');
  if (!categorySS.getValue()){ setFieldError('category', 'Select a category'); ok = false; }
  if (categorySS.getValue() === 'Other' && !$('categoryOther').value.trim()){
    setFieldError('categoryOther', 'Please specify'); ok = false;
  }
  reqField('contactPerson', 'contactPerson', 'Enter contact person');

  const mobile = $('mobile').value.trim();
  if (!/^\d{10}$/.test(mobile)){ setFieldError('mobile', 'Enter a valid 10-digit number'); ok = false; }

  reqField('units', 'units', 'Enter a value');
  reqField('wasteGenerated', 'wasteGenerated', 'Enter a value');

  if (getCheckedValues('segregation').length === 0){ setFieldError('segregation', 'Select at least one'); ok = false; }
  if (getCheckedValues('binAvailability').length === 0){ setFieldError('binAvailability', 'Select at least one'); ok = false; }
  if (getCheckedValues('storageArea').length === 0){ setFieldError('storageArea', 'Select at least one'); ok = false; }
  if (getCheckedValues('iecActivities').length === 0){ setFieldError('iecActivities', 'Select at least one'); ok = false; }

  const compostingOk = $('compostingCheck').checked && String($('compostingCapacity').value).trim() !== '';
  const processingOk = $('processingCheck').checked && $('processingDetails').value.trim() !== '';
  if (!compostingOk && !processingOk){
    setFieldError('wasteProcessing', 'Fill in at least one (with its value)'); ok = false;
  }

  return ok;
}

/* ============================================================
   SUBMIT (create or update)
   ============================================================ */
$('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateEntryForm()){ showToast('Please fix the highlighted fields', true); return; }
  if (WEB_APP_URL.includes('PASTE_YOUR')){ showToast('Set WEB_APP_URL in js/api.js first', true); return; }

  const payload = {
    zone: zoneSS.getValue(),
    ward: wardSS.getValue(),
    bwgName: $('bwgName').value.trim(),
    category: categorySS.getValue(),
    categoryOther: categorySS.getValue() === 'Other' ? $('categoryOther').value.trim() : '',
    contactPerson: $('contactPerson').value.trim(),
    mobile: $('mobile').value.trim(),
    units: $('units').value,
    wasteGenerated: $('wasteGenerated').value,
    segregation: getCheckedValues('segregation'),
    binAvailability: getCheckedValues('binAvailability'),
    compostingChecked: $('compostingCheck').checked,
    compostingCapacity: $('compostingCapacity').value || '',
    processingChecked: $('processingCheck').checked,
    processingDetails: $('processingDetails').value.trim(),
    storageArea: getCheckedValues('storageArea'),
    iecActivities: getCheckedValues('iecActivities'),
    remarks: $('remarks').value.trim(),
    image: currentImageBase64 || '',        // new photo, if picked
    keepExistingImage: !currentImageBase64 && !!existingImageUrl
  };
  if (editingEntryId) payload.id = editingEntryId;

  const submitBtn = $('submitBtn');
  submitBtn.disabled = true;
  $('submitLabel').textContent = 'Saving…';
  $('submitSpinner').hidden = false;

  try{
    const res = await apiPost(editingEntryId ? 'updateEntry' : 'saveEntry', payload);
    if (!res.success) throw new Error(res.error || 'Save failed');

    showToast(editingEntryId ? `Entry ${res.id} updated` : `Saved as ${res.id}`);
    freezeForm(res.id);
  }catch(err){
    showToast('Save failed: ' + err.message, true);
  }finally{
    submitBtn.disabled = false;
    $('submitLabel').textContent = 'Save Entry';
    $('submitSpinner').hidden = true;
  }
});

function freezeForm(savedId){
  $('entryFieldset').disabled = true;
  $('submitBtn').hidden = true;
  $('savedIdLabel').textContent = savedId;
  $('savedBanner').hidden = false;
  $('editBanner').hidden = true;
}
$('newEntryBtn').addEventListener('click', resetEntryForm);
$('cancelEditBtn').addEventListener('click', resetEntryForm);

function resetEntryForm(){
  editingEntryId = null;
  currentImageBase64 = null;
  existingImageUrl = '';
  $('entryForm').reset();
  $('entryFieldset').disabled = false;
  $('submitBtn').hidden = false;
  $('savedBanner').hidden = true;
  $('editBanner').hidden = true;
  clearAllErrors();
  $('categoryOtherField').hidden = true;
  categorySS.clear();
  $('compostingCapacity').disabled = true;
  $('processingDetails').disabled = true;
  $('photoInput').classList.remove('filled');
  $('preview').src = '';
  ['imageCamera','imageGallery'].forEach(id => $(id).value = '');
  $('iecStaff').value = currentUser.name;
  $('submitLabel').textContent = 'Save Entry';
  updateEntryDateTime();

  // keep remembered zone/ward
  const rem = RememberedZoneWard.get();
  if (rem && rem.zone){
    zoneSS.setValue(rem.zone, true);
    apiGet('getWards', { zone: rem.zone }).then(res => {
      wardSS.setDisabled(false);
      wardSS.setOptions(res.wards || []);
      if (rem.ward) wardSS.setValue(rem.ward, true);
    });
  } else {
    zoneSS.clear(); wardSS.clear(); wardSS.setDisabled(true);
  }
}

/* Populate the form for editing an existing (today's own) entry */
function loadEntryIntoForm(entry){
  switchTab('newEntry');
  resetEntryForm();
  editingEntryId = entry.id;

  zoneSS.setValue(entry.zone, true);
  apiGet('getWards', { zone: entry.zone }).then(res => {
    wardSS.setDisabled(false);
    wardSS.setOptions(res.wards || []);
    wardSS.setValue(entry.ward, true);
  });

  $('bwgName').value = entry.bwgName || '';
  categorySS.setValue(entry.category, true);
  if (entry.category === 'Other'){
    $('categoryOtherField').hidden = false;
    $('categoryOther').value = entry.categoryOther || '';
  }
  $('contactPerson').value = entry.contactPerson || '';
  $('mobile').value = entry.mobile || '';
  $('units').value = entry.units || '';
  $('wasteGenerated').value = entry.wasteGenerated || '';

  setCheckedValues('segregation', entry.segregation || []);
  setCheckedValues('binAvailability', entry.binAvailability || []);
  setCheckedValues('storageArea', entry.storageArea || []);
  setCheckedValues('iecActivities', entry.iecActivities || []);

  $('compostingCheck').checked = !!entry.compostingChecked;
  $('compostingCapacity').disabled = !entry.compostingChecked;
  $('compostingCapacity').value = entry.compostingCapacity || '';
  $('processingCheck').checked = !!entry.processingChecked;
  $('processingDetails').disabled = !entry.processingChecked;
  $('processingDetails').value = entry.processingDetails || '';

  $('remarks').value = entry.remarks || '';

  if (entry.image){
    existingImageUrl = entry.image;
    $('preview').src = entry.image;
    $('photoInput').classList.add('filled');
  }

  $('editingIdLabel').textContent = entry.id;
  $('editBanner').hidden = false;
  $('submitLabel').textContent = 'Update Entry';
}

/* ============================================================
   MY ENTRIES
   ============================================================ */
$('myEntriesRefresh').addEventListener('click', () => loadMyEntries(myEntriesPage));

async function loadMyEntries(page){
  myEntriesPage = page;
  const container = $('myEntriesList');
  container.innerHTML = `<div class="empty-state">Loading…</div>`;
  const res = await apiGet('getMyEntries', { page, pageSize: PAGE_SIZE });
  if (!res.success){ container.innerHTML = `<div class="empty-state">${res.error || 'Failed to load'}</div>`; return; }

  if (!res.entries.length){
    container.innerHTML = `<div class="empty-state">No entries yet. Submit your first one from "New Entry".</div>`;
  } else {
    container.innerHTML = '';
    res.entries.forEach(entry => container.appendChild(buildEntryCard(entry, true)));
  }
  renderPager($('myEntriesPager'), page, res.totalPages, (p) => loadMyEntries(p));
}

function buildEntryCard(entry, ownList){
  const div = document.createElement('div');
  div.className = 'entry-card';
  div.innerHTML = `
    <div class="entry-card-top">
      <span class="entry-id">${entry.id}</span>
      <span class="entry-date">${entry.date} ${entry.time || ''}</span>
    </div>
    <p class="entry-title">${escapeHtml(entry.bwgName)}</p>
    <p class="entry-sub">${escapeHtml(entry.zone)} — ${escapeHtml(entry.ward)} · ${escapeHtml(entry.category)}</p>
    <div class="entry-badges">
      ${entry.editable ? '<span class="badge today">Today — editable</span>' : ''}
      ${!ownList ? `<span class="badge">by ${escapeHtml(entry.iecStaff)}</span>` : ''}
    </div>
    <div class="entry-actions"></div>
  `;
  const actions = div.querySelector('.entry-actions');

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn-ghost sm';
  viewBtn.textContent = 'View';
  viewBtn.addEventListener('click', () => viewEntryModal(entry));
  actions.appendChild(viewBtn);

  if (ownList && entry.editable){
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-ghost sm';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => loadEntryIntoForm(entry));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-ghost sm';
    delBtn.style.borderColor = 'var(--err)';
    delBtn.style.color = 'var(--err)';
    delBtn.style.background = 'var(--err-bg)';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      confirmDialog('Delete entry?', `This will permanently remove entry <strong>${entry.id}</strong>.`, async () => {
        const res = await apiPost('deleteEntry', { id: entry.id });
        if (res.success){ showToast('Entry deleted'); loadMyEntries(myEntriesPage); }
        else showToast(res.error || 'Delete failed', true);
      });
    });
    actions.appendChild(delBtn);
  }
  return div;
}

function renderPager(el, page, totalPages, onGo){
  el.innerHTML = '';
  if (totalPages <= 1) return;
  const prev = document.createElement('button');
  prev.className = 'btn-ghost sm'; prev.textContent = '← Prev';
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => onGo(page - 1));

  const label = document.createElement('span');
  label.textContent = `Page ${page} of ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'btn-ghost sm'; next.textContent = 'Next →';
  next.disabled = page >= totalPages;
  next.addEventListener('click', () => onGo(page + 1));

  el.appendChild(prev); el.appendChild(label); el.appendChild(next);
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   ALL ENTRIES
   ============================================================ */
document.querySelectorAll('.vt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    allEntriesView = btn.dataset.view;
    loadAllEntries(allEntriesPage);
  });
});
$('applyFiltersBtn').addEventListener('click', () => {
  allEntriesFilters = {
    zone: filterZoneSS.getValue(),
    date: $('filterDate').value,
    search: $('filterSearch').value.trim()
  };
  loadAllEntries(1);
});
$('resetFiltersBtn').addEventListener('click', () => {
  filterZoneSS.clear(); $('filterDate').value = ''; $('filterSearch').value = '';
  allEntriesFilters = {};
  loadAllEntries(1);
});

async function loadAllEntries(page){
  allEntriesPage = page;
  const container = $('allEntriesContainer');
  container.innerHTML = `<div class="empty-state">Loading…</div>`;
  const res = await apiGet('getAllEntries', { page, pageSize: PAGE_SIZE, ...allEntriesFilters });
  if (!res.success){ container.innerHTML = `<div class="empty-state">${res.error || 'Failed to load'}</div>`; return; }

  if (!res.entries.length){
    container.innerHTML = `<div class="empty-state">No entries match.</div>`;
  } else if (allEntriesView === 'table'){
    container.innerHTML = '';
    container.appendChild(buildEntriesTable(res.entries));
  } else {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'entries-list';
    res.entries.forEach(entry => wrap.appendChild(buildEntryCard(entry, false)));
    container.appendChild(wrap);
  }
  renderPager($('allEntriesPager'), page, res.totalPages, (p) => loadAllEntries(p));
}

function buildEntriesTable(entries){
  const wrap = document.createElement('div');
  wrap.className = 'entries-table-wrap';
  const table = document.createElement('table');
  table.className = 'entries-table';
  table.innerHTML = `
    <thead><tr>
      <th>ID</th><th>Date</th><th>Zone</th><th>Ward</th><th>BWG Name</th><th>Category</th><th>Staff</th><th></th>
    </tr></thead>
  `;
  const tbody = document.createElement('tbody');
  entries.forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${entry.id}</td>
      <td class="mono">${entry.date}</td>
      <td>${escapeHtml(entry.zone)}</td>
      <td>${escapeHtml(entry.ward)}</td>
      <td>${escapeHtml(entry.bwgName)}</td>
      <td>${escapeHtml(entry.category)}</td>
      <td>${escapeHtml(entry.iecStaff)}</td>
      <td></td>
    `;
    const btn = document.createElement('button');
    btn.className = 'link-btn'; btn.textContent = 'View';
    btn.addEventListener('click', () => viewEntryModal(entry));
    tr.lastElementChild.appendChild(btn);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function viewEntryModal(entry){
  const rows = [
    ['Date / Time', `${entry.date} ${entry.time || ''}`],
    ['Zone / Ward', `${entry.zone} / ${entry.ward}`],
    ['BWG Name', entry.bwgName],
    ['Category', entry.category + (entry.categoryOther ? ' — ' + entry.categoryOther : '')],
    ['Contact', `${entry.contactPerson} (${entry.mobile})`],
    ['Units', entry.units],
    ['Waste Generated', entry.wasteGenerated + ' kg/day'],
    ['Segregation', (entry.segregation || []).join(', ') || '—'],
    ['Bin Availability', (entry.binAvailability || []).join(', ') || '—'],
    ['Composting', entry.compostingChecked ? (entry.compostingCapacity + ' T') : '—'],
    ['Processing Facilities', entry.processingChecked ? entry.processingDetails : '—'],
    ['Storage Area', (entry.storageArea || []).join(', ') || '—'],
    ['IEC Activities', (entry.iecActivities || []).join(', ') || '—'],
    ['Remarks', entry.remarks || '—'],
    ['IEC Staff', entry.iecStaff]
  ];
  openModal(`
    <div class="modal-head"><h3>${entry.id}</h3><button class="modal-close">✕</button></div>
    ${rows.map(([k,v]) => `<div class="detail-row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join('')}
    ${entry.image ? `<img class="detail-photo" src="${entry.image}" alt="">` : ''}
  `);
}

/* ============================================================
   ADMIN
   ============================================================ */
$('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('createUserErr').textContent = '';
  const username = $('newUsername').value.trim();
  const name = $('newName').value.trim();
  const password = $('newPassword').value;
  const role = $('newRole').value;
  if (!username || !name || !password){ $('createUserErr').textContent = 'All fields except role are required'; return; }

  $('createUserBtn').disabled = true;
  try{
    const res = await apiPost('createUser', { username, name, password, role });
    if (!res.success){ $('createUserErr').textContent = res.error || 'Failed to create user'; return; }
    showToast(`User "${username}" created`);
    $('createUserForm').reset();
    loadUsers();
  }finally{
    $('createUserBtn').disabled = false;
  }
});

async function loadUsers(){
  const wrap = $('usersTableWrap');
  wrap.innerHTML = `<div class="empty-state">Loading…</div>`;
  const res = await apiGet('listUsers');
  if (!res.success){ wrap.innerHTML = `<div class="empty-state">${res.error || 'Failed to load'}</div>`; return; }

  const table = document.createElement('table');
  table.className = 'users-table';
  table.innerHTML = `<thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>`;
  const tbody = document.createElement('tbody');
  res.users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td><span class="status-pill ${u.active ? 'active' : 'inactive'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td class="row-actions"></td>
    `;
    const actions = tr.querySelector('.row-actions');

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'link-btn';
    toggleBtn.textContent = u.active ? 'Deactivate' : 'Activate';
    toggleBtn.addEventListener('click', async () => {
      const res2 = await apiPost('toggleUserActive', { username: u.username, active: !u.active });
      if (res2.success) loadUsers(); else showToast(res2.error || 'Failed', true);
    });
    actions.appendChild(toggleBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'link-btn';
    resetBtn.style.marginLeft = '10px';
    resetBtn.textContent = 'Reset PW';
    resetBtn.addEventListener('click', () => {
      openModal(`
        <div class="modal-head"><h3>Reset password</h3><button class="modal-close">✕</button></div>
        <div class="field"><label>New password for ${escapeHtml(u.username)}</label><input type="text" id="rpwInput"></div>
        <button class="btn-primary sm" id="rpwSave">Save</button>
      `);
      $('rpwSave').addEventListener('click', async () => {
        const pw = $('rpwInput').value;
        if (!pw){ return; }
        const res3 = await apiPost('resetPassword', { username: u.username, newPassword: pw });
        if (res3.success){ showToast('Password reset'); closeModal(); } else showToast(res3.error || 'Failed', true);
      });
    });
    actions.appendChild(resetBtn);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(table);
}

/* ============================================================
   INIT
   ============================================================ */
boot();
