/* ==========================================================================
   BWG INSPECTION APP — OPTIMIZED FRONTEND
   HTML + CSS + Google Apps Script + Google Sheets + Google Drive

   IMPORTANT:
   1. API_URL must be the Apps Script WEB APP /exec URL.
   2. Apps Script deployment:
        Execute as: Me
        Who has access: Anyone
   3. After changing Code.gs:
        Deploy > Manage deployments > Edit > New version > Deploy
   ========================================================================== */


/* ==========================================================================
   CONFIGURATION
   ========================================================================== */

const API_URL =
  'https://script.google.com/macros/s/AKfycbwjsSu3gm6gxH2898SB27MXXhcPgGzAK2kqtKVJ5te_-IEWj6pqh2w7zxuu0QOQ5SKvvA/exec';

const SESSION_STORAGE_KEY = 'bwg_session';

const API_TIMEOUT = 20000;
const CONNECTION_TIMEOUT = 10000;

const CATEGORY_OPTIONS = [
  'Apartment',
  'Hotel',
  'Restaurant',
  'School',
  'College',
  'Hospital',
  'IT Park',
  'Office',
  'Other'
];

const WASTE_SEGREGATION_OPTIONS = [
  'Wet Waste',
  'Dry Waste',
  'Special Care Waste',
  'Sanitary Waste',
  'In Separate Waste'
];

const BIN_AVAILABILITY_OPTIONS = [
  'Wet Bin',
  'Dry Bin',
  'Sanitary Bin',
  'Special Care Bin',
  'Labels Available / Colour Label',
  'Bins in Good Condition'
];

const STORAGE_AREA_OPTIONS = [
  'Dedicated Area',
  'Covered',
  'Clean & Hygienic',
  'No Odour',
  'No Littering'
];

const IEC_ACTIVITIES_OPTIONS = [
  'Awareness Conducted',
  'Pamphlets Distributed',
  'SWM Rules Explained',
  'Source Segregation Explained'
];


/* ==========================================================================
   GLOBAL STATE
   ========================================================================== */

let SESSION = null;

let ZONES = [];

let WARDS_BY_ZONE = {};

let zoneDrop = null;
let wardDrop = null;
let categoryDrop = null;

let imageUploadInProgress = false;

let isSubmitting = false;

const pageState = {
  mine: 1,
  all: 1
};


/* ==========================================================================
   BASIC HELPERS
   ========================================================================== */

function $(id) {
  return document.getElementById(id);
}


function escapeHtml(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function escapeAttr(value) {
  return escapeHtml(value);
}


function isValidApiUrl() {
  return (
    API_URL &&
    API_URL.indexOf('script.google.com/macros/s/') !== -1 &&
    API_URL.endsWith('/exec')
  );
}


/* ==========================================================================
   TOAST
   ========================================================================== */

function toast(message, type) {
  const host = $('toastHost');

  if (!host) {
    alert(message);
    return;
  }

  const el = document.createElement('div');

  el.className = 'toast' + (type ? ' ' + type : '');

  el.textContent = message;

  host.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add('show');
  });

  setTimeout(() => {
    el.classList.remove('show');

    setTimeout(() => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 300);
  }, 3500);
}


/* ==========================================================================
   API COMMUNICATION
   ========================================================================== */

/*
   IMPORTANT:
   We deliberately use text/plain.

   This keeps the browser request as a "simple request" and avoids
   the OPTIONS/CORS preflight that often causes problems with Apps Script.
*/

async function apiRaw(action, payload, token, timeoutMs) {

  if (!isValidApiUrl()) {
    throw new Error(
      'Invalid Apps Script API URL. Please check API_URL in app.js.'
    );
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs || API_TIMEOUT);

  try {

    const body = JSON.stringify({
      action: action,
      payload: payload || {},
      token: token || ''
    });

    const response = await fetch(API_URL, {
      method: 'POST',

      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },

      body: body,

      signal: controller.signal,

      redirect: 'follow',

      cache: 'no-store'
    });

    clearTimeout(timeout);

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        'Apps Script returned HTTP ' +
        response.status +
        '.'
      );
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch (jsonError) {

      console.error('Invalid API response:', text);

      throw new Error(
        'The Apps Script server returned an invalid response. ' +
        'Please make sure the Web App deployment is set to "Anyone" and ' +
        'that API_URL points to the /exec URL.'
      );
    }

    return data;

  } catch (error) {

    clearTimeout(timeout);

    console.error('API error:', {
      action: action,
      error: error
    });

    if (error.name === 'AbortError') {

      throw new Error(
        'The server took too long to respond. ' +
        'Please check your internet connection and try again.'
      );
    }

    if (
      error.message &&
      error.message.indexOf('Failed to fetch') !== -1
    ) {

      throw new Error(
        'Cannot reach the Google Apps Script server. ' +
        'Please verify that the Web App is deployed as "Anyone", ' +
        'that this is the /exec URL, and that the latest deployment is active.'
      );
    }

    throw error;
  }
}


/*
   Authenticated API wrapper.
*/

async function api(action, payload) {

  const token = SESSION ? SESSION.token : '';

  const data = await apiRaw(
    action,
    payload || {},
    token,
    API_TIMEOUT
  );

  if (data && data.error) {

    const errorText = String(data.error);

    if (
      errorText.indexOf('SESSION_EXPIRED') === 0
    ) {

      toast(
        'Your session has expired. Please log in again.',
        'error'
      );

      doLogout(true);

      throw new Error(
        'Your session has expired. Please log in again.'
      );
    }

    throw new Error(errorText);
  }

  return data;
}


/* ==========================================================================
   CONNECTION CHECK
   ========================================================================== */

async function checkConnection() {

  const dot = $('connDot');
  const label = $('connLabel');

  if (!dot || !label) return;

  if (!isValidApiUrl()) {

    dot.className = 'conn-dot bad';

    label.textContent =
      'Invalid API URL — check app.js';

    return;
  }

  dot.className = 'conn-dot';
  label.textContent = 'Checking connection...';

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, CONNECTION_TIMEOUT);

  try {

    /*
       GET is handled by doGet() in Apps Script.
    */

    const response = await fetch(API_URL, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {

      throw new Error(
        'HTTP ' + response.status
      );
    }

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (e) {

      throw new Error(
        'Invalid JSON response from Apps Script.'
      );
    }

    if (data && data.ok === true) {

      dot.className = 'conn-dot ok';

      label.textContent =
        'Connected to Google Apps Script';

      return true;
    }

    throw new Error(
      'Unexpected Apps Script response.'
    );

  } catch (error) {

    clearTimeout(timer);

    console.error('Connection check failed:', error);

    dot.className = 'conn-dot bad';

    if (error.name === 'AbortError') {

      label.textContent =
        'Server response timed out';

    } else {

      label.textContent =
        'Cannot reach Apps Script — verify Web App deployment';
    }

    return false;
  }
}


/* ==========================================================================
   SEARCHABLE DROPDOWN
   ========================================================================== */

function makeSearchDropdown(
  containerId,
  options,
  onSelect,
  placeholder
) {

  const wrap = $(containerId);

  if (!wrap) {
    console.error(
      'Dropdown container not found:',
      containerId
    );

    return null;
  }

  wrap.innerHTML = `
    <input
      type="text"
      class="sdrop-input"
      placeholder="${escapeAttr(
        placeholder || 'Type to search...'
      )}"
      autocomplete="off"
      spellcheck="false"
    >
    <div class="sdrop-list"></div>
  `;

  const input = wrap.querySelector('.sdrop-input');

  const list = wrap.querySelector('.sdrop-list');

  let currentOptions = Array.isArray(options)
    ? options.slice()
    : [];


  function render(filterText) {

    const filter = String(
      filterText || ''
    ).trim().toLowerCase();

    const matches = currentOptions.filter(
      option =>
        String(option)
          .toLowerCase()
          .includes(filter)
    );

    if (!matches.length) {

      list.innerHTML =
        '<div class="empty">No matches</div>';

    } else {

      list.innerHTML = matches
        .map(option => {

          const safe = escapeHtml(option);

          return `
            <div
              class="sdrop-option"
              data-val="${escapeAttr(option)}"
            >${safe}</div>
          `;
        })
        .join('');
    }

    list.style.display = 'block';
  }


  input.addEventListener(
    'focus',
    function () {
      render(input.value);
    }
  );


  input.addEventListener(
    'input',
    function () {

      /*
         If the user manually changes the zone,
         reset the ward.
      */

      if (
        containerId === 'zoneDropWrap' &&
        wardDrop
      ) {

        wardDrop.clear();

        const selectedZone = input.value.trim();

        if (
          !selectedZone ||
          !ZONES.includes(selectedZone)
        ) {

          wardDrop.setOptions([]);
        }
      }

      render(input.value);
    }
  );


  input.addEventListener(
    'blur',
    function () {

      setTimeout(() => {
        list.style.display = 'none';
      }, 180);

    }
  );


  list.addEventListener(
    'mousedown',
    async function (event) {

      const target =
        event.target.closest('[data-val]');

      if (!target) return;

      event.preventDefault();

      const value =
        target.getAttribute('data-val');

      input.value = value;

      list.style.display = 'none';

      if (onSelect) {

        try {
          await onSelect(value);
        } catch (error) {

          console.error(
            'Dropdown selection error:',
            error
          );

          toast(
            error.message ||
            'Could not load selection.',
            'error'
          );
        }
      }
    }
  );


  return {

    setOptions(options) {

      currentOptions =
        Array.isArray(options)
          ? options.slice()
          : [];

    },

    getValue() {

      return input.value.trim();

    },

    setValue(value) {

      input.value =
        value === null ||
        value === undefined
          ? ''
          : String(value);

    },

    clear() {

      input.value = '';

      list.style.display = 'none';

    },

    focus() {

      input.focus();

    }
  };
}


/* ==========================================================================
   ZONE / WARD
   ========================================================================== */

function initDropdowns() {

  /*
     Destroy/rebuild safely.
  */

  zoneDrop = makeSearchDropdown(
    'zoneDropWrap',
    ZONES,
    async function (zone) {

      await loadWardsForZone(zone);

    },
    'Search zone...'
  );


  wardDrop = makeSearchDropdown(
    'wardDropWrap',
    [],
    null,
    'Search ward...'
  );


  categoryDrop = makeSearchDropdown(
    'categoryDropWrap',
    CATEGORY_OPTIONS,
    function (value) {

      const otherWrap =
        $('categoryOtherWrap');

      if (!otherWrap) return;

      otherWrap.style.display =
        value === 'Other'
          ? 'block'
          : 'none';

      if (value !== 'Other') {

        $('f_categoryOther').value = '';

      }

    },
    'Search category...'
  );
}


/*
   Load all zones from Apps Script.
*/

async function loadZones() {

  try {

    const result = await api(
      'getZones',
      {}
    );

    const zones =
      result &&
      Array.isArray(result.zones)
        ? result.zones
        : [];

    ZONES = [...new Set(
      zones
        .map(z => String(z).trim())
        .filter(Boolean)
    )].sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          { numeric: true }
        )
    );

    if (!zoneDrop) {

      initDropdowns();

    } else {

      zoneDrop.setOptions(ZONES);

    }

    return ZONES;

  } catch (error) {

    console.error(
      'Zone loading failed:',
      error
    );

    ZONES = [];

    if (zoneDrop) {
      zoneDrop.setOptions([]);
    }

    throw error;
  }
}


