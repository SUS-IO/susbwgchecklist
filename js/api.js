/* ===========================================================
   IEC-BWG — api.js
   Talks to the Apps Script Web App. Handles the signed session
   token: stored in localStorage with an expiry, sent on every
   request, cleared on logout or expiry.
   =========================================================== */

// SETUP: paste your deployed Apps Script Web App URL here.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyEddLbiFBXBcCKnluSh74Uzcyk0X9z1oIZxqM9bV7xJ_uASgiZGEqE_edTOKWZJpg5/exec';

const AUTH_KEY = 'iecbwg_auth';
const SESSION_HOURS = 12;

const Auth = {
  get(){
    try{
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.token || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
        localStorage.removeItem(AUTH_KEY);
        return null;
      }
      return parsed;
    }catch(e){ return null; }
  },
  set(token, user){
    const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user, expiresAt }));
  },
  clear(){
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('iecbwg_lastZoneWard');
  },
  isLoggedIn(){ return !!this.get(); }
};

// ---- remembered Zone/Ward (kept until user changes it manually,
// cleared on logout) ----
const RememberedZoneWard = {
  get(){
    try{ return JSON.parse(localStorage.getItem('iecbwg_lastZoneWard') || 'null'); }
    catch(e){ return null; }
  },
  set(zone, ward){
    localStorage.setItem('iecbwg_lastZoneWard', JSON.stringify({ zone, ward }));
  }
};

async function apiGet(action, params){
  const auth = Auth.get();
  const q = new URLSearchParams({ action, token: auth ? auth.token : '', ...(params || {}) });
  const res = await fetch(`${WEB_APP_URL}?${q.toString()}`);
  const data = await res.json();
  if (data.error === 'SESSION_EXPIRED') { Auth.clear(); location.reload(); }
  return data;
}

async function apiPost(action, payload){
  const auth = Auth.get();
  const body = JSON.stringify({ action, token: auth ? auth.token : '', ...(payload || {}) });
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body
  });
  const data = await res.json();
  if (data.error === 'SESSION_EXPIRED') { Auth.clear(); location.reload(); }
  return data;
}
