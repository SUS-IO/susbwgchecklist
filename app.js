/* ==========================================================================
   BWG Inspection App — Application Logic
   ========================================================================== */

// >>> PASTE your deployed Apps Script Web App URL here (must end in /exec) <<<
const API_URL = 'https://script.google.com/macros/s/AKfycbwF41EIjZ6rqT4U3g9JFEx-xLs8ZTWO7YUjQTHryksConxsC9F7oA7fS8cizOSa8L2vDg/exec';

const CATEGORY_OPTIONS = ['Apartment','Hotel','Restaurant','School','College','Hospital','IT Park','Office','Other'];
const WASTE_SEGREGATION_OPTIONS = ['Wet Waste','Dry Waste','Special Care Waste','Sanitary Waste','In Separate Waste'];
const BIN_AVAILABILITY_OPTIONS = ['Wet Bin','Dry Bin','Sanitary Bin','Special Care Bin','Labels Available / Colour Label','Bins in Good Condition'];
const STORAGE_AREA_OPTIONS = ['Dedicated Area','Covered','Clean & Hygienic','No Odour','No Littering'];
const IEC_ACTIVITIES_OPTIONS = ['Awareness Conducted','Pamphlets Distributed','SWM Rules Explained','Source Segregation Explained'];

let SESSION = null;
let ZONES = [];
let imageUploadInProgress = false;

/* ================= TOAST ================= */
function toast(message, type) {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

/* ================= API HELPER (with timeout + clear diagnostics) ================= */
async function apiRaw(action, payload, token, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // keeps this a "simple" request — avoids CORS preflight
      body: JSON.stringify({ action, payload: payload || {}, token: token || '' }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('The server took too long to respond. Please check your connection and try again.');
    throw new Error('Could not reach the server. Check that the app is online and the API URL is configured correctly.');
  }
  clearTimeout(timer);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('The server returned an unexpected response (HTTP ' + res.status + '). ' +
      'This usually means the Web App is not deployed with "Anyone" access, or the API URL is wrong.');
  }
  return data;
}

async function api(action, payload) {
  const data = await apiRaw(action, payload, SESSION ? SESSION.token : '');
  if (data.error) {
    if (String(data.error).indexOf('SESSION_EXPIRED') === 0) {
      toast('Your session has expired. Please log in again.', 'error');
      doLogout(true);
    }
    throw new Error(data.error);
  }
  return data;
}

/* ================= CONNECTION DIAGNOSTICS (shown on login screen) ================= */
async function checkConnection() {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  if (API_URL.indexOf('YOUR_DEPLOYMENT_ID') !== -1) {
    dot.className = 'conn-dot bad';
    label.textContent = 'App not configured — set API_URL in app.js';
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(API_URL, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data && data.ok) { dot.className = 'conn-dot ok'; label.textContent = 'Connected'; }
    else { dot.className = 'conn-dot bad'; label.textContent = 'Server reachable but returned an unexpected response'; }
  } catch (e) {
    dot.className = 'conn-dot bad';
    label.textContent = 'Cannot reach server — check deployment access is set to "Anyone"';
  }
}

/* ================= SEARCHABLE DROPDOWN ================= */
function makeSearchDropdown(containerId, options, onSelect, placeholder) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = `<input type="text" class="sdrop-input" placeholder="${placeholder || 'Type to search...'}" autocomplete="off">
    <div class="sdrop-list"></div>`;
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.sdrop-list');
  let currentOptions = options || [];

  function render(filterText) {
    const f = (filterText || '').toLowerCase();
    const matches = currentOptions.filter(o => o.toLowerCase().includes(f));
    list.innerHTML = matches.length
      ? matches.map(o => `<div data-val="${o.replace(/"/g,'&quot;')}">${o}</div>`).join('')
      : `<div class="empty">No matches</div>`;
    list.style.display = 'block';
  }
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(() => list.style.display = 'none', 150));
  list.addEventListener('mousedown', (e) => {
    const val = e.target.getAttribute('data-val');
    if (val !== null) { input.value = val; list.style.display = 'none'; onSelect && onSelect(val); }
  });
  return {
    setOptions(opts) { currentOptions = opts || []; },
    getValue() { return input.value; },
    setValue(v) { input.value = v || ''; },
    clear() { input.value = ''; }
  };
}

let zoneDrop, wardDrop, categoryDrop;

function initDropdowns() {
  zoneDrop = makeSearchDropdown('zoneDropWrap', ZONES, async (val) => {
    wardDrop.setValue('');
    try {
      const r = await api('getWards', { zone: val });
      wardDrop.setOptions(r.wards);
    } catch (e) { toast(e.message, 'error'); }
  }, 'Search zone...');

  wardDrop = makeSearchDropdown('wardDropWrap', [], null, 'Search ward...');

  categoryDrop = makeSearchDropdown('categoryDropWrap', CATEGORY_OPTIONS, (val) => {
    document.getElementById('categoryOtherWrap').style.display = (val === 'Other') ? 'block' : 'none';
  }, 'Search category...');
}

function renderChecklist(containerId, options) {
  document.getElementById(containerId).innerHTML = options.map(o =>
    `<label class="chk"><input type="checkbox" value="${o.replace(/"/g,'&quot;')}">${o}</label>`
  ).join('');
}
function getChecked(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map(i => i.value);
}
function setChecked(containerId, values) {
  const set = new Set((values || '').split(',').map(s => s.trim()).filter(Boolean));
  document.querySelectorAll(`#${containerId} input`).forEach(i => { i.checked = set.has(i.value); });
}

/* ================= LOGIN / LOGOUT ================= */
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  const btn = document.getElementById('loginBtn');
  msg.innerHTML = '';
  if (!username || !password) { msg.innerHTML = '<div class="msg error">Enter your username and password.</div>'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Signing in...';
  try {
    const data = await apiRaw('login', { username, password }, '', 15000);
    if (data.error) { msg.innerHTML = `<div class="msg error">${data.error}</div>`; return; }
    SESSION = data;
    localStorage.setItem('bwg_session', JSON.stringify(SESSION));
    enterApp();
  } catch (e) {
    msg.innerHTML = `<div class="msg error">${e.message}</div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = 'Log In';
  }
}

function doLogout(silent) {
  if (SESSION && !silent) api('logout', {}).catch(() => {});
  SESSION = null;
  localStorage.removeItem('bwg_session');
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  checkConnection();
}

async function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('userFullName').textContent = SESSION.fullName || SESSION.username;
  document.getElementById('userRoleBadge').textContent = SESSION.role;
  const isAdmin = SESSION.role === 'Admin';
  document.getElementById('tabAdminBtn').classList.toggle('hidden', !isAdmin);
  document.getElementById('navAdminBtn').classList.toggle('hidden', !isAdmin);

  renderChecklist('chkWasteSegregation', WASTE_SEGREGATION_OPTIONS);
  renderChecklist('chkBinAvailability', BIN_AVAILABILITY_OPTIONS);
  renderChecklist('chkStorageArea', STORAGE_AREA_OPTIONS);
  renderChecklist('chkIecActivities', IEC_ACTIVITIES_OPTIONS);

  try {
    const r = await api('getZones', {});
    ZONES = r.zones;
  } catch (e) { ZONES = []; toast('Could not load Zone list: ' + e.message, 'error'); }
  initDropdowns();
  resetForm();
  switchTab('new');
}

(function restoreSession() {
  const raw = localStorage.getItem('bwg_session');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s && s.expiresAt && new Date(s.expiresAt).getTime() > Date.now()) { SESSION = s; enterApp(); }
    else localStorage.removeItem('bwg_session');
  } catch (e) {}
})();

/* ================= TABS ================= */
function switchTab(name) {
  ['New','Mine','All','Admin'].forEach(t => {
    document.getElementById('tab' + t).classList.toggle('hidden', t.toLowerCase() !== name);
    const topBtn = document.getElementById('tab' + t + 'Btn');
    const navBtn = document.getElementById('nav' + t + 'Btn');
    if (topBtn) topBtn.classList.toggle('active', t.toLowerCase() === name);
    if (navBtn) navBtn.classList.toggle('active', t.toLowerCase() === name);
  });
  if (name === 'mine') loadEntries('mine', 1);
  if (name === 'all') loadEntries('all', 1);
  if (name === 'admin') loadAdminUsers();
}

/* ================= IMAGE UPLOAD (optional; camera or gallery; single Drive folder) ================= */
function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
        else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.75).split(',')[1]);
      };
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function handleImageSelect(evt) {
  const file = evt.target.files[0];
  const status = document.getElementById('imageUploadStatus');
  const preview = document.getElementById('imagePreview');
  if (!file) return;
  if (!file.type.startsWith('image/')) { status.innerHTML = '<span style="color:var(--danger)">Please select an image file.</span>'; return; }

  imageUploadInProgress = true;
  document.getElementById('f_imageUrl').value = '';
  status.innerHTML = '<span class="spinner dark"></span>Uploading photo...';
  setFormLocked(true);

  try {
    const base64 = await resizeImageFile(file, 1280, 0.75);
    preview.src = 'data:image/jpeg;base64,' + base64;
    preview.classList.remove('hidden');
    const res = await api('uploadImage', { base64, mimeType: 'image/jpeg' });
    document.getElementById('f_imageUrl').value = res.url;
    status.innerHTML = '<span style="color:#0B7A62">Photo uploaded successfully</span>';
  } catch (e) {
    status.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`;
    preview.classList.add('hidden');
  } finally {
    imageUploadInProgress = false;
    setFormLocked(false);
  }
}

function setFormLocked(locked) {
  document.querySelectorAll('#tabNew input, #tabNew textarea, #tabNew select, #tabNew button').forEach(el => { el.disabled = locked; });
  document.querySelectorAll('#zoneDropWrap input, #wardDropWrap input, #categoryDropWrap input').forEach(el => { el.disabled = locked; });
}

/* ================= ENTRY FORM ================= */
function collectFormData() {
  return {
    entryDate: document.getElementById('f_entryDate').value,
    entryTime: document.getElementById('f_entryTime').value,
    zone: zoneDrop.getValue(),
    ward: wardDrop.getValue(),
    bwgName: document.getElementById('f_bwgName').value.trim(),
    category: categoryDrop.getValue(),
    categoryOther: document.getElementById('f_categoryOther').value.trim(),
    contactPerson: document.getElementById('f_contactPerson').value.trim(),
    mobile: document.getElementById('f_mobile').value.trim(),
    unitsCount: document.getElementById('f_unitsCount').value.trim(),
    approxWasteKg: document.getElementById('f_approxWasteKg').value,
    wasteSegregation: getChecked('chkWasteSegregation').join(', '),
    binAvailability: getChecked('chkBinAvailability').join(', '),
    compostingCapacity: document.getElementById('f_compostingCapacity').value,
    processingFacilities: document.getElementById('f_processingFacilities').value.trim(),
    storageArea: getChecked('chkStorageArea').join(', '),
    iecActivities: getChecked('chkIecActivities').join(', '),
    remarks: document.getElementById('f_remarks').value.trim(),
    iecStaffName: document.getElementById('f_iecStaffName').value.trim(),
    imageUrl: document.getElementById('f_imageUrl').value.trim() // optional
  };
}

function validateForm(d) {
  // Everything mandatory except Remarks and the Photo.
  const required = ['entryDate','entryTime','zone','ward','bwgName','category','contactPerson','mobile',
    'unitsCount','approxWasteKg','compostingCapacity','processingFacilities','iecStaffName'];
  for (const f of required) if (!d[f]) return `Please fill in all required fields.`;
  if (d.category === 'Other' && !d.categoryOther) return 'Please specify the "Other" category.';
  if (!d.wasteSegregation) return 'Select at least one Waste Segregation option.';
  if (!d.binAvailability) return 'Select at least one Bin Availability option.';
  if (!d.storageArea) return 'Select at least one Storage Area option.';
  if (!d.iecActivities) return 'Select at least one IEC Activity option.';
  return null;
}

async function submitEntry() {
  const msg = document.getElementById('formMsg');
  const btn = document.getElementById('submitBtn');
  if (imageUploadInProgress) { msg.innerHTML = '<div class="msg error">Please wait for the photo to finish uploading.</div>'; return; }
  const data = collectFormData();
  const err = validateForm(data);
  if (err) { msg.innerHTML = `<div class="msg error">${err}</div>`; return; }
  setFormLocked(true);
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Submitting...';
  try {
    const res = await api('createEntry', data);
    toast('Entry submitted — ID ' + res.entryId, 'success');
    resetForm();
  } catch (e) {
    msg.innerHTML = `<div class="msg error">${e.message}</div>`;
  } finally {
    setFormLocked(false);
    btn.disabled = false; btn.innerHTML = 'Submit Entry';
  }
}

function resetForm() {
  document.getElementById('formMsg').innerHTML = '';
  document.querySelectorAll('#tabNew input[type=text], #tabNew input[type=number], #tabNew input[type=tel], #tabNew textarea').forEach(i => i.value = '');
  document.querySelectorAll('#tabNew input[type=checkbox]').forEach(i => i.checked = false);
  if (zoneDrop) { zoneDrop.clear(); wardDrop.clear(); categoryDrop.clear(); }
  document.getElementById('categoryOtherWrap').style.display = 'none';
  document.getElementById('f_imageFile').value = '';
  document.getElementById('f_imageUrl').value = '';
  document.getElementById('imageUploadStatus').innerHTML = '';
  document.getElementById('imagePreview').classList.add('hidden');
  const now = new Date();
  document.getElementById('f_entryDate').value = now.toISOString().slice(0,10);
  document.getElementById('f_entryTime').value = now.toTimeString().slice(0,5);
  document.getElementById('f_iecStaffName').value = SESSION ? (SESSION.fullName || SESSION.username) : '';
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Submit Entry';
  btn.onclick = submitEntry;
}

/* ================= ENTRIES LIST / PAGINATION ================= */
const pageState = { mine: 1, all: 1 };

function skeletonRows(n) {
  return Array.from({ length: n }).map(() => `<div class="skeleton skeleton-card"></div>`).join('');
}

async function loadEntries(scope, page) {
  pageState[scope] = page;
  const listEl = document.getElementById(scope === 'mine' ? 'mineList' : 'allList');
  listEl.innerHTML = skeletonRows(3);
  try {
    const res = await api('listEntries', { page, pageSize: 10, mineOnly: scope === 'mine' });
    listEl.innerHTML = res.entries.length
      ? res.entries.map(e => renderEntryCard(e, scope)).join('')
      : '<div class="hint" style="padding:20px 0;text-align:center;">No entries found.</div>';
    renderPager(scope, res);
  } catch (e) {
    listEl.innerHTML = `<div class="msg error">${e.message}</div>`;
  }
}

function renderEntryCard(e, scope) {
  const canEdit = scope === 'mine';
  return `
    <div class="entry-card" id="card-${e.entryId}">
      <div class="row1"><span>${e.entryId}</span><span class="badge">${e.category === 'Other' ? e.categoryOther : e.category}</span></div>
      <div class="title">${e.bwgName}</div>
      <div class="meta">
        Zone: <b>${e.zone}</b> &nbsp;·&nbsp; Ward: <b>${e.ward}</b> &nbsp;·&nbsp; ${e.entryDate} ${e.entryTime}<br>
        Contact: ${e.contactPerson} (${e.mobile}) &nbsp;·&nbsp; Waste: ${e.approxWasteKg} kg/day<br>
        Submitted by ${e.createdBy} on ${e.createdAt}
      </div>
      ${canEdit ? `<div class="actions">
        <button class="secondary small" onclick="editEntry('${e.entryId}')">Edit</button>
        <button class="danger small" onclick="deleteEntry('${e.entryId}')">Delete</button>
      </div>` : ''}
    </div>`;
}

function renderPager(scope, res) {
  const el = document.getElementById(scope === 'mine' ? 'minePager' : 'allPager');
  const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize));
  el.innerHTML = `
    <button class="secondary small" ${res.page <= 1 ? 'disabled' : ''} onclick="loadEntries('${scope}', ${res.page - 1})">Prev</button>
    <span>Page ${res.page} of ${totalPages} &nbsp;(${res.total} entries)</span>
    <button class="secondary small" ${!res.hasMore ? 'disabled' : ''} onclick="loadEntries('${scope}', ${res.page + 1})">Next 10</button>`;
}

async function deleteEntry(entryId) {
  if (!confirm('Delete this entry? Only an administrator can restore it afterwards.')) return;
  try {
    await api('deleteEntry', entryId);
    toast('Entry deleted', 'success');
    loadEntries('mine', pageState.mine);
  } catch (e) { toast(e.message, 'error'); }
}

async function editEntry(entryId) {
  try {
    const res = await api('getEntry', { entryId });
    const e = res.entry;
    switchTab('new');
    document.getElementById('f_entryDate').value = e.entryDate;
    document.getElementById('f_entryTime').value = e.entryTime;
    zoneDrop.setValue(e.zone);
    const w = await api('getWards', { zone: e.zone });
    wardDrop.setOptions(w.wards);
    wardDrop.setValue(e.ward);
    document.getElementById('f_bwgName').value = e.bwgName;
    categoryDrop.setValue(e.category);
    document.getElementById('categoryOtherWrap').style.display = (e.category === 'Other') ? 'block' : 'none';
    document.getElementById('f_categoryOther').value = e.categoryOther || '';
    document.getElementById('f_contactPerson').value = e.contactPerson;
    document.getElementById('f_mobile').value = e.mobile;
    document.getElementById('f_unitsCount').value = e.unitsCount;
    document.getElementById('f_approxWasteKg').value = e.approxWasteKg;
    setChecked('chkWasteSegregation', e.wasteSegregation);
    setChecked('chkBinAvailability', e.binAvailability);
    document.getElementById('f_compostingCapacity').value = e.compostingCapacity;
    document.getElementById('f_processingFacilities').value = e.processingFacilities;
    setChecked('chkStorageArea', e.storageArea);
    setChecked('chkIecActivities', e.iecActivities);
    document.getElementById('f_remarks').value = e.remarks;
    document.getElementById('f_iecStaffName').value = e.iecStaffName;
    document.getElementById('f_imageUrl').value = e.imageUrl || '';
    if (e.imageUrl) {
      const preview = document.getElementById('imagePreview');
      preview.src = e.imageUrl;
      preview.classList.remove('hidden');
      document.getElementById('imageUploadStatus').innerHTML = '<span class="hint">Existing photo shown above — choose a new file to replace it.</span>';
    }

    const btn = document.getElementById('submitBtn');
    btn.textContent = 'Save Changes';
    btn.onclick = async () => {
      if (imageUploadInProgress) { document.getElementById('formMsg').innerHTML = '<div class="msg error">Please wait for the photo to finish uploading.</div>'; return; }
      const data = collectFormData();
      const err = validateForm(data);
      if (err) { document.getElementById('formMsg').innerHTML = `<div class="msg error">${err}</div>`; return; }
      setFormLocked(true);
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Saving...';
      try {
        await api('updateEntry', { entryId, data });
        toast('Entry updated', 'success');
        resetForm();
        switchTab('mine');
      } catch (e2) {
        document.getElementById('formMsg').innerHTML = `<div class="msg error">${e2.message}</div>`;
      } finally {
        setFormLocked(false);
        btn.disabled = false;
      }
    };
  } catch (e) { toast(e.message, 'error'); }
}

/* ================= ADMIN ================= */
async function loadAdminUsers() {
  const el = document.getElementById('adminUsersTable');
  el.innerHTML = skeletonRows(3);
  try {
    const res = await api('adminListUsers', {});
    el.innerHTML = `<table class="admin-table"><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Status</th><th>Actions</th></tr>` +
      res.users.map(u => `<tr>
        <td>${u.username}</td><td>${u.fullName}</td><td>${u.role}</td><td>${u.status}</td>
        <td>
          <button class="secondary small" onclick="adminToggleStatus('${u.userId}','${u.status}')">${u.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
          <button class="secondary small" onclick="adminResetPw('${u.userId}')">Reset Password</button>
        </td>
      </tr>`).join('') + `</table>`;
  } catch (e) { el.innerHTML = `<div class="msg error">${e.message}</div>`; }
}

async function adminCreateUser() {
  const msg = document.getElementById('adminMsg');
  const payload = {
    username: document.getElementById('a_username').value.trim(),
    password: document.getElementById('a_password').value,
    fullName: document.getElementById('a_fullName').value.trim(),
    role: document.getElementById('a_role').value
  };
  try {
    await api('adminCreateUser', payload);
    msg.innerHTML = '<div class="msg success">User created.</div>';
    document.getElementById('a_username').value = '';
    document.getElementById('a_password').value = '';
    document.getElementById('a_fullName').value = '';
    loadAdminUsers();
  } catch (e) { msg.innerHTML = `<div class="msg error">${e.message}</div>`; }
}

async function adminToggleStatus(userId, currentStatus) {
  try {
    await api('adminUpdateUser', { userId, status: currentStatus === 'Active' ? 'Inactive' : 'Active' });
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminResetPw(userId) {
  const pw = prompt('Enter new password (min 6 characters):');
  if (!pw) return;
  try {
    await api('adminResetPassword', { userId, newPassword: pw });
    toast('Password reset successfully', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function adminAddZoneWard() {
  const zone = document.getElementById('a_zone').value.trim();
  const ward = document.getElementById('a_ward').value.trim();
  if (!zone || !ward) return toast('Enter both Zone and Ward.', 'error');
  try {
    await api('adminAddZoneWard', { zone, ward });
    document.getElementById('a_zone').value = '';
    document.getElementById('a_ward').value = '';
    ZONES = (await api('getZones', {})).zones;
    zoneDrop.setOptions(ZONES);
    toast('Zone/Ward added', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

/* Run connection diagnostics as soon as the script loads, on the login screen. */
checkConnection();