/*
   Load wards for selected zone.

   Browser cache is used first.
   Apps Script is called only when necessary.
*/

async function loadWardsForZone(zone) {

  const selectedZone =
    String(zone || '').trim();

  if (!selectedZone) {

    wardDrop.clear();

    wardDrop.setOptions([]);

    return [];
  }


  /*
     Browser cache.
  */

  if (
    Object.prototype.hasOwnProperty.call(
      WARDS_BY_ZONE,
      selectedZone
    )
  ) {

    const cached =
      WARDS_BY_ZONE[selectedZone];

    wardDrop.clear();

    wardDrop.setOptions(cached);

    return cached;
  }


  /*
     Show temporary loading option.
  */

  wardDrop.clear();

  wardDrop.setOptions([
    'Loading wards...'
  ]);

  try {

    const result = await api(
      'getWards',
      {
        zone: selectedZone
      }
    );

    const wards =
      result &&
      Array.isArray(result.wards)
        ? result.wards
        : [];

    const cleanWards =
      [...new Set(
        wards
          .map(w => String(w).trim())
          .filter(Boolean)
      )].sort(
        (a, b) =>
          a.localeCompare(
            b,
            undefined,
            { numeric: true }
          )
      );


    WARDS_BY_ZONE[selectedZone] =
      cleanWards;


    wardDrop.clear();

    wardDrop.setOptions(
      cleanWards
    );


    if (!cleanWards.length) {

      toast(
        'No wards found for ' +
        selectedZone +
        '. Please check the ZoneWard sheet.',
        'error'
      );
    }

    return cleanWards;

  } catch (error) {

    wardDrop.clear();

    wardDrop.setOptions([]);

    throw error;
  }
}


/* ==========================================================================
   CHECKLISTS
   ========================================================================== */

function renderChecklist(
  containerId,
  options
) {

  const container =
    $(containerId);

  if (!container) return;

  container.innerHTML =
    options.map(option => {

      const safe =
        escapeHtml(option);

      return `
        <label class="chk">
          <input
            type="checkbox"
            value="${escapeAttr(option)}"
          >
          ${safe}
        </label>
      `;

    }).join('');
}


function getChecked(containerId) {

  return Array.from(
    document.querySelectorAll(
      '#' +
      containerId +
      ' input[type="checkbox"]:checked'
    )
  ).map(
    input => input.value
  );
}


function setChecked(
  containerId,
  values
) {

  let array = [];

  if (Array.isArray(values)) {

    array = values;

  } else if (typeof values === 'string') {

    array = values
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

  }

  const set =
    new Set(array);


  document.querySelectorAll(
    '#' +
    containerId +
    ' input[type="checkbox"]'
  ).forEach(
    input => {
      input.checked =
        set.has(input.value);
    }
  );
}


/* ==========================================================================
   LOGIN
   ========================================================================== */

async function doLogin() {

  if (isSubmitting) return;

  const username =
    $('loginUsername').value.trim();

  const password =
    $('loginPassword').value;

  const msg =
    $('loginMsg');

  const button =
    $('loginBtn');


  msg.innerHTML = '';


  if (!username || !password) {

    msg.innerHTML =
      '<div class="msg error">' +
      'Enter your username and password.' +
      '</div>';

    return;
  }


  if (!isValidApiUrl()) {

    msg.innerHTML =
      '<div class="msg error">' +
      'API_URL is not configured correctly.' +
      '</div>';

    return;
  }


  button.disabled = true;

  button.innerHTML =
    '<span class="spinner"></span>Signing in...';


  try {

    const data =
      await apiRaw(
        'login',
        {
          username: username,
          password: password
        },
        '',
        15000
      );


    if (!data) {

      throw new Error(
        'Empty response from Apps Script.'
      );
    }


    if (data.error) {

      msg.innerHTML =
        '<div class="msg error">' +
        escapeHtml(data.error) +
        '</div>';

      return;
    }


    if (!data.token) {

      throw new Error(
        'Login succeeded but no session token was returned.'
      );
    }


    SESSION = data;


    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(SESSION)
    );


    await enterApp();


  } catch (error) {

    console.error(
      'Login error:',
      error
    );

    msg.innerHTML =
      '<div class="msg error">' +
      escapeHtml(
        error.message ||
        'Login failed.'
      ) +
      '</div>';

  } finally {

    button.disabled = false;

    button.innerHTML = 'Log In';

  }
}


/* ==========================================================================
   LOGOUT
   ========================================================================== */

function doLogout(silent) {

  const oldSession =
    SESSION;


  SESSION = null;


  localStorage.removeItem(
    SESSION_STORAGE_KEY
  );


  $('appScreen')
    .classList
    .add('hidden');


  $('loginScreen')
    .classList
    .remove('hidden');


  if (
    oldSession &&
    oldSession.token &&
    !silent
  ) {

    apiRaw(
      'logout',
      {},
      oldSession.token,
      8000
    ).catch(
      () => {}
    );

  }


  checkConnection();
}


/* ==========================================================================
   ENTER APP
   ========================================================================== */

