/* ============================================================
   BWG INSPECTION APP
   Frontend JavaScript
   HTML + CSS + Google Apps Script + Google Sheets + Drive
   ============================================================ */

const API_URL =
  'https://script.google.com/macros/s/AKfycbxZTm9noKJKLEkG9ZjFPf0M7PKULuzoBkCdfs6r_P0ffWjIFZYAToD59Y4eYHt5qg6SIg/exec';

const SESSION_STORAGE_KEY = 'bwg_browser_session';
const ZONE_STORAGE_KEY = 'bwg_selected_zone';
const WARD_STORAGE_KEY = 'bwg_selected_ward';

const PAGE_SIZE = 10;

/* ------------------------------------------------------------
   APPLICATION STATE
------------------------------------------------------------ */

let SESSION = null;
let MASTER_DATA = null;

let currentLogsPage = 1;
let currentLogEntries = [];

const DROPDOWNS = {};


/* ------------------------------------------------------------
   BASIC DOM HELPERS
------------------------------------------------------------ */

function $(id) {
  return document.getElementById(id);
}

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}


/* ------------------------------------------------------------
   TOAST
------------------------------------------------------------ */

function showToast(message, type = 'info', duration = 3000) {
  const host = $('toastHost');

  if (!host) {
    alert(message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  toast.innerHTML = `
    <div class="toast-icon">
      ${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}
    </div>
    <div class="toast-message"></div>
  `;

  toast.querySelector('.toast-message').textContent = message;

  host.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');

    setTimeout(() => {
      toast.remove();
    }, 250);
  }, duration);
}


/* ------------------------------------------------------------
   LOADING OVERLAY
------------------------------------------------------------ */

let loadingOverlay = null;

function showLoading(message = 'Please wait...') {
  if (!loadingOverlay) {
    loadingOverlay = document.createElement('div');

    loadingOverlay.className = 'loading-overlay';

    loadingOverlay.innerHTML = `
      <div class="loading-card">
        <div class="spinner"></div>
        <div class="loading-text"></div>
      </div>
    `;

    document.body.appendChild(loadingOverlay);
  }

  loadingOverlay.querySelector('.loading-text').textContent = message;

  loadingOverlay.classList.add('show');
}

function hideLoading() {
  if (loadingOverlay) {
    loadingOverlay.classList.remove('show');
  }
}


/* ------------------------------------------------------------
   API
------------------------------------------------------------ */

async function apiRaw(action, payload = {}) {

  const body = {
    action,
    payload
  };

  let response;

  try {

    response = await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      mode: 'cors',
      credentials: 'omit',

      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },

      body: JSON.stringify(body)
    });

  } catch (error) {

    throw new Error(
      'Unable to connect to the server. Please check your internet connection.'
    );
  }

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {

    console.error('Invalid server response:', text);

    throw new Error(
      'The server returned an invalid response.'
    );
  }

  if (!data.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}


/* ------------------------------------------------------------
   CONNECTION STATUS
------------------------------------------------------------ */

async function checkConnection() {

  const dot = $('connectionDot');
  const label = $('connectionLabel');

  if (!dot || !label) return;

  try {

    label.textContent = 'Checking connection...';

    dot.classList.remove('online');
    dot.classList.remove('offline');

    const response = await fetch(API_URL, {
      method: 'GET',
      redirect: 'follow',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Connection failed');
    }

    dot.classList.add('online');
    label.textContent = 'Connected';

  } catch (error) {

    dot.classList.add('offline');
    label.textContent = 'Connection unavailable';

    console.warn('Connection check failed:', error);
  }
}


/* ------------------------------------------------------------
   SESSION
------------------------------------------------------------ */

function getStoredSession() {

  try {

    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (!raw) return null;

    const session = JSON.parse(raw);

    if (!session || !session.username) {
      return null;
    }

    if (
      session.expiresAt &&
      Date.now() >= Number(session.expiresAt)
    ) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return session;

  } catch (error) {

    sessionStorage.removeItem(SESSION_STORAGE_KEY);

    return null;
  }
}


function saveSession(session) {

  SESSION = session;

  sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(session)
  );
}


function clearSession() {

  SESSION = null;

  sessionStorage.removeItem(
    SESSION_STORAGE_KEY
  );
}


function getSession() {

  if (SESSION) {

    if (
      SESSION.expiresAt &&
      Date.now() >= Number(SESSION.expiresAt)
    ) {
      clearSession();
      return null;
    }

    return SESSION;
  }

  const stored = getStoredSession();

  if (stored) {
    SESSION = stored;
  }

  return SESSION;
}


/* ------------------------------------------------------------
   LOGIN
------------------------------------------------------------ */

async function doLogin(event) {

  if (event) {
    event.preventDefault();
  }

  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;

  const msg = $('loginMsg');
  const button = $('loginBtn');
  const buttonText = $('loginBtnText');

  if (!username || !password) {

    if (msg) {
      msg.textContent = 'Please enter username and password.';
      msg.className = 'form-message error';
    }

    return;
  }

  button.disabled = true;

  if (buttonText) {
    buttonText.textContent = 'Signing in...';
  }

  if (msg) {
    msg.textContent = '';
    msg.className = 'form-message';
  }

  try {

    const result = await apiRaw('login', {
      username,
      password
    });

    if (!result.session) {
      throw new Error('Invalid login response.');
    }

    saveSession(result.session);

    await enterApp();

  } catch (error) {

    console.error(error);

    if (msg) {
      msg.textContent = error.message;
      msg.className = 'form-message error';
    }

    showToast(
      error.message || 'Login failed.',
      'error'
    );

  } finally {

    button.disabled = false;

    if (buttonText) {
      buttonText.textContent = 'Sign In';
    }
  }
}


/* ------------------------------------------------------------
   ENTER APPLICATION
------------------------------------------------------------ */

async function enterApp() {

  const session = getSession();

  if (!session) {
    showLogin();
    return;
  }

  $('loginScreen').classList.add('hidden');
  $('appScreen').classList.remove('hidden');

  if ($('userFullName')) {
    $('userFullName').textContent =
      session.fullName || session.username;
  }

  if ($('userRoleBadge')) {
    $('userRoleBadge').textContent =
      session.role || 'User';
  }

  setupAdminVisibility();

  showLoading('Loading inspection data...');

  try {

    await loadMasterData();

    initializeForm();

    switchPage('new');

  } catch (error) {

    console.error(error);

    showToast(
      error.message || 'Unable to load application data.',
      'error'
    );

    clearSession();
    showLogin();

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   SHOW LOGIN
------------------------------------------------------------ */

function showLogin() {

  $('appScreen').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');

  if ($('loginUsername')) {
    $('loginUsername').focus();
  }
}


/* ------------------------------------------------------------
   LOGOUT
------------------------------------------------------------ */

function doLogout() {

  clearSession();

  MASTER_DATA = null;

  clearFormCompletely();

  $('appScreen').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');

  $('loginUsername').value = '';
  $('loginPassword').value = '';

  if ($('loginMsg')) {
    $('loginMsg').textContent = '';
    $('loginMsg').className = 'form-message';
  }

  showToast(
    'You have been logged out.',
    'success'
  );
}


/* ------------------------------------------------------------
   MASTER DATA
------------------------------------------------------------ */

async function loadMasterData() {

  const session = getSession();

  if (!session) {
    throw new Error('Your session has expired.');
  }

  const result = await apiRaw('getMasterData', {
    session
  });

  MASTER_DATA = result.data;

  if (!MASTER_DATA) {
    throw new Error('Master data was not returned.');
  }

  renderMasterControls();
}


/* ------------------------------------------------------------
   MASTER CONTROLS
------------------------------------------------------------ */

function renderMasterControls() {

  if (!MASTER_DATA) return;

  const categories =
    MASTER_DATA.categories || [];

  const zones =
    MASTER_DATA.zones || [];

  const savedZone =
    localStorage.getItem(ZONE_STORAGE_KEY) || '';

  const savedWard =
    localStorage.getItem(WARD_STORAGE_KEY) || '';

  mountSearchDropdown(
    'zoneDropWrap',
    zones,
    savedZone,
    value => {

      localStorage.setItem(
        ZONE_STORAGE_KEY,
        value
      );

      const wards =
        getWardsForZone(value);

      updateDropdownOptions(
        'wardDropWrap',
        wards,
        savedWard
      );

      if (
        savedWard &&
        wards.includes(savedWard)
      ) {

        setDropdownValue(
          'wardDropWrap',
          savedWard,
          false
        );

      } else {

        localStorage.removeItem(
          WARD_STORAGE_KEY
        );

        setDropdownValue(
          'wardDropWrap',
          '',
          false
        );
      }

    },
    'Select Zone'
  );


  const initialWards =
    getWardsForZone(savedZone);

  const validSavedWard =
    initialWards.includes(savedWard)
      ? savedWard
      : '';

  mountSearchDropdown(
    'wardDropWrap',
    initialWards,
    validSavedWard,
    value => {

      if (value) {

        localStorage.setItem(
          WARD_STORAGE_KEY,
          value
        );

      } else {

        localStorage.removeItem(
          WARD_STORAGE_KEY
        );
      }
    },
    'Select Ward'
  );


  mountSearchDropdown(
    'categoryDropWrap',
    categories,
    '',
    value => {

      toggleCategoryOther(value);

    },
    'Select Category'
  );


  renderCheckboxGroup(
    'chkWasteSegregation',
    MASTER_DATA.wasteSegregation || []
  );

  renderCheckboxGroup(
    'chkBinAvailability',
    MASTER_DATA.binAvailability || []
  );

  renderCheckboxGroup(
    'chkStorageArea',
    MASTER_DATA.storageArea || []
  );

  renderCheckboxGroup(
    'chkIecActivities',
    MASTER_DATA.iecActivities || []
  );
}


function getWardsForZone(zone) {

  if (!MASTER_DATA) return [];

  const map =
    MASTER_DATA.wardsByZone || {};

  return map[zone] || [];
}


/* ------------------------------------------------------------
   SEARCHABLE DROPDOWNS
------------------------------------------------------------ */

function mountSearchDropdown(
  containerId,
  options,
  selectedValue,
  onChange,
  placeholder
) {

  const container = $(containerId);

  if (!container) return;

  container.innerHTML = '';

  container.classList.add(
    'search-dropdown'
  );

  const input = document.createElement('input');

  input.type = 'text';
  input.className =
    'search-dropdown-input';

  input.placeholder = placeholder || 'Select';
  input.autocomplete = 'off';

  const menu = document.createElement('div');

  menu.className =
    'search-dropdown-menu';

  container.appendChild(input);
  container.appendChild(menu);

  DROPDOWNS[containerId] = {
    container,
    input,
    menu,
    options: [...options],
    value: selectedValue || '',
    onChange,
    placeholder
  };

  renderDropdownMenu(containerId);

  if (selectedValue) {
    input.value = selectedValue;
  }


  input.addEventListener(
    'focus',
    () => {

      closeAllDropdowns(containerId);

      renderDropdownMenu(containerId);

      menu.classList.add('open');

      input.select();
    }
  );


  input.addEventListener(
    'input',
    () => {

      renderDropdownMenu(
        containerId,
        input.value
      );

      menu.classList.add('open');
    }
  );


  input.addEventListener(
    'keydown',
    event => {

      if (event.key === 'Escape') {

        menu.classList.remove('open');

        input.value =
          DROPDOWNS[containerId].value || '';

      }

      if (event.key === 'Enter') {

        const first =
          menu.querySelector(
            '.search-dropdown-option'
          );

        if (first) {
          event.preventDefault();
          first.click();
        }
      }
    }
  );
}


function renderDropdownMenu(
  containerId,
  filterText = ''
) {

  const dropdown =
    DROPDOWNS[containerId];

  if (!dropdown) return;

  const filter =
    String(filterText || '')
      .toLowerCase()
      .trim();

  const options =
    dropdown.options.filter(option =>

      String(option)
        .toLowerCase()
        .includes(filter)

    );

  dropdown.menu.innerHTML = '';

  if (!options.length) {

    const empty =
      document.createElement('div');

    empty.className =
      'search-dropdown-empty';

    empty.textContent =
      'No options found';

    dropdown.menu.appendChild(empty);

    return;
  }


  options.forEach(option => {

    const item =
      document.createElement('div');

    item.className =
      'search-dropdown-option';

    if (option === dropdown.value) {
      item.classList.add('selected');
    }

    item.textContent = option;

    item.addEventListener(
      'mousedown',
      event => {
        event.preventDefault();
      }
    );

    item.addEventListener(
      'click',
      () => {

        dropdown.value = option;

        dropdown.input.value = option;

        dropdown.menu.classList.remove(
          'open'
        );

        if (typeof dropdown.onChange === 'function') {
          dropdown.onChange(option);
        }
      }
    );

    dropdown.menu.appendChild(item);
  });
}


function updateDropdownOptions(
  containerId,
  options,
  selectedValue = ''
) {

  const dropdown =
    DROPDOWNS[containerId];

  if (!dropdown) return;

  dropdown.options =
    [...(options || [])];

  dropdown.value =
    selectedValue || '';

  dropdown.input.value =
    selectedValue || '';

  renderDropdownMenu(
    containerId
  );
}


function setDropdownValue(
  containerId,
  value,
  trigger = true
) {

  const dropdown =
    DROPDOWNS[containerId];

  if (!dropdown) return;

  dropdown.value =
    value || '';

  dropdown.input.value =
    value || '';

  renderDropdownMenu(containerId);

  if (
    trigger &&
    typeof dropdown.onChange === 'function'
  ) {
    dropdown.onChange(
      value || ''
    );
  }
}


function getDropdownValue(containerId) {

  const dropdown =
    DROPDOWNS[containerId];

  return dropdown
    ? dropdown.value || ''
    : '';
}


function closeAllDropdowns(exceptId = '') {

  Object.keys(DROPDOWNS).forEach(id => {

    if (id === exceptId) return;

    const dropdown =
      DROPDOWNS[id];

    if (dropdown && dropdown.menu) {
      dropdown.menu.classList.remove('open');
    }
  });
}


document.addEventListener(
  'click',
  event => {

    Object.keys(DROPDOWNS).forEach(id => {

      const dropdown =
        DROPDOWNS[id];

      if (!dropdown) return;

      if (!dropdown.container.contains(event.target)) {

        dropdown.menu.classList.remove(
          'open'
        );

        dropdown.input.value =
          dropdown.value || '';
      }
    });
  }
);


/* ------------------------------------------------------------
   CHECKBOX GROUPS
------------------------------------------------------------ */

function renderCheckboxGroup(
  containerId,
  options
) {

  const container = $(containerId);

  if (!container) return;

  container.innerHTML = '';

  options.forEach((option, index) => {

    const label =
      document.createElement('label');

    label.className =
      'checkbox-item';

    const checkbox =
      document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.value = option;
    checkbox.name = containerId;

    const text =
      document.createElement('span');

    text.textContent = option;

    label.appendChild(checkbox);
    label.appendChild(text);

    checkbox.addEventListener(
      'change',
      () => {

        label.classList.toggle(
          'checked',
          checkbox.checked
        );
      }
    );

    container.appendChild(label);
  });
}


function getCheckedValues(containerId) {

  const container = $(containerId);

  if (!container) return [];

  return qsa(
    'input[type="checkbox"]:checked',
    container
  ).map(
    checkbox => checkbox.value
  );
}


function clearCheckboxGroup(containerId) {

  const container = $(containerId);

  if (!container) return;

  qsa(
    'input[type="checkbox"]',
    container
  ).forEach(checkbox => {

    checkbox.checked = false;

    checkbox.closest(
      '.checkbox-item'
    )?.classList.remove('checked');
  });
}


/* ------------------------------------------------------------
   FORM INITIALIZATION
------------------------------------------------------------ */

function initializeForm() {

  setDefaultDateTime();

  if ($('f_iecStaffName')) {

    const session =
      getSession();

    $('f_iecStaffName').value =
      session?.fullName ||
      session?.username ||
      '';
  }

  const savedZone =
    localStorage.getItem(
      ZONE_STORAGE_KEY
    ) || '';

  const savedWard =
    localStorage.getItem(
      WARD_STORAGE_KEY
    ) || '';

  if (DROPDOWNS.zoneDropWrap) {

    setDropdownValue(
      'zoneDropWrap',
      savedZone,
      false
    );

  }

  if (DROPDOWNS.wardDropWrap) {

    const wards =
      getWardsForZone(savedZone);

    updateDropdownOptions(
      'wardDropWrap',
      wards,
      wards.includes(savedWard)
        ? savedWard
        : ''
    );
  }

  toggleCategoryOther(
    getDropdownValue(
      'categoryDropWrap'
    )
  );

  setupFormListeners();
}


function setupFormListeners() {

  const form =
    $('inspectionForm');

  if (form) {

    form.addEventListener(
      'submit',
      submitEntry
    );
  }

  const category =
    $('categoryDropWrap');

  if (category) {
    // Dropdown handles this.
  }


  const mobile =
    $('f_mobile');

  if (mobile) {

    mobile.addEventListener(
      'input',
      () => {

        mobile.value =
          mobile.value
            .replace(/\D/g, '')
            .slice(0, 10);
      }
    );
  }


  const imageInput =
    $('f_imageFile');

  if (imageInput) {

    imageInput.addEventListener(
      'change',
      handleImageSelect
    );
  }


  const passwordToggle =
    $('passwordToggle');

  if (passwordToggle) {

    passwordToggle.addEventListener(
      'click',
      toggleLoginPassword
    );
  }
}


/* ------------------------------------------------------------
   DATE / TIME
------------------------------------------------------------ */

function getLocalDateString() {

  const now = new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(2, '0');

  const day =
    String(
      now.getDate()
    ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}


function getLocalTimeString() {

  const now = new Date();

  const hours =
    String(
      now.getHours()
    ).padStart(2, '0');

  const minutes =
    String(
      now.getMinutes()
    ).padStart(2, '0');

  return `${hours}:${minutes}`;
}


function setDefaultDateTime() {

  if ($('f_entryDate')) {

    $('f_entryDate').value =
      getLocalDateString();
  }

  if ($('f_entryTime')) {

    $('f_entryTime').value =
      getLocalTimeString();
  }
}


/* ------------------------------------------------------------
   CATEGORY OTHER
------------------------------------------------------------ */

function toggleCategoryOther(value) {

  const wrapper =
    $('categoryOtherWrap');

  if (!wrapper) return;

  const isOther =
    String(value || '').toLowerCase() === 'other';

  wrapper.classList.toggle(
    'hidden',
    !isOther
  );

  if (!isOther && $('f_categoryOther')) {
    $('f_categoryOther').value = '';
  }
}


/* ------------------------------------------------------------
   FORM RESET
------------------------------------------------------------ */

function clearFormCompletely() {

  const form =
    $('inspectionForm');

  if (form) {
    form.reset();
  }

  clearCheckboxGroup(
    'chkWasteSegregation'
  );

  clearCheckboxGroup(
    'chkBinAvailability'
  );

  clearCheckboxGroup(
    'chkStorageArea'
  );

  clearCheckboxGroup(
    'chkIecActivities'
  );

  if (DROPDOWNS.categoryDropWrap) {

    setDropdownValue(
      'categoryDropWrap',
      '',
      false
    );
  }

  clearImageSelection();
}


function resetForm() {

  const savedZone =
    localStorage.getItem(
      ZONE_STORAGE_KEY
    ) || '';

  const savedWard =
    localStorage.getItem(
      WARD_STORAGE_KEY
    ) || '';

  const form =
    $('inspectionForm');

  if (form) {
    form.reset();
  }

  clearCheckboxGroup(
    'chkWasteSegregation'
  );

  clearCheckboxGroup(
    'chkBinAvailability'
  );

  clearCheckboxGroup(
    'chkStorageArea'
  );

  clearCheckboxGroup(
    'chkIecActivities'
  );


  if (DROPDOWNS.zoneDropWrap) {

    setDropdownValue(
      'zoneDropWrap',
      savedZone,
      false
    );
  }


  const wards =
    getWardsForZone(savedZone);

  if (DROPDOWNS.wardDropWrap) {

    updateDropdownOptions(
      'wardDropWrap',
      wards,
      wards.includes(savedWard)
        ? savedWard
        : ''
    );
  }


  if (DROPDOWNS.categoryDropWrap) {

    setDropdownValue(
      'categoryDropWrap',
      '',
      false
    );
  }


  toggleCategoryOther('');

  setDefaultDateTime();

  const session =
    getSession();

  if ($('f_iecStaffName')) {

    $('f_iecStaffName').value =
      session?.fullName ||
      session?.username ||
      '';
  }

  clearImageSelection();

  if ($('formMsg')) {

    $('formMsg').textContent = '';
    $('formMsg').className =
      'form-message';
  }
}


/* ------------------------------------------------------------
   COLLECT FORM
------------------------------------------------------------ */

function collectForm() {

  return {

    entryDate:
      $('f_entryDate')?.value || '',

    entryTime:
      $('f_entryTime')?.value || '',

    zone:
      getDropdownValue(
        'zoneDropWrap'
      ),

    ward:
      getDropdownValue(
        'wardDropWrap'
      ),

    bwgName:
      $('f_bwgName')?.value.trim() || '',

    category:
      getDropdownValue(
        'categoryDropWrap'
      ),

    categoryOther:
      $('f_categoryOther')?.value.trim() || '',

    contactPerson:
      $('f_contactPerson')?.value.trim() || '',

    mobile:
      $('f_mobile')?.value.trim() || '',

    unitsCount:
      $('f_unitsCount')?.value || '',

    approxWasteKg:
      $('f_approxWasteKg')?.value || '',

    wasteSegregation:
      getCheckedValues(
        'chkWasteSegregation'
      ).join(', '),

    binAvailability:
      getCheckedValues(
        'chkBinAvailability'
      ).join(', '),

    compostingCapacity:
      $('f_compostingCapacity')?.value.trim() || '',

    processingFacilities:
      $('f_processingFacilities')?.value.trim() || '',

    storageArea:
      getCheckedValues(
        'chkStorageArea'
      ).join(', '),

    iecActivities:
      getCheckedValues(
        'chkIecActivities'
      ).join(', '),

    remarks:
      $('f_remarks')?.value.trim() || '',

    iecStaffName:
      $('f_iecStaffName')?.value.trim() || '',

    imageUrl:
      $('f_imageUrl')?.value || ''
  };
}


/* ------------------------------------------------------------
   CLIENT VALIDATION
------------------------------------------------------------ */

function validateFormClient(data) {

  const required = [
    ['Entry Date', data.entryDate],
    ['Entry Time', data.entryTime],
    ['Zone', data.zone],
    ['Ward', data.ward],
    ['BWG Name', data.bwgName],
    ['Category', data.category],
    ['Contact Person', data.contactPerson],
    ['Mobile', data.mobile],
    ['Units Count', data.unitsCount],
    ['Approx. Waste Kg', data.approxWasteKg],
    ['Waste Segregation', data.wasteSegregation],
    ['Bin Availability', data.binAvailability],
    ['Composting Capacity', data.compostingCapacity],
    ['Processing Facilities', data.processingFacilities],
    ['Storage Area', data.storageArea],
    ['IEC Activities', data.iecActivities]
  ];

  for (const [label, value] of required) {

    if (
      value === undefined ||
      value === null ||
      String(value).trim() === ''
    ) {

      return `${label} is required.`;
    }
  }


  if (
    data.category === 'Other' &&
    !data.categoryOther
  ) {

    return 'Please specify the category.';
  }


  if (!/^\d{10}$/.test(data.mobile)) {

    return 'Mobile number must contain exactly 10 digits.';
  }


  const units =
    Number(data.unitsCount);

  if (
    !Number.isFinite(units) ||
    units < 0
  ) {

    return 'Units Count must be zero or greater.';
  }


  const waste =
    Number(data.approxWasteKg);

  if (
    !Number.isFinite(waste) ||
    waste < 0
  ) {

    return 'Approx. Waste Kg must be zero or greater.';
  }


  return '';
}


/* ------------------------------------------------------------
   SUBMIT ENTRY
------------------------------------------------------------ */

async function submitEntry(event) {

  if (event) {
    event.preventDefault();
  }

  const session =
    getSession();

  if (!session) {

    showToast(
      'Your session has expired. Please login again.',
      'error'
    );

    showLogin();

    return;
  }


  const data =
    collectForm();

  const validationError =
    validateFormClient(data);

  if (validationError) {

    showToast(
      validationError,
      'error'
    );

    if ($('formMsg')) {

      $('formMsg').textContent =
        validationError;

      $('formMsg').className =
        'form-message error';
    }

    return;
  }


  const submitButton =
    $('submitBtn');

  const submitText =
    $('submitBtnText');


  if (submitButton) {
    submitButton.disabled = true;
  }

  if (submitText) {
    submitText.textContent =
      'Submitting...';
  }


  try {

    /*
      If image is selected but not uploaded,
      upload it before creating the entry.
    */

    const imageFile =
      $('f_imageFile')?.files?.[0];

    if (
      imageFile &&
      !data.imageUrl
    ) {

      showImageUploadStatus(
        'Uploading photo...'
      );

      const uploadedUrl =
        await uploadSelectedImage(
          imageFile
        );

      data.imageUrl =
        uploadedUrl;
    }


    showLoading(
      'Saving inspection...'
    );


    const result =
      await apiRaw(
        'createEntry',
        {
          session,
          entry: data
        }
      );


    const entryId =
      result.entryId ||
      result.data?.entryId ||
      '';


    if ($('formMsg')) {

      $('formMsg').textContent =
        entryId
          ? `Inspection submitted successfully. Entry ID: ${entryId}`
          : 'Inspection submitted successfully.';

      $('formMsg').className =
        'form-message success';
    }


    showToast(
      entryId
        ? `Inspection saved: ${entryId}`
        : 'Inspection saved successfully.',
      'success',
      5000
    );


    resetForm();


  } catch (error) {

    console.error(error);

    if ($('formMsg')) {

      $('formMsg').textContent =
        error.message ||
        'Unable to submit inspection.';

      $('formMsg').className =
        'form-message error';
    }

    showToast(
      error.message ||
      'Unable to submit inspection.',
      'error',
      5000
    );

  } finally {

    hideLoading();

    if (submitButton) {
      submitButton.disabled = false;
    }

    if (submitText) {
      submitText.textContent =
        'Submit Inspection';
    }
  }
}


/* ------------------------------------------------------------
   IMAGE HANDLING
------------------------------------------------------------ */

async function handleImageSelect(event) {

  const file =
    event.target.files?.[0];

  if (!file) {
    clearImageSelection();
    return;
  }


  if (!file.type.startsWith('image/')) {

    showToast(
      'Please select an image file.',
      'error'
    );

    clearImageSelection();

    return;
  }


  if (file.size > 15 * 1024 * 1024) {

    showToast(
      'Image is too large. Please select an image below 15 MB.',
      'error'
    );

    clearImageSelection();

    return;
  }


  try {

    showImagePreview(file);

    showImageUploadStatus(
      'Preparing photo...'
    );

    const uploadedUrl =
      await uploadSelectedImage(file);

    $('f_imageUrl').value =
      uploadedUrl;

    showImageUploadStatus(
      'Photo uploaded successfully.',
      'success'
    );

  } catch (error) {

    console.error(error);

    showImageUploadStatus(
      error.message ||
      'Photo upload failed.',
      'error'
    );

    showToast(
      error.message ||
      'Photo upload failed.',
      'error'
    );
  }
}


async function uploadSelectedImage(file) {

  const session =
    getSession();

  if (!session) {
    throw new Error(
      'Your session has expired.'
    );
  }


  const compressed =
    await compressImage(
      file,
      1280,
      0.72
    );


  const extension =
    compressed.type === 'image/png'
      ? 'png'
      : 'jpg';


  const safeName =
    file.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 60);


  const fileName =
    `${safeName}_${Date.now()}.${extension}`;


  const result =
    await apiRaw(
      'uploadImage',
      {
        session,

        fileName,

        mimeType:
          compressed.type,

        base64:
          compressed.base64
      }
    );


  const url =
    result.url ||
    result.data?.url;


  if (!url) {
    throw new Error(
      'Photo upload completed but no URL was returned.'
    );
  }


  return url;
}


/* ------------------------------------------------------------
   IMAGE COMPRESSION
------------------------------------------------------------ */

function compressImage(
  file,
  maxDimension = 1280,
  quality = 0.72
) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();

      reader.onerror = () => {
        reject(
          new Error(
            'Unable to read image.'
          )
        );
      };


      reader.onload = () => {

        const image =
          new Image();

        image.onerror = () => {
          reject(
            new Error(
              'Unable to process image.'
            )
          );
        };


        image.onload = () => {

          let width =
            image.naturalWidth;

          let height =
            image.naturalHeight;


          if (
            width > maxDimension ||
            height > maxDimension
          ) {

            const scale =
              Math.min(
                maxDimension / width,
                maxDimension / height
              );

            width =
              Math.round(width * scale);

            height =
              Math.round(height * scale);
          }


          const canvas =
            document.createElement('canvas');

          canvas.width =
            width;

          canvas.height =
            height;


          const context =
            canvas.getContext('2d');

          context.drawImage(
            image,
            0,
            0,
            width,
            height
          );


          canvas.toBlob(
            blob => {

              if (!blob) {

                reject(
                  new Error(
                    'Unable to compress image.'
                  )
                );

                return;
              }


              const blobReader =
                new FileReader();

              blobReader.onloadend =
                () => {

                  const dataUrl =
                    blobReader.result;

                  const base64 =
                    String(dataUrl)
                      .split(',')[1];


                  resolve({
                    base64,
                    type: blob.type || 'image/jpeg'
                  });
                };


              blobReader.onerror =
                () => {

                  reject(
                    new Error(
                      'Unable to prepare image.'
                    )
                  );
                };


              blobReader.readAsDataURL(
                blob
              );

            },

            'image/jpeg',
            quality
          );
        };


        image.src =
          reader.result;
      };


      reader.readAsDataURL(file);
    }
  );
}


/* ------------------------------------------------------------
   IMAGE PREVIEW
------------------------------------------------------------ */

function showImagePreview(file) {

  const wrap =
    $('imagePreviewWrap');

  const image =
    $('imagePreview');

  if (!wrap || !image) return;


  const reader =
    new FileReader();


  reader.onload =
    event => {

      image.src =
        event.target.result;

      wrap.classList.remove(
        'hidden'
      );
    };


  reader.readAsDataURL(file);
}


function clearImageSelection() {

  const input =
    $('f_imageFile');

  const previewWrap =
    $('imagePreviewWrap');

  const preview =
    $('imagePreview');

  const url =
    $('f_imageUrl');

  if (input) {
    input.value = '';
  }

  if (preview) {
    preview.src = '';
  }

  if (previewWrap) {
    previewWrap.classList.add(
      'hidden'
    );
  }

  if (url) {
    url.value = '';
  }

  showImageUploadStatus('');
}


function removeSelectedImage() {
  clearImageSelection();
}


function showImageUploadStatus(
  message,
  type = ''
) {

  const element =
    $('imageUploadStatus');

  if (!element) return;

  element.textContent =
    message || '';

  element.className =
    'image-upload-status';

  if (type) {
    element.classList.add(type);
  }
}


/* ------------------------------------------------------------
   PAGE NAVIGATION
------------------------------------------------------------ */

function switchPage(page) {

  const newPage =
    $('pageNew');

  const logsPage =
    $('pageLogs');

  const adminPage =
    $('pageAdmin');


  if (newPage) {
    newPage.classList.add('hidden');
  }

  if (logsPage) {
    logsPage.classList.add('hidden');
  }

  if (adminPage) {
    adminPage.classList.add('hidden');
  }


  qsa(
    '.nav-btn'
  ).forEach(btn => {

    btn.classList.remove(
      'active'
    );
  });


  let title = '';
  let subtitle = '';


  if (page === 'new') {

    newPage?.classList.remove(
      'hidden'
    );

    title =
      'New Inspection';

    subtitle =
      'Record a Bulk Waste Generator inspection';

    $('navNewBtn')?.classList.add(
      'active'
    );
  }


  else if (page === 'logs') {

    logsPage?.classList.remove(
      'hidden'
    );

    title =
      'Inspection Logs';

    subtitle =
      'Common inspection records submitted by all users';

    $('navLogsBtn')?.classList.add(
      'active'
    );

    loadInspectionLogs(
      currentLogsPage
    );
  }


  else if (page === 'admin') {

    const session =
      getSession();

    if (
      !session ||
      session.role !== 'Admin'
    ) {

      showToast(
        'Admin access required.',
        'error'
      );

      return;
    }

    adminPage?.classList.remove(
      'hidden'
    );

    title =
      'Admin';

    subtitle =
      'Manage users and Zone/Ward master data';

    $('navAdminBtn')?.classList.add(
      'active'
    );

    loadAdminUsers();
  }


  if ($('pageTitle')) {
    $('pageTitle').textContent =
      title;
  }

  if ($('pageSubtitle')) {
    $('pageSubtitle').textContent =
      subtitle;
  }


  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}


/* ------------------------------------------------------------
   INSPECTION LOGS
------------------------------------------------------------ */

async function loadInspectionLogs(
  page = 1
) {

  const session =
    getSession();

  if (!session) {
    showLogin();
    return;
  }


  currentLogsPage =
    Math.max(
      1,
      Number(page) || 1
    );


  const list =
    $('allList');

  if (list) {

    list.innerHTML = `
      <div class="empty-state">
        <div class="spinner small"></div>
        <p>Loading inspection logs...</p>
      </div>
    `;
  }


  try {

    const result =
      await apiRaw(
        'listEntries',
        {
          session,

          page:
            currentLogsPage,

          pageSize:
            PAGE_SIZE
        }
      );


    const data =
      result.data || result;


    const entries =
      data.entries || [];


    const total =
      Number(data.total || 0);


    currentLogEntries =
      entries;


    renderLogsSummary(
      total,
      entries
    );


    renderInspectionLogs(
      entries
    );


    renderLogsPagination(
      total,
      currentLogsPage
    );


  } catch (error) {

    console.error(error);

    if (list) {

      list.innerHTML = `
        <div class="empty-state error-state">
          <p>${escapeHtml(
            error.message ||
            'Unable to load inspection logs.'
          )}</p>
        </div>
      `;
    }

    showToast(
      error.message ||
      'Unable to load inspection logs.',
      'error'
    );
  }
}


/* ------------------------------------------------------------
   LOG SUMMARY
------------------------------------------------------------ */

function renderLogsSummary(
  total,
  entries
) {

  const element =
    $('logsSummary');

  if (!element) return;


  const staffSet =
    new Set();


  entries.forEach(entry => {

    const staff =
      entry.createdByName ||
      entry.iecStaffName ||
      entry.createdBy ||
      'Unknown';

    staffSet.add(staff);
  });


  element.innerHTML = `
    <div class="summary-item">
      <div class="summary-value">
        ${Number(total).toLocaleString()}
      </div>
      <div class="summary-label">
        Total Inspections
      </div>
    </div>

    <div class="summary-item">
      <div class="summary-value">
        ${staffSet.size}
      </div>
      <div class="summary-label">
        Staff on This Page
      </div>
    </div>

    <div class="summary-item">
      <div class="summary-value">
        ${entries.length}
      </div>
      <div class="summary-label">
        Records Shown
      </div>
    </div>
  `;
}


/* ------------------------------------------------------------
   RENDER LOGS
------------------------------------------------------------ */

function renderInspectionLogs(
  entries
) {

  const container =
    $('allList');

  if (!container) return;


  if (!entries.length) {

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No inspections found</h3>
        <p>No inspection records have been submitted yet.</p>
      </div>
    `;

    return;
  }


  const groups =
    {};


  entries.forEach(entry => {

    const staff =
      entry.createdByName ||
      entry.iecStaffName ||
      entry.createdBy ||
      'Unknown Staff';


    if (!groups[staff]) {
      groups[staff] = [];
    }

    groups[staff].push(entry);
  });


  container.innerHTML = '';


  Object.keys(groups)
    .sort(
      (a, b) =>
        a.localeCompare(
          b
        )
    )
    .forEach(staff => {

      const group =
        document.createElement('section');

      group.className =
        'log-group';


      const heading =
        document.createElement('div');

      heading.className =
        'log-group-heading';

      heading.innerHTML = `
        <div>
          <div class="log-group-title">
            ${escapeHtml(staff)}
          </div>

          <div class="log-group-subtitle">
            ${groups[staff].length}
            inspection${groups[staff].length === 1 ? '' : 's'}
          </div>
        </div>
      `;


      group.appendChild(
        heading
      );


      const cards =
        document.createElement('div');

      cards.className =
        'log-cards';


      groups[staff].forEach(entry => {

        cards.appendChild(
          createLogCard(entry)
        );
      });


      group.appendChild(cards);

      container.appendChild(group);
    });
}


/* ------------------------------------------------------------
   LOG CARD
------------------------------------------------------------ */

function createLogCard(entry) {

  const card =
    document.createElement('article');

  card.className =
    'log-card';


  const entryId =
    entry.entryId ||
    entry.EntryID ||
    '';


  const bwgName =
    entry.bwgName ||
    entry.BWGName ||
    '-';


  const date =
    entry.entryDate ||
    entry.EntryDate ||
    '-';


  const time =
    entry.entryTime ||
    entry.EntryTime ||
    '';


  const zone =
    entry.zone ||
    entry.Zone ||
    '-';


  const ward =
    entry.ward ||
    entry.Ward ||
    '-';


  const category =
    entry.category ||
    entry.Category ||
    '-';


  const contact =
    entry.contactPerson ||
    entry.ContactPerson ||
    '-';


  const mobile =
    entry.mobile ||
    entry.Mobile ||
    '-';


  const units =
    entry.unitsCount ??
    entry.UnitsCount ??
    '-';


  const waste =
    entry.approxWasteKg ??
    entry.ApproxWasteKg ??
    '-';


  const segregation =
    entry.wasteSegregation ||
    entry.WasteSegregation ||
    '-';


  const bins =
    entry.binAvailability ||
    entry.BinAvailability ||
    '-';


  const compost =
    entry.compostingCapacity ||
    entry.CompostingCapacity ||
    '-';


  const processing =
    entry.processingFacilities ||
    entry.ProcessingFacilities ||
    '-';


  const storage =
    entry.storageArea ||
    entry.StorageArea ||
    '-';


  const iec =
    entry.iecActivities ||
    entry.IECActivities ||
    '-';


  const remarks =
    entry.remarks ||
    entry.Remarks ||
    '';


  const imageUrl =
    entry.imageUrl ||
    entry.ImageUrl ||
    '';


  card.innerHTML = `
    <div class="log-card-header">

      <div class="log-card-title-area">

        <div class="log-card-title">
          ${escapeHtml(bwgName)}
        </div>

        <div class="log-card-id">
          ${escapeHtml(entryId)}
        </div>

      </div>

      <div class="log-card-date">
        ${escapeHtml(date)}
        ${time ? ` · ${escapeHtml(time)}` : ''}
      </div>

    </div>


    <div class="log-card-meta">

      <span class="meta-chip">
        ${escapeHtml(zone)}
      </span>

      <span class="meta-chip">
        ${escapeHtml(ward)}
      </span>

      <span class="meta-chip">
        ${escapeHtml(category)}
      </span>

    </div>


    <div class="log-card-grid">

      ${logField(
        'Contact Person',
        contact
      )}

      ${logField(
        'Mobile',
        mobile
      )}

      ${logField(
        'Units',
        units
      )}

      ${logField(
        'Approx. Waste',
        waste !== '-' ? `${waste} Kg` : '-'
      )}

      ${logField(
        'Waste Segregation',
        segregation
      )}

      ${logField(
        'Bin Availability',
        bins
      )}

      ${logField(
        'Composting Capacity',
        compost
      )}

      ${logField(
        'Processing Facilities',
        processing
      )}

      ${logField(
        'Storage Area',
        storage
      )}

      ${logField(
        'IEC Activities',
        iec
      )}

    </div>


    ${
      remarks
        ? `
          <div class="log-card-remarks">
            <strong>Remarks</strong>
            <div>${escapeHtml(remarks)}</div>
          </div>
        `
        : ''
    }


    ${
      imageUrl
        ? `
          <div class="log-card-footer">
            <a
              class="view-photo-btn"
              href="${escapeAttribute(imageUrl)}"
              target="_blank"
              rel="noopener"
            >
              View Photo
            </a>
          </div>
        `
        : ''
    }
  `;


  return card;
}


function logField(
  label,
  value
) {

  return `
    <div class="log-field">

      <div class="log-field-label">
        ${escapeHtml(label)}
      </div>

      <div class="log-field-value">
        ${escapeHtml(
          String(value ?? '-')
        )}
      </div>

    </div>
  `;
}


/* ------------------------------------------------------------
   LOG PAGINATION
------------------------------------------------------------ */

function renderLogsPagination(
  total,
  page
) {

  const container =
    $('allPager');

  if (!container) return;


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        Number(total) /
        PAGE_SIZE
      )
    );


  if (totalPages <= 1) {

    container.innerHTML = '';

    return;
  }


  let html = '';


  html += `
    <button
      class="pager-btn"
      ${page <= 1 ? 'disabled' : ''}
      onclick="loadInspectionLogs(${page - 1})"
    >
      Previous
    </button>
  `;


  const start =
    Math.max(
      1,
      page - 2
    );


  const end =
    Math.min(
      totalPages,
      page + 2
    );


  for (
    let i = start;
    i <= end;
    i++
  ) {

    html += `
      <button
        class="pager-btn ${i === page ? 'active' : ''}"
        onclick="loadInspectionLogs(${i})"
      >
        ${i}
      </button>
    `;
  }


  html += `
    <button
      class="pager-btn"
      ${page >= totalPages ? 'disabled' : ''}
      onclick="loadInspectionLogs(${page + 1})"
    >
      Next
    </button>
  `;


  container.innerHTML =
    html;
}


/* ------------------------------------------------------------
   ADMIN VISIBILITY
------------------------------------------------------------ */

function setupAdminVisibility() {

  const session =
    getSession();

  const isAdmin =
    session?.role === 'Admin';


  const adminButton =
    $('navAdminBtn');

  if (adminButton) {

    adminButton.classList.toggle(
      'hidden',
      !isAdmin
    );
  }
}


/* ------------------------------------------------------------
   ADMIN - USERS
------------------------------------------------------------ */

async function loadAdminUsers() {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  const table =
    $('adminUsersTable');

  if (!table) return;


  table.innerHTML = `
    <div class="empty-state">
      <div class="spinner small"></div>
      <p>Loading users...</p>
    </div>
  `;


  try {

    const result =
      await apiRaw(
        'adminListUsers',
        {
          session
        }
      );


    const users =
      result.users ||
      result.data?.users ||
      [];


    renderAdminUsers(
      users
    );


  } catch (error) {

    console.error(error);

    table.innerHTML = `
      <div class="empty-state error-state">
        ${escapeHtml(
          error.message ||
          'Unable to load users.'
        )}
      </div>
    `;

    showToast(
      error.message ||
      'Unable to load users.',
      'error'
    );
  }
}


/* ------------------------------------------------------------
   RENDER ADMIN USERS
------------------------------------------------------------ */

function renderAdminUsers(users) {

  const container =
    $('adminUsersTable');

  if (!container) return;


  if (!users.length) {

    container.innerHTML = `
      <div class="empty-state">
        <h3>No users found</h3>
      </div>
    `;

    return;
  }


  const table =
    document.createElement('table');

  table.className =
    'admin-table';


  table.innerHTML = `
    <thead>
      <tr>
        <th>Username</th>
        <th>Full Name</th>
        <th>Role</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>

    <tbody></tbody>
  `;


  const tbody =
    table.querySelector('tbody');


  users.forEach(user => {

    const username =
      user.username ||
      user.Username ||
      '';

    const fullName =
      user.fullName ||
      user.FullName ||
      '';

    const role =
      user.role ||
      user.Role ||
      'User';

    const status =
      user.status ||
      user.Status ||
      'Active';


    const row =
      document.createElement('tr');


    const statusClass =
      String(status)
        .toLowerCase() === 'active'
        ? 'status-active'
        : 'status-inactive';


    row.innerHTML = `
      <td>
        <strong>
          ${escapeHtml(username)}
        </strong>
      </td>

      <td>
        ${escapeHtml(fullName)}
      </td>

      <td>
        ${escapeHtml(role)}
      </td>

      <td>
        <span class="status-pill ${statusClass}">
          ${escapeHtml(status)}
        </span>
      </td>

      <td>

        <div class="admin-actions">

          <button
            class="small-btn"
            onclick="adminChangeRole(
              '${escapeJs(username)}',
              '${escapeJs(role)}'
            )"
          >
            Role
          </button>

          <button
            class="small-btn"
            onclick="adminResetPassword(
              '${escapeJs(username)}'
            )"
          >
            Password
          </button>

          <button
            class="small-btn"
            onclick="adminToggleStatus(
              '${escapeJs(username)}',
              '${escapeJs(status)}'
            )"
          >
            ${String(status).toLowerCase() === 'active'
              ? 'Deactivate'
              : 'Activate'}
          </button>

        </div>

      </td>
    `;


    tbody.appendChild(row);
  });


  container.innerHTML = '';

  container.appendChild(table);
}


/* ------------------------------------------------------------
   ADMIN - CREATE USER
------------------------------------------------------------ */

async function adminCreateUser() {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  const username =
    $('a_username')?.value.trim() || '';

  const fullName =
    $('a_fullName')?.value.trim() || '';

  const password =
    $('a_password')?.value || '';

  const role =
    $('a_role')?.value || 'User';


  if (
    !username ||
    !fullName ||
    !password
  ) {

    showAdminMessage(
      'Please enter username, full name and password.',
      'error'
    );

    return;
  }


  try {

    showLoading(
      'Creating user...'
    );


    await apiRaw(
      'adminCreateUser',
      {
        session,

        username,

        fullName,

        password,

        role
      }
    );


    $('a_username').value = '';
    $('a_fullName').value = '';
    $('a_password').value = '';

    showAdminMessage(
      'User created successfully.',
      'success'
    );


    showToast(
      'User created successfully.',
      'success'
    );


    await loadAdminUsers();


  } catch (error) {

    console.error(error);

    showAdminMessage(
      error.message ||
      'Unable to create user.',
      'error'
    );

    showToast(
      error.message ||
      'Unable to create user.',
      'error'
    );

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   ADMIN - CHANGE ROLE
------------------------------------------------------------ */

async function adminChangeRole(
  username,
  currentRole
) {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  const newRole =
    prompt(
      `Enter role for ${username}:\n\nAdmin or User`,
      currentRole
    );


  if (newRole === null) {
    return;
  }


  const role =
    newRole.trim();


  if (
    role !== 'Admin' &&
    role !== 'User'
  ) {

    showToast(
      'Role must be Admin or User.',
      'error'
    );

    return;
  }


  try {

    showLoading(
      'Updating user role...'
    );


    await apiRaw(
      'adminUpdateUser',
      {
        session,

        username,

        role
      }
    );


    showToast(
      'User role updated.',
      'success'
    );


    await loadAdminUsers();


  } catch (error) {

    showToast(
      error.message ||
      'Unable to update role.',
      'error'
    );

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   ADMIN - TOGGLE STATUS
------------------------------------------------------------ */

async function adminToggleStatus(
  username,
  currentStatus
) {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  if (
    username === session.username &&
    String(currentStatus).toLowerCase() === 'active'
  ) {

    showToast(
      'You cannot deactivate your own account.',
      'error'
    );

    return;
  }


  const isActive =
    String(currentStatus)
      .toLowerCase() === 'active';


  const newStatus =
    isActive
      ? 'Inactive'
      : 'Active';


  const confirmed =
    confirm(
      `${isActive ? 'Deactivate' : 'Activate'} user "${username}"?`
    );


  if (!confirmed) return;


  try {

    showLoading(
      'Updating user status...'
    );


    await apiRaw(
      'adminUpdateUser',
      {
        session,

        username,

        status:
          newStatus
      }
    );


    showToast(
      `User ${newStatus.toLowerCase()}.`,
      'success'
    );


    await loadAdminUsers();


  } catch (error) {

    showToast(
      error.message ||
      'Unable to update user status.',
      'error'
    );

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   ADMIN - RESET PASSWORD
------------------------------------------------------------ */

async function adminResetPassword(
  username
) {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  const password =
    prompt(
      `Enter new password for ${username}:`
    );


  if (password === null) {
    return;
  }


  if (
    password.trim().length < 4
  ) {

    showToast(
      'Password must contain at least 4 characters.',
      'error'
    );

    return;
  }


  try {

    showLoading(
      'Resetting password...'
    );


    await apiRaw(
      'adminResetPassword',
      {
        session,

        username,

        password:
          password.trim()
      }
    );


    showToast(
      'Password reset successfully.',
      'success'
    );


  } catch (error) {

    showToast(
      error.message ||
      'Unable to reset password.',
      'error'
    );

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   ADMIN - ADD ZONE / WARD
------------------------------------------------------------ */

async function adminAddZoneWard() {

  const session =
    getSession();

  if (
    !session ||
    session.role !== 'Admin'
  ) {
    return;
  }


  const zone =
    $('a_zone')?.value.trim() || '';

  const ward =
    $('a_ward')?.value.trim() || '';


  if (!zone || !ward) {

    showAdminMessage(
      'Please enter both Zone and Ward.',
      'error'
    );

    return;
  }


  try {

    showLoading(
      'Adding Zone/Ward...'
    );


    await apiRaw(
      'adminAddZoneWard',
      {
        session,

        zone,

        ward
      }
    );


    $('a_zone').value = '';
    $('a_ward').value = '';


    showAdminMessage(
      'Zone/Ward added successfully.',
      'success'
    );


    showToast(
      'Zone/Ward added successfully.',
      'success'
    );


    /*
      Refresh local master data so the
      new Zone/Ward becomes available
      immediately.
    */

    await loadMasterData();


  } catch (error) {

    console.error(error);

    showAdminMessage(
      error.message ||
      'Unable to add Zone/Ward.',
      'error'
    );

    showToast(
      error.message ||
      'Unable to add Zone/Ward.',
      'error'
    );

  } finally {

    hideLoading();
  }
}


/* ------------------------------------------------------------
   ADMIN MESSAGE
------------------------------------------------------------ */

function showAdminMessage(
  message,
  type = ''
) {

  const element =
    $('adminMsg');

  if (!element) return;

  element.textContent =
    message || '';

  element.className =
    'form-message';

  if (type) {
    element.classList.add(type);
  }
}


/* ------------------------------------------------------------
   PASSWORD TOGGLE
------------------------------------------------------------ */

function toggleLoginPassword() {

  const input =
    $('loginPassword');

  if (!input) return;


  input.type =
    input.type === 'password'
      ? 'text'
      : 'password';
}


/* ------------------------------------------------------------
   HTML ESCAPING
------------------------------------------------------------ */

function escapeHtml(value) {

  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function escapeAttribute(value) {

  return escapeHtml(value);
}


function escapeJs(value) {

  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}


/* ------------------------------------------------------------
   GLOBAL ERROR HANDLING
------------------------------------------------------------ */

window.addEventListener(
  'error',
  event => {

    console.error(
      'Application error:',
      event.error || event.message
    );
  }
);


window.addEventListener(
  'unhandledrejection',
  event => {

    console.error(
      'Unhandled promise rejection:',
      event.reason
    );
  }
);


/* ------------------------------------------------------------
   DOM READY
------------------------------------------------------------ */

document.addEventListener(
  'DOMContentLoaded',
  async () => {

    /*
      Login form
    */

    const loginForm =
      $('loginForm');

    if (loginForm) {

      loginForm.addEventListener(
        'submit',
        doLogin
      );
    }


    /*
      Password toggle
    */

    const passwordToggle =
      $('passwordToggle');

    if (passwordToggle) {

      passwordToggle.addEventListener(
        'click',
        toggleLoginPassword
      );
    }


    /*
      Navigation
    */

    $('navNewBtn')?.addEventListener(
      'click',
      () => switchPage('new')
    );

    $('navLogsBtn')?.addEventListener(
      'click',
      () => switchPage('logs')
    );

    $('navAdminBtn')?.addEventListener(
      'click',
      () => switchPage('admin')
    );


    /*
      Logout buttons
    */

    qsa(
      '[data-action="logout"]'
    ).forEach(button => {

      button.addEventListener(
        'click',
        doLogout
      );
    });


    /*
      Admin actions
    */

    $('adminCreateUserBtn')?.addEventListener(
      'click',
      adminCreateUser
    );

    $('adminAddZoneWardBtn')?.addEventListener(
      'click',
      adminAddZoneWard
    );


    /*
      New inspection button
      in bottom navigation
    */

    $('navNewBtn')?.addEventListener(
      'dblclick',
      resetForm
    );


    /*
      Mobile number
    */

    $('f_mobile')?.addEventListener(
      'input',
      event => {

        event.target.value =
          event.target.value
            .replace(/\D/g, '')
            .slice(0, 10);
      }
    );


    /*
      Image
    */

    $('f_imageFile')?.addEventListener(
      'change',
      handleImageSelect
    );


    /*
      Connection check
    */

    checkConnection();


    /*
      Restore browser session
    */

    const storedSession =
      getStoredSession();


    if (storedSession) {

      SESSION =
        storedSession;

      try {

        await enterApp();

      } catch (error) {

        console.error(error);

        clearSession();
        showLogin();
      }

    } else {

      showLogin();
    }
  }
);


/* ------------------------------------------------------------
   SESSION EXPIRY WATCHER
------------------------------------------------------------ */

setInterval(
  () => {

    const session =
      getSession();

    if (!session) {

      if (
        $('appScreen') &&
        !$('appScreen').classList.contains('hidden')
      ) {

        showToast(
          'Your 12-hour session has expired. Please login again.',
          'error',
          5000
        );

        showLogin();
      }
    }

  },
  60 * 1000
);