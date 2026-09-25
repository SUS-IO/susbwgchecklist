/* ===========================================================
   IEC-BWG — app.js
   =========================================================== */
const $ = (id) => document.getElementById(id);
const CATEGORY_OPTIONS = ['Apartment','Hotel','Restaurant','School','College','Hospital','IT Park','Office','Other'];

const ZONE_CACHE_KEY = 'iecbwg_zoneMap';
const ZONE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6h — background-refreshed well before this

let currentUser = null;
let zoneSS, wardSS, categorySS;
let zoneWardMap = {};              // { zone: [wards...] } — fetched once, cached, no per-change network call
let currentImageBase64 = null;
let isSubmitting = false;
let currentRequestId = makeRequestId();

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
   MODAL (used by Admin's "Reset password")
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

  const isAdmin = currentUser.role === 'admin';
  $('adminTabBtn').hidden = !isAdmin;
  $('tabbar').hidden = !isAdmin; // regular users only ever see New Entry — no tabs needed

  $('iecStaff').value = currentUser.name;

  setupSearchableSelects();
  loadZoneWardMap();
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
  if (tab === 'admin') loadUsers();
}

/* ============================================================
   ZONE / WARD / CATEGORY (searchable selects)
   Whole Zone→Ward map is fetched once (and cached) instead of a
   network round-trip every time Zone changes — Ward now fills
   instantly with zero lag.
   ============================================================ */
function setupSearchableSelects(){
  zoneSS = createSearchableSelect($('zoneSelect'), { placeholder: 'Search zone…' });
  wardSS = createSearchableSelect($('wardSelect'), { placeholder: 'Select zone first' });
  categorySS = createSearchableSelect($('categorySelect'), { placeholder: 'Search category…' });

  categorySS.setOptions(CATEGORY_OPTIONS);
  wardSS.setDisabled(true);

  zoneSS.onChange((zone) => {
    clearFieldError('zone');
    wardSS.clear();
    if (!zone){ wardSS.setOptions([]); wardSS.setDisabled(true); return; }
    wardSS.setDisabled(false);
    wardSS.setOptions(zoneWardMap[zone] || []);   // instant — no fetch
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

function applyZoneMap(zones, map, keepSelection){
  zoneWardMap = map || {};
  zoneSS.setOptions(zones || [], { keepValueIfPresent: !!keepSelection });

  const rem = RememberedZoneWard.get();
  if (rem && rem.zone && (zones || []).includes(rem.zone)){
    zoneSS.setValue(rem.zone, true);
    wardSS.setDisabled(false);
    wardSS.setOptions(zoneWardMap[rem.zone] || []);
    if (rem.ward) wardSS.setValue(rem.ward, true);
  }
}

function readZoneCache(){
  try{
    const raw = localStorage.getItem(ZONE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function writeZoneCache(zones, map){
  try{ localStorage.setItem(ZONE_CACHE_KEY, JSON.stringify({ zones, map, ts: Date.now() })); }catch(e){}
}

async function loadZoneWardMap(){
  const cached = readZoneCache();
  if (cached && (Date.now() - cached.ts) < ZONE_CACHE_TTL){
    // instant paint from cache — no spinner, no wait
    applyZoneMap(cached.zones, cached.map);
    refreshZoneMapInBackground(); // silently keep it fresh for next time
    return;
  }
  // no usable cache — fetch once, this is the only case with a visible wait
  const res = await apiGet('getZoneWardMap');
  if (res.success){
    applyZoneMap(res.zones, res.map);
    writeZoneCache(res.zones, res.map);
  }
}
async function refreshZoneMapInBackground(){
  try{
    const res = await apiGet('getZoneWardMap');
    if (res.success){
      applyZoneMap(res.zones, res.map, true);
      writeZoneCache(res.zones, res.map);
    }
  }catch(e){ /* offline or slow — cached data already shown, ignore */ }
}

function updateEntryDateTime(){
  $('entryDateTime').value = new Date().toLocaleString();
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

// Waste Processing: each box is independent and optional — ticking it
// just requires its own paired field to be filled in.
$('compostingCheck').addEventListener('change', (e) => {
  $('compostingCapacity').disabled = !e.target.checked;
  if (!e.target.checked){ $('compostingCapacity').value = ''; clearFieldError('compostingCapacity'); }
});
$('processingCheck').addEventListener('change', (e) => {
  $('processingDetails').disabled = !e.target.checked;
  if (!e.target.checked){ $('processingDetails').value = ''; clearFieldError('processingDetails'); }
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

  // Waste Processing is optional overall — only the box(es) actually
  // ticked need their paired value filled in.
  if ($('compostingCheck').checked && String($('compostingCapacity').value).trim() === ''){
    setFieldError('compostingCapacity', 'Enter capacity, or untick this'); ok = false;
  }
  if ($('processingCheck').checked && $('processingDetails').value.trim() === ''){
    setFieldError('processingDetails', 'Enter details, or untick this'); ok = false;
  }

  return ok;
}

/* ============================================================
   SUBMIT — freezes instantly, is duplicate-safe
   ============================================================ */
function makeRequestId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

$('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmitting) return; // guards against any double-fire of the submit event itself
  if (!validateEntryForm()){ showToast('Please fix the highlighted fields', true); return; }
  if (WEB_APP_URL.includes('PASTE_YOUR')){ showToast('Set WEB_APP_URL in js/api.js first', true); return; }

  const payload = {
    clientRequestId: currentRequestId,   // server dedupes on this — a retry/double-tap can't create two rows
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
    image: currentImageBase64 || ''
  };

  // Freeze the instant Submit is pressed — this is both the "feels
  // instant" UX and the main defence against duplicate submissions.
  isSubmitting = true;
  $('entryFieldset').disabled = true;
  $('submitBtn').disabled = true;
  $('submitLabel').textContent = 'Saving…';
  $('submitSpinner').hidden = false;

  try{
    const res = await apiPost('saveEntry', payload);
    if (!res.success) throw new Error(res.error || 'Save failed');
    showSavedSummary(res.id, payload);
  }catch(err){
    showToast('Save failed: ' + err.message, true);
    // unfreeze so they can fix and retry — keep the same request ID,
    // so a retry of the same submit still can't double-save
    $('entryFieldset').disabled = false;
    $('submitBtn').disabled = false;
    $('submitLabel').textContent = 'Save Entry';
    $('submitSpinner').hidden = true;
  }finally{
    isSubmitting = false;
  }
});

function showSavedSummary(id, payload){
  $('submitBtn').hidden = true;
  $('savedIdLabel').textContent = id;

  const rows = [
    ['Zone / Ward', `${payload.zone} / ${payload.ward}`],
    ['BWG Name', payload.bwgName],
    ['Category', payload.category + (payload.categoryOther ? ' — ' + payload.categoryOther : '')],
    ['Contact', `${payload.contactPerson} (${payload.mobile})`],
    ['Saved at', new Date().toLocaleString()]
  ];
  $('savedDetails').innerHTML = rows.map(([k,v]) =>
    `<div class="detail-row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`
  ).join('');
  $('savedBanner').hidden = false;
}

$('newEntryBtn').addEventListener('click', resetEntryForm);

function resetEntryForm(){
  currentImageBase64 = null;
  currentRequestId = makeRequestId(); // fresh id for the next, distinct entry
  $('entryForm').reset();
  $('entryFieldset').disabled = false;
  $('submitBtn').hidden = false;
  $('submitBtn').disabled = false;
  $('submitLabel').textContent = 'Save Entry';
  $('submitSpinner').hidden = true;
  $('savedBanner').hidden = true;
  clearAllErrors();
  $('categoryOtherField').hidden = true;
  categorySS.clear();
  $('compostingCapacity').disabled = true;
  $('processingDetails').disabled = true;
  $('photoInput').classList.remove('filled');
  $('preview').src = '';
  ['imageCamera','imageGallery'].forEach(id => $(id).value = '');
  $('iecStaff').value = currentUser.name;
  updateEntryDateTime();

  // Zone/Ward stays as the user last set it, until they change it themselves
  const rem = RememberedZoneWard.get();
  if (rem && rem.zone){
    zoneSS.setValue(rem.zone, true);
    wardSS.setDisabled(false);
    wardSS.setOptions(zoneWardMap[rem.zone] || []);
    if (rem.ward) wardSS.setValue(rem.ward, true);
  } else {
    zoneSS.clear(); wardSS.clear(); wardSS.setDisabled(true);
  }
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   ADMIN — user creation & management only (no entries here;
   entries are viewed directly in Google Sheets)
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
        if (!pw) return;
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