async function enterApp() {

  $('loginScreen')
    .classList
    .add('hidden');


  $('appScreen')
    .classList
    .remove('hidden');


  $('userFullName').textContent =
    SESSION.fullName ||
    SESSION.username ||
    'User';


  $('userRoleBadge').textContent =
    SESSION.role ||
    'User';


  const isAdmin =
    String(SESSION.role || '')
      .toLowerCase() === 'admin';


  $('tabAdminBtn')
    .classList
    .toggle(
      'hidden',
      !isAdmin
    );


  $('navAdminBtn')
    .classList
    .toggle(
      'hidden',
      !isAdmin
    );


  /*
     Render all checklists.
  */

  renderChecklist(
    'chkWasteSegregation',
    WASTE_SEGREGATION_OPTIONS
  );

  renderChecklist(
    'chkBinAvailability',
    BIN_AVAILABILITY_OPTIONS
  );

  renderChecklist(
    'chkStorageArea',
    STORAGE_AREA_OPTIONS
  );

  renderChecklist(
    'chkIecActivities',
    IEC_ACTIVITIES_OPTIONS
  );


  /*
     Initialize empty dropdowns immediately.
     This prevents the UI from waiting for API.
  */

  WARDS_BY_ZONE = {};

  ZONES = [];

  initDropdowns();


  /*
     Load Zones.
  */

  try {

    await loadZones();

  } catch (error) {

    toast(
      'Could not load Zone list: ' +
      error.message,
      'error'
    );
  }


  resetForm();

  switchTab('new');
}


/* ==========================================================================
   SESSION RESTORE
   ========================================================================== */

async function restoreSession() {

  const raw =
    localStorage.getItem(
      SESSION_STORAGE_KEY
    );


  if (!raw) {

    checkConnection();

    return;
  }


  try {

    const saved =
      JSON.parse(raw);


    if (
      !saved ||
      !saved.token ||
      !saved.expiresAt
    ) {

      throw new Error(
        'Invalid saved session'
      );
    }


    const expires =
      new Date(
        saved.expiresAt
      ).getTime();


    if (
      !expires ||
      expires <= Date.now()
    ) {

      throw new Error(
        'Session expired'
      );
    }


    /*
       Temporarily use saved session.
    */

    SESSION = saved;


    /*
       Verify with Apps Script.
    */

    const response =
      await api(
        'validateSession',
        {}
      );


    if (
      !response ||
      response.ok !== true
    ) {

      throw new Error(
        'Session is no longer valid.'
      );
    }


    await enterApp();


  } catch (error) {

    console.warn(
      'Session restore failed:',
      error
    );

    SESSION = null;

    localStorage.removeItem(
      SESSION_STORAGE_KEY
    );

    $('loginScreen')
      .classList
      .remove('hidden');

    $('appScreen')
      .classList
      .add('hidden');

    checkConnection();
  }
}


/* ==========================================================================
   TABS
   ========================================================================== */

function switchTab(name) {

  const tabs = [
    'new',
    'mine',
    'all',
    'admin'
  ];


  tabs.forEach(tab => {

    const tabElement =
      $('tab' +
        tab.charAt(0).toUpperCase() +
        tab.slice(1)
      );

    const topButton =
      $('tab' +
        tab.charAt(0).toUpperCase() +
        tab.slice(1) +
        'Btn'
      );

    const navButton =
      $('nav' +
        tab.charAt(0).toUpperCase() +
        tab.slice(1) +
        'Btn'
      );


    if (tabElement) {

      tabElement.classList.toggle(
        'hidden',
        tab !== name
      );
    }


    if (topButton) {

      topButton.classList.toggle(
        'active',
        tab === name
      );
    }


    if (navButton) {

      navButton.classList.toggle(
        'active',
        tab === name
      );
    }
  });


  if (name === 'mine') {

    loadEntries(
      'mine',
      pageState.mine
    );
  }


  if (name === 'all') {

    loadEntries(
      'all',
      pageState.all
    );
  }


  if (name === 'admin') {

    loadAdminUsers();
  }
}


/* ==========================================================================
   IMAGE PROCESSING
   ========================================================================== */

function resizeImageFile(
  file,
  maxDim,
  quality
) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();


      reader.onload = function () {

        const img =
          new Image();


        img.onload = function () {

          let width =
            img.naturalWidth;

          let height =
            img.naturalHeight;


          if (
            width > height &&
            width > maxDim
          ) {

            height =
              height *
              maxDim /
              width;

            width =
              maxDim;

          } else if (
            height > maxDim
          ) {

            width =
              width *
              maxDim /
              height;

            height =
              maxDim;
          }


          const canvas =
            document.createElement(
              'canvas'
            );


          canvas.width =
            Math.round(width);

          canvas.height =
            Math.round(height);


          const context =
            canvas.getContext(
              '2d'
            );


          context.drawImage(
            img,
            0,
            0,
            canvas.width,
            canvas.height
          );


          const result =
            canvas.toDataURL(
              'image/jpeg',
              quality || 0.75
            );


          resolve(
            result.split(',')[1]
          );
        };


        img.onerror =
          function () {

            reject(
              new Error(
                'That file could not be read as an image.'
              )
            );
          };


        img.src =
          reader.result;
      };


      reader.onerror =
        function () {

          reject(
            new Error(
              'Could not read the selected file.'
            )
          );
        };


      reader.readAsDataURL(file);
    }
  );
}


/* ==========================================================================
   IMAGE UPLOAD
   ========================================================================== */

async function handleImageSelect(event) {

  const file =
    event.target.files &&
    event.target.files[0];


  const status =
    $('imageUploadStatus');

  const preview =
    $('imagePreview');


  if (!file) return;


  if (
    !file.type ||
    !file.type.startsWith('image/')
  ) {

    status.innerHTML =
      '<span style="color:var(--danger)">' +
      'Please select an image file.' +
      '</span>';

    return;
  }


  imageUploadInProgress = true;


  $('f_imageUrl').value = '';


  status.innerHTML =
    '<span class="spinner dark"></span>' +
    'Compressing and uploading photo...';


  setFormLocked(true);


  try {

    /*
       Resize before upload to make Apps Script
       + Drive upload significantly faster.
    */

    const base64 =
      await resizeImageFile(
        file,
        1280,
        0.72
      );


    preview.src =
      'data:image/jpeg;base64,' +
      base64;


    preview.classList.remove(
      'hidden'
    );


    const result =
      await api(
        'uploadImage',
        {
          base64: base64,
          mimeType: 'image/jpeg'
        }
      );


    if (
      !result ||
      !result.url
    ) {

      throw new Error(
        'Photo upload did not return a Drive URL.'
      );
    }


    $('f_imageUrl').value =
      result.url;


    status.innerHTML =
      '<span style="color:#0B7A62">' +
      'Photo uploaded successfully' +
      '</span>';


  } catch (error) {

    console.error(
      'Image upload error:',
      error
    );


    status.innerHTML =
      '<span style="color:var(--danger)">' +
      escapeHtml(error.message) +
      '</span>';


    preview.classList.add(
      'hidden'
    );


    $('f_imageUrl').value = '';


  } finally {

    imageUploadInProgress = false;

    setFormLocked(false);
  }
}


/* ==========================================================================
   FORM LOCK
   ========================================================================== */

function setFormLocked(locked) {

  document
    .querySelectorAll(
      '#tabNew input, ' +
      '#tabNew textarea, ' +
      '#tabNew select, ' +
      '#tabNew button'
    )
    .forEach(
      element => {

        /*
           Keep the file input disabled while uploading.
        */

        element.disabled =
          locked;
      }
    );
}


/* ==========================================================================
   FORM DATA
   ========================================================================== */

function collectFormData() {

  return {

    entryDate:
      $('f_entryDate').value,

    entryTime:
      $('f_entryTime').value,

    zone:
      zoneDrop
        ? zoneDrop.getValue()
        : '',

    ward:
      wardDrop
        ? wardDrop.getValue()
        : '',

    bwgName:
      $('f_bwgName').value.trim(),

    category:
      categoryDrop
        ? categoryDrop.getValue()
        : '',

    categoryOther:
      $('f_categoryOther').value.trim(),

    contactPerson:
      $('f_contactPerson').value.trim(),

    mobile:
      $('f_mobile').value.trim(),

    unitsCount:
      $('f_unitsCount').value.trim(),

    approxWasteKg:
      $('f_approxWasteKg').value,

    wasteSegregation:
      getChecked(
        'chkWasteSegregation'
      ).join(', '),

    binAvailability:
      getChecked(
        'chkBinAvailability'
      ).join(', '),

    compostingCapacity:
      $('f_compostingCapacity').value,

    processingFacilities:
      $('f_processingFacilities')
        .value
        .trim(),

    storageArea:
      getChecked(
        'chkStorageArea'
      ).join(', '),

    iecActivities:
      getChecked(
        'chkIecActivities'
      ).join(', '),

    remarks:
      $('f_remarks').value.trim(),

    iecStaffName:
      $('f_iecStaffName')
        .value
        .trim(),

    imageUrl:
      $('f_imageUrl')
        .value
        .trim()
  };
}


/* ==========================================================================
   FORM VALIDATION
   ========================================================================== */

function validateForm(data) {

  const requiredFields = [

    'entryDate',
    'entryTime',
    'zone',
    'ward',
    'bwgName',
    'category',
    'contactPerson',
    'mobile',
    'unitsCount',
    'approxWasteKg',
    'compostingCapacity',
    'processingFacilities',
    'iecStaffName'

  ];


  for (
    const field of requiredFields
  ) {

    if (
      !data[field] ||
      String(data[field]).trim() === ''
    ) {

      return 'Please fill in all required fields.';
    }
  }


  /*
     Make sure selected Zone actually exists.
  */

  if (
    !ZONES.includes(
      data.zone
    )
  ) {

    return 'Please select a valid Zone from the list.';
  }


  /*
     Make sure selected Ward belongs to selected Zone.
  */

  const zoneWards =
    WARDS_BY_ZONE[data.zone];


  if (
    Array.isArray(zoneWards) &&
    zoneWards.length &&
    !zoneWards.includes(data.ward)
  ) {

    return 'Please select a valid Ward for the selected Zone.';
  }


  if (
    data.category === 'Other' &&
    !data.categoryOther
  ) {

    return (
      'Please specify the "Other" category.'
    );
  }


  if (!data.wasteSegregation) {

    return (
      'Select at least one Waste Segregation option.'
    );
  }


  if (!data.binAvailability) {

    return (
      'Select at least one Bin Availability option.'
    );
  }


  if (!data.storageArea) {

    return (
      'Select at least one Storage Area option.'
    );
  }


  if (!data.iecActivities) {

    return (
      'Select at least one IEC Activity option.'
    );
  }


  /*
     Mobile validation.
  */

  const mobile =
    String(data.mobile)
      .replace(/\D/g, '');


  if (
    mobile.length !== 10
  ) {

    return (
      'Please enter a valid 10-digit mobile number.'
    );
  }


  /*
     Waste validation.
  */

  const waste =
    Number(data.approxWasteKg);


  if (
    !isFinite(waste) ||
    waste < 0
  ) {

    return (
      'Approx. Waste Generated must be a valid number.'
    );
  }


  /*
     Composting capacity.
  */

  const capacity =
    Number(
      data.compostingCapacity
    );


  if (
    !isFinite(capacity) ||
    capacity < 0
  ) {

    return (
      'Composting / Capacity must be a valid number.'
    );
  }


  return null;
}


/* ==========================================================================
   SUBMIT ENTRY
   ========================================================================== */

async function submitEntry() {

  if (isSubmitting) return;


  const msg =
    $('formMsg');

  const button =
    $('submitBtn');


  if (imageUploadInProgress) {

    msg.innerHTML =
      '<div class="msg error">' +
      'Please wait for the photo upload to finish.' +
      '</div>';

    return;
  }


  const data =
    collectFormData();


  const error =
    validateForm(data);


  if (error) {

    msg.innerHTML =
      '<div class="msg error">' +
      escapeHtml(error) +
      '</div>';

    return;
  }


  isSubmitting = true;

  setFormLocked(true);

  button.disabled = true;

  button.innerHTML =
    '<span class="spinner"></span>Submitting...';


  try {

    const result =
      await api(
        'createEntry',
        data
      );


    if (
      !result ||
      !result.entryId
    ) {

      throw new Error(
        'Entry was not created. The server did not return an Entry ID.'
      );
    }


    toast(
      'Entry submitted — ID ' +
      result.entryId,
      'success'
    );


    resetForm();


  } catch (error) {

    console.error(
      'Submit error:',
      error
    );


    msg.innerHTML =
      '<div class="msg error">' +
      escapeHtml(error.message) +
      '</div>';


  } finally {

    isSubmitting = false;

    setFormLocked(false);

    button.disabled = false;

    button.innerHTML =
      'Submit Entry';
  }
}


/* ==========================================================================
   RESET FORM
   ========================================================================== */

function resetForm() {

  if (!$('tabNew')) return;


  $('formMsg').innerHTML = '';


  document
    .querySelectorAll(
      '#tabNew input[type="text"], ' +
      '#tabNew input[type="number"], ' +
      '#tabNew input[type="tel"], ' +
      '#tabNew textarea'
    )
    .forEach(
      input => {
        input.value = '';
      }
    );


  document
    .querySelectorAll(
      '#tabNew input[type="checkbox"]'
    )
    .forEach(
      checkbox => {
        checkbox.checked = false;
      }
    );


  if (zoneDrop) {

    zoneDrop.clear();
    zoneDrop.setOptions(ZONES);
  }


  if (wardDrop) {

    wardDrop.clear();
    wardDrop.setOptions([]);
  }


  if (categoryDrop) {

    categoryDrop.clear();
  }


  $('categoryOtherWrap')
    .style
    .display = 'none';


  $('f_imageFile').value = '';

  $('f_imageUrl').value = '';

  $('imageUploadStatus').innerHTML = '';

  $('imagePreview')
    .classList
    .add('hidden');


  /*
     Local date/time.

     Avoid toISOString() because that uses UTC and can
     show the previous date in India.
  */

  const now =
    new Date();


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


  const hours =
    String(
      now.getHours()
    ).padStart(2, '0');


  const minutes =
    String(
      now.getMinutes()
    ).padStart(2, '0');


  $('f_entryDate').value =
    `${year}-${month}-${day}`;


  $('f_entryTime').value =
    `${hours}:${minutes}`;


  $('f_iecStaffName').value =
    SESSION
      ? (
          SESSION.fullName ||
          SESSION.username ||
          ''
        )
      : '';


  const button =
    $('submitBtn');


  button.textContent =
    'Submit Entry';


  button.onclick =
    submitEntry;
}


/* ==========================================================================
   ENTRY LIST
   ========================================================================== */

function skeletonRows(count) {

  return Array.from(
    { length: count }
  )
    .map(
      () =>
        '<div class="skeleton skeleton-card"></div>'
    )
    .join('');
}


async function loadEntries(
  scope,
  page
) {

  pageState[scope] =
    page;


  const listElement =
    $(
      scope === 'mine'
        ? 'mineList'
        : 'allList'
    );


  if (!listElement) return;


  listElement.innerHTML =
    skeletonRows(3);


  try {

    const result =
      await api(
        'listEntries',
        {
          page: page,
          pageSize: 10,
          mineOnly:
            scope === 'mine'
        }
      );


    const entries =
      result &&
      Array.isArray(result.entries)
        ? result.entries
        : [];


    if (!entries.length) {

      listElement.innerHTML =
        '<div class="hint" ' +
        'style="padding:20px 0;text-align:center;">' +
        'No entries found.' +
        '</div>';

    } else {

      listElement.innerHTML =
        entries
          .map(
            entry =>
              renderEntryCard(
                entry,
                scope
              )
          )
          .join('');
    }


    renderPager(
      scope,
      result
    );


  } catch (error) {

    console.error(
      'Entry list error:',
      error
    );


    listElement.innerHTML =
      '<div class="msg error">' +
      escapeHtml(error.message) +
      '</div>';
  }
}


/* ==========================================================================
   ENTRY CARD
   ========================================================================== */

function renderEntryCard(
  entry,
  scope
) {

  const canEdit =
    scope === 'mine';


  const category =
    entry.category === 'Other'
      ? entry.categoryOther
      : entry.category;


  return `
    <div
      class="entry-card"
      id="card-${escapeAttr(entry.entryId)}"
    >

      <div class="row1">

        <span>
          ${escapeHtml(entry.entryId)}
        </span>

        <span class="badge">
          ${escapeHtml(category)}
        </span>

      </div>


      <div class="title">
        ${escapeHtml(entry.bwgName)}
      </div>


      <div class="meta">

        Zone:
        <b>${escapeHtml(entry.zone)}</b>

        &nbsp;·&nbsp;

        Ward:
        <b>${escapeHtml(entry.ward)}</b>

        &nbsp;·&nbsp;

        ${escapeHtml(entry.entryDate)}
        ${escapeHtml(entry.entryTime)}

        <br>

        Contact:
        ${escapeHtml(entry.contactPerson)}
        (${escapeHtml(entry.mobile)})

        &nbsp;·&nbsp;

        Waste:
        ${escapeHtml(entry.approxWasteKg)}
        kg/day

        <br>

        Submitted by
        ${escapeHtml(entry.createdBy)}
        on
        ${escapeHtml(entry.createdAt)}

      </div>


      ${
        canEdit
          ? `
            <div class="actions">

              <button
                class="secondary small"
                onclick="editEntry('${escapeAttr(entry.entryId)}')"
              >
                Edit
              </button>

              <button
                class="danger small"
                onclick="deleteEntry('${escapeAttr(entry.entryId)}')"
              >
                Delete
              </button>

            </div>
          `
          : ''
      }

    </div>
  `;
}


/* ==========================================================================
   PAGINATION
   ========================================================================== */

function renderPager(
  scope,
  result
) {

  const element =
    $(
      scope === 'mine'
        ? 'minePager'
        : 'allPager'
    );


  if (!element) return;


  const total =
    Number(result.total) || 0;


  const pageSize =
    Number(result.pageSize) || 10;


  const currentPage =
    Number(result.page) || 1;


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        total /
        pageSize
      )
    );


  element.innerHTML = `

    <button
      class="secondary small"
      ${
        currentPage <= 1
          ? 'disabled'
          : ''
      }
      onclick="
        loadEntries(
          '${scope}',
          ${currentPage - 1}
        )
      "
    >
      Prev
    </button>


    <span>
      Page
      ${currentPage}
      of
      ${totalPages}

      &nbsp;

      (${total} entries)
    </span>


    <button
      class="secondary small"
      ${
        !result.hasMore
          ? 'disabled'
          : ''
      }
      onclick="
        loadEntries(
          '${scope}',
          ${currentPage + 1}
        )
      "
    >
      Next 10
    </button>

  `;
}


/* ==========================================================================
   DELETE ENTRY
   ========================================================================== */

async function deleteEntry(
  entryId
) {

  if (
    !confirm(
      'Delete this entry?\n\n' +
      'Only an administrator can restore it afterwards.'
    )
  ) {

    return;
  }


  try {

    await api(
      'deleteEntry',
      entryId
    );


    toast(
      'Entry deleted',
      'success'
    );


    await loadEntries(
      'mine',
      pageState.mine
    );


  } catch (error) {

    toast(
      error.message,
      'error'
    );
  }
}


/* ==========================================================================
   EDIT ENTRY
   ========================================================================== */

async function editEntry(
  entryId
) {

  try {

    const result =
      await api(
        'getEntry',
        {
          entryId:
            entryId
        }
      );


    if (
      !result ||
      !result.entry
    ) {

      throw new Error(
        'Entry could not be loaded.'
      );
    }


    const entry =
      result.entry;


    switchTab('new');


    $('f_entryDate').value =
      entry.entryDate || '';


    $('f_entryTime').value =
      entry.entryTime || '';


    /*
       Zone
    */

    zoneDrop.setValue(
      entry.zone || ''
    );


    /*
       Load correct wards.
    */

    const wards =
      await loadWardsForZone(
        entry.zone
      );


    wardDrop.setValue(
      entry.ward || ''
    );


    $('f_bwgName').value =
      entry.bwgName || '';


    categoryDrop.setValue(
      entry.category || ''
    );


    $('categoryOtherWrap')
      .style
      .display =
        entry.category === 'Other'
          ? 'block'
          : 'none';


    $('f_categoryOther').value =
      entry.categoryOther || '';


    $('f_contactPerson').value =
      entry.contactPerson || '';


    $('f_mobile').value =
      entry.mobile || '';


    $('f_unitsCount').value =
      entry.unitsCount || '';


    $('f_approxWasteKg').value =
      entry.approxWasteKg || '';


    setChecked(
      'chkWasteSegregation',
      entry.wasteSegregation
    );


    setChecked(
      'chkBinAvailability',
      entry.binAvailability
    );


    $('f_compostingCapacity').value =
      entry.compostingCapacity || '';


    $('f_processingFacilities').value =
      entry.processingFacilities || '';


    setChecked(
      'chkStorageArea',
      entry.storageArea
    );


    setChecked(
      'chkIecActivities',
      entry.iecActivities
    );


    $('f_remarks').value =
      entry.remarks || '';


    $('f_iecStaffName').value =
      entry.iecStaffName ||
      (
        SESSION
          ? (
              SESSION.fullName ||
              SESSION.username
            )
          : ''
      );


    $('f_imageUrl').value =
      entry.imageUrl || '';


    if (entry.imageUrl) {

      const preview =
        $('imagePreview');


      preview.src =
        entry.imageUrl;


      preview.classList.remove(
        'hidden'
      );


      $('imageUploadStatus').innerHTML =
        '<span class="hint">' +
        'Existing photo shown above — ' +
        'choose a new file to replace it.' +
        '</span>';

    } else {

      $('imagePreview')
        .classList
        .add('hidden');

      $('imageUploadStatus').innerHTML =
        '';
    }


    const button =
      $('submitBtn');


    button.textContent =
      'Save Changes';


    button.onclick =
      async function () {

        if (
          imageUploadInProgress
        ) {

          $('formMsg').innerHTML =
            '<div class="msg error">' +
            'Please wait for the photo upload to finish.' +
            '</div>';

          return;
        }


        if (isSubmitting) return;


        const data =
          collectFormData();


        const validationError =
          validateForm(data);


        if (validationError) {

          $('formMsg').innerHTML =
            '<div class="msg error">' +
            escapeHtml(
              validationError
            ) +
            '</div>';

          return;
        }


        isSubmitting = true;

        setFormLocked(true);

        button.disabled = true;

        button.innerHTML =
          '<span class="spinner"></span>Saving...';


        try {

          await api(
            'updateEntry',
            {
              entryId:
                entryId,

              data:
                data
            }
          );


          toast(
            'Entry updated',
            'success'
          );


          resetForm();


          switchTab(
            'mine'
          );


        } catch (error) {

          $('formMsg').innerHTML =
            '<div class="msg error">' +
            escapeHtml(
              error.message
            ) +
            '</div>';

        } finally {

          isSubmitting = false;

          setFormLocked(false);

          button.disabled = false;

          button.textContent =
            'Save Changes';
        }
      };


  } catch (error) {

    console.error(
      'Edit error:',
      error
    );


    toast(
      error.message,
      'error'
    );
  }
}


/* ==========================================================================
   ADMIN — USERS
   ========================================================================== */

async function loadAdminUsers() {

  const element =
    $('adminUsersTable');


  if (!element) return;


  element.innerHTML =
    skeletonRows(3);


  try {

    const result =
      await api(
        'adminListUsers',
        {}
      );


    const users =
      result &&
      Array.isArray(result.users)
        ? result.users
        : [];


    if (!users.length) {

      element.innerHTML =
        '<div class="hint">' +
        'No users found.' +
        '</div>';

      return;
    }


    element.innerHTML = `

      <table class="admin-table">

        <tr>
          <th>Username</th>
          <th>Full Name</th>
          <th>Role</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>

        ${
          users
            .map(user => {

              const status =
                String(
                  user.status || ''
                );


              return `

                <tr>

                  <td>
                    ${escapeHtml(user.username)}
                  </td>

                  <td>
                    ${escapeHtml(user.fullName)}
                  </td>

                  <td>
                    ${escapeHtml(user.role)}
                  </td>

                  <td>
                    ${escapeHtml(user.status)}
                  </td>

                  <td>

                    <button
                      class="secondary small"
                      onclick="
                        adminToggleStatus(
                          '${escapeAttr(user.userId)}',
                          '${escapeAttr(user.status)}'
                        )
                      "
                    >
                      ${
                        status === 'Active'
                          ? 'Deactivate'
                          : 'Activate'
                      }
                    </button>


                    <button
                      class="secondary small"
                      onclick="
                        adminResetPw(
                          '${escapeAttr(user.userId)}'
                        )
                      "
                    >
                      Reset Password
                    </button>

                  </td>

                </tr>

              `;
            })
            .join('')
        }

      </table>
    `;


  } catch (error) {

    element.innerHTML =
      '<div class="msg error">' +
      escapeHtml(error.message) +
      '</div>';
  }
}


/* ==========================================================================
   ADMIN — CREATE USER
   ========================================================================== */

async function adminCreateUser() {

  const message =
    $('adminMsg');


  const payload = {

    username:
      $('a_username')
        .value
        .trim()
        .toLowerCase(),

    password:
      $('a_password')
        .value,

    fullName:
      $('a_fullName')
        .value
        .trim(),

    role:
      $('a_role')
        .value
  };


  if (
    !payload.username ||
    !payload.password ||
    !payload.fullName
  ) {

    message.innerHTML =
      '<div class="msg error">' +
      'Please fill all required fields.' +
      '</div>';

    return;
  }


  if (
    payload.password.length < 6
  ) {

    message.innerHTML =
      '<div class="msg error">' +
      'Password must be at least 6 characters.' +
      '</div>';

    return;
  }


  try {

    await api(
      'adminCreateUser',
      payload
    );


    message.innerHTML =
      '<div class="msg success">' +
      'User created successfully.' +
      '</div>';


    $('a_username').value = '';

    $('a_password').value = '';

    $('a_fullName').value = '';


    await loadAdminUsers();


  } catch (error) {

    message.innerHTML =
      '<div class="msg error">' +
      escapeHtml(
        error.message
      ) +
      '</div>';
  }
}


/* ==========================================================================
   ADMIN — USER STATUS
   ========================================================================== */

async function adminToggleStatus(
  userId,
  currentStatus
) {

  try {

    const newStatus =
      currentStatus === 'Active'
        ? 'Inactive'
        : 'Active';


    await api(
      'adminUpdateUser',
      {
        userId:
          userId,

        status:
          newStatus
      }
    );


    toast(
      'User status updated.',
      'success'
    );


    await loadAdminUsers();


  } catch (error) {

    toast(
      error.message,
      'error'
    );
  }
}


/* ==========================================================================
   ADMIN — RESET PASSWORD
   ========================================================================== */

async function adminResetPw(
  userId
) {

  const password =
    prompt(
      'Enter new password (minimum 6 characters):'
    );


  if (!password) return;


  if (
    password.length < 6
  ) {

    toast(
      'Password must be at least 6 characters.',
      'error'
    );

    return;
  }


  try {

    await api(
      'adminResetPassword',
      {
        userId:
          userId,

        newPassword:
          password
      }
    );


    toast(
      'Password reset successfully.',
      'success'
    );


  } catch (error) {

    toast(
      error.message,
      'error'
    );
  }
}


/* ==========================================================================
   ADMIN — ADD ZONE / WARD
   ========================================================================== */

async function adminAddZoneWard() {

  const zone =
    $('a_zone')
      .value
      .trim();


  const ward =
    $('a_ward')
      .value
      .trim();


  if (!zone || !ward) {

    toast(
      'Enter both Zone and Ward.',
      'error'
    );

    return;
  }


  try {

    await api(
      'adminAddZoneWard',
      {
        zone:
          zone,

        ward:
          ward
      }
    );


    $('a_zone').value = '';

    $('a_ward').value = '';


    /*
       Clear browser cache because a new Zone/Ward
       has been added.
    */

    WARDS_BY_ZONE = {};


    await loadZones();


    toast(
      'Zone / Ward added successfully.',
      'success'
    );


  } catch (error) {

    toast(
      error.message,
      'error'
    );
  }
}


/* ==========================================================================
   KEYBOARD SHORTCUTS
   ========================================================================== */

document.addEventListener(
  'keydown',
  function (event) {

    /*
       Login using Enter.
    */

    if (
      event.key === 'Enter' &&
      !$('loginScreen')
        .classList
        .contains('hidden')
    ) {

      const active =
        document.activeElement;


      if (
        active ===
          $('loginUsername') ||
        active ===
          $('loginPassword')
      ) {

        doLogin();
      }
    }
  }
);


/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

document.addEventListener(
  'DOMContentLoaded',
  function () {

    /*
       Start session restoration.
    */

    restoreSession();

  }
);