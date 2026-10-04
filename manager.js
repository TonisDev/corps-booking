// [SECTION: JS-SETUP]
const WORKER_URL = "https://corporate-bookings.tonisdevv.workers.dev";

function parseOptionalPrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function optionalPriceInputValue(price) {
  const n = parseOptionalPrice(price);
  return n === null ? '' : String(n);
}

function formatServiceLabel(service) {
  const duration = service.duration || 60;
  const price = parseOptionalPrice(service && service.price);
  if (price === null) return `${service.name} (${duration} min · κατόπιν συνεννόησης)`;
  return `${service.name} (${duration} min · ${price}€)`;
}

let currentBusinessCode = localStorage.getItem('biz_code') || sessionStorage.getItem('biz_code') || '';
let currentSessionToken = localStorage.getItem('session_token') || sessionStorage.getItem('session_token') || '';
let currentTenantData = null;
let calendar = null;
let selectedEventId = null;
let pendingSlot = null;
let allAppointments = [];
let currentListKind = 'all';
let toastTimer;
let searchRelaxed = false;
let pendingResetToken = '';
let lastUndo = null;
let actionLock = false;
let overlayStack = []; // ιστορικό Back: κάθε modal/drawer κάνει pushState
let silentPop = 0;     // close από κουμπί → history.back() χωρίς διπλό κλείσιμο

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('admin_theme') || 'light';
  setAdminTheme(savedTheme);
  document.querySelectorAll('.appearance-input, input[name="clientTheme"], #setName').forEach(control => {
    control.addEventListener('input', updateAppearancePreview);
    control.addEventListener('change', updateAppearancePreview);
  });

  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dismissTopOverlay()) e.preventDefault();
  });

  if (currentBusinessCode && currentSessionToken && !new URLSearchParams(location.search).get('reset')) {
    loadDashboard(currentBusinessCode);
  } else {
    const rememberEl = document.getElementById('rememberMe');
    if (rememberEl) rememberEl.checked = localStorage.getItem('remember_me') !== '0';
    const params = new URLSearchParams(location.search);
    const resetToken = params.get('reset');
    if (resetToken) {
      pendingResetToken = resetToken;
      history.replaceState({}, '', location.pathname);
      showResetForm();
    } else {
      const preset = params.get('code');
      if (preset) {
        document.getElementById('loginCode').value = preset;
        document.getElementById('loginPass').focus();
      }
    }
  }
});

window.addEventListener('popstate', () => {
  if (silentPop > 0) {
    silentPop -= 1;
    return;
  }
  const top = overlayStack.pop();
  if (top) hideOverlay(top.kind, top.id);
});

// Προσθέτει πάντα το session token· 401 = λήξη → logout.
async function adminFetch(pathAndQuery, options = {}) {
  const headers = Object.assign({}, options.headers || {}, {
    'Authorization': `Bearer ${currentSessionToken}`
  });
  const res = await fetch(`${WORKER_URL}${pathAndQuery}`, { ...options, headers });

  if (res.status === 401) {
    handleLogout('Η συνεδρία έληξε ή δεν είναι έγκυρη. Παρακαλώ συνδεθείτε ξανά.');
    throw new Error('Unauthorized');
  }
  if (res.status === 403) {
    let message = 'Ο λογαριασμός είναι σε παύση. Ο πίνακας είναι κλειστός.';
    try {
      const data = await res.clone().json();
      if (data && data.error) message = data.error;
    } catch (err) {}
    handleLogout(message);
    throw new Error(message);
  }
  return res;
}

function toggleSecret(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  if (btn) btn.textContent = show ? 'Απόκρυψη' : 'Εμφάνιση';
}

function toggleTheme() {
  const current = document.body.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  setAdminTheme(next);
  localStorage.setItem('admin_theme', next);
}

function setAdminTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  document.body.setAttribute('data-theme', next);
  const themeColor = document.getElementById('themeColor');
  if (themeColor) themeColor.setAttribute('content', next === 'dark' ? '#0f172a' : '#f8fafc');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.innerHTML = next === 'dark' ? '<i data-lucide="sun" size="16"></i>' : '<i data-lucide="moon" size="16"></i>';
    lucide.createIcons();
  }
}

function managerLoginUrl(code) {
  const slug = code || currentBusinessCode || '';
  const page = new URL('manager.html', location.href);
  if (slug) page.searchParams.set('code', slug);
  return page.toString();
}

async function copyCalendarLink() {
  const url = document.getElementById('calendarUrl').value.trim();
  if (!url) {
    showToast('Ο σύνδεσμος ημερολογίου δεν είναι έτοιμος.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Ο σύνδεσμος ημερολογίου αντιγράφηκε.');
  } catch (err) {
    prompt('Αντιγραφή:', url);
  }
}

async function copyManagerLink() {
  const url = managerLoginUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('Ο σύνδεσμος αντιγράφηκε.');
  } catch (err) {
    prompt('Αντιγραφή:', url);
  }
}

async function shareManagerLink() {
  const url = managerLoginUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Διαχείριση ραντεβού', url });
      return;
    } catch (err) {}
  }
  copyManagerLink();
}

async function changeOwnPassword() {
  const current_password = document.getElementById('currentPassword').value;
  const new_password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('newPassword2').value;
  if (!current_password || !new_password) {
    showToast('Συμπληρώστε τον τρέχοντα και τον νέο κωδικό.', true);
    return;
  }
  if (new_password.length < 8) {
    showToast('Ο νέος κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.', true);
    return;
  }
  if (new_password !== confirm) {
    showToast('Οι νέοι κωδικοί δεν ταιριάζουν.', true);
    return;
  }
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Σφάλμα αλλαγής κωδικού');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newPassword2').value = '';
    showToast('Ο κωδικός άλλαξε.');
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα αλλαγής κωδικού.', true);
  }
}

function openPublicPage() {
  if (!currentBusinessCode) return;
  const url = `https://quickbook.gr/?business_code=${currentBusinessCode}`;
  window.open(url, '_blank');
}

// [SECTION: JS-AUTH]
function writeAuth(code, token, remember) {
  localStorage.removeItem('biz_code');
  localStorage.removeItem('session_token');
  sessionStorage.removeItem('biz_code');
  sessionStorage.removeItem('session_token');
  const store = remember ? localStorage : sessionStorage;
  store.setItem('biz_code', code);
  store.setItem('session_token', token);
  localStorage.setItem('remember_me', remember ? '1' : '0');
}

function clearAuth() {
  localStorage.removeItem('biz_code');
  localStorage.removeItem('session_token');
  sessionStorage.removeItem('biz_code');
  sessionStorage.removeItem('session_token');
}

async function handleLogin(event) {
  if (event) event.preventDefault();
  if (actionLock) return;
  actionLock = true;
  const code = document.getElementById('loginCode').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const remember = Boolean(document.getElementById('rememberMe')?.checked);
  const errorEl = document.getElementById('loginError');
  errorEl.style.display = 'none';

  if (!code || !pass) {
    errorEl.textContent = 'Συμπλήρωσε business code και κωδικό. Όχι το Super Admin Key — αυτό είναι μόνο στο onboarding.';
    errorEl.style.display = 'block';
    actionLock = false;
    return;
  }

  try {
    const res = await fetch(`${WORKER_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_code: code, password: pass, remember })
    });
    const data = await res.json();

    if (!res.ok || !data.token) {
      const failure = new Error(data.error || (res.status === 429 ? 'Πολλές προσπάθειες. Περίμενε λίγο.' : 'Αποτυχία σύνδεσης'));
      failure.warning = Boolean(data.warning);
      throw failure;
    }

    writeAuth(code, data.token, remember);
    currentBusinessCode = code;
    currentSessionToken = data.token;
    loadDashboard(code);
  } catch (err) {
    errorEl.style.color = err.warning ? '#b45309' : '#dc2626';
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  } finally {
    actionLock = false;
  }
}

function showLoginForm() {
  document.getElementById('loginForm').style.display = '';
  document.getElementById('forgotOpen').style.display = '';
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('resetForm').style.display = 'none';
}

function showForgotForm() {
  document.getElementById('forgotCode').value = document.getElementById('loginCode').value.trim();
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('forgotOpen').style.display = 'none';
  document.getElementById('forgotForm').style.display = '';
  document.getElementById('resetForm').style.display = 'none';
  document.getElementById('forgotCode').focus();
}

function showResetForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('forgotOpen').style.display = 'none';
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('resetForm').style.display = '';
  document.getElementById('resetPass').focus();
}

function showAuthNote(id, text, isError) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.style.display = 'block';
  el.style.color = isError ? '#dc2626' : '#166534';
}

function formatSupportWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('el-GR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

let lastRevealedMessageKey = '';

function revealAdminMessage(el, key) {
  if (!el || el.hidden) return;
  const mark = String(key || '');
  if (mark && mark === lastRevealedMessageKey) return;
  lastRevealedMessageKey = mark || lastRevealedMessageKey;
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {}
    el.classList.add('is-attention');
    window.setTimeout(() => el.classList.remove('is-attention'), 2400);
  });
}

function updateSupportUnreadBadge(count) {
  const n = Number(count) || 0;
  if (currentTenantData) currentTenantData.support_unread = n;
  const dot = document.getElementById('supportUnreadDot');
  if (dot) dot.hidden = n <= 0;
  const btn = document.getElementById('supportSideBtn');
  if (btn) {
    btn.classList.toggle('has-unread', n > 0);
    btn.title = n > 0
      ? `Υποστήριξη · ${n} νέ${n === 1 ? 'α απάντηση' : 'ες απαντήσεις'}`
      : 'Chat με τον δημιουργό του QuickBook';
  }
  const banner = document.getElementById('supportUnreadBanner');
  const bannerText = document.getElementById('supportUnreadBannerText');
  const noticeVisible = !!(currentTenantData && currentTenantData.admin_notice && currentTenantData.admin_notice.body);
  if (banner) {
    // Αν υπάρχει ήδη το κουτί πλατφόρμας, μη διπλοδείχνουμε· αρκεί το sticky notice.
    if (n > 0 && !noticeVisible) {
      if (bannerText) {
        bannerText.textContent = n === 1
          ? 'Νέο μήνυμα στην Υποστήριξη — πάτα για άνοιγμα'
          : `${n} νέα μηνύματα στην Υποστήριξη — πάτα για άνοιγμα`;
      }
      banner.hidden = false;
      revealAdminMessage(banner, `support:${n}:${currentTenantData && currentTenantData.support_unread}`);
    } else {
      banner.hidden = true;
    }
  }
}

function supportReceiptLabel(m, mine) {
  const bits = [];
  if (m.email_sent) bits.push('email');
  if (mine) bits.push(m.read_at ? 'διαβάστηκε' : 'μη διαβασμένο');
  return bits.length ? ` · ${bits.join(' · ')}` : '';
}

function renderSupportThread(messages) {
  const box = document.getElementById('supportThread');
  if (!box) return;
  const rows = Array.isArray(messages) ? messages : [];
  if (!rows.length) {
    box.innerHTML = '<p class="muted" style="margin:0;">Δεν υπάρχει ακόμα συνομιλία. Γράψε το πρώτο μήνυμα από κάτω.</p>';
    return;
  }
  box.innerHTML = rows.map((m) => {
    const mine = String(m.direction || 'tenant') !== 'sa';
    const who = mine ? 'Εσύ' : 'QuickBook';
    return `<div class="support-bubble ${mine ? 'me' : 'them'}">${escapeHtml(m.body || '')}<span class="support-bubble-meta">${escapeHtml(who)} · ${escapeHtml(formatSupportWhen(m.created_at))}${escapeHtml(supportReceiptLabel(m, mine))}</span></div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function bindSupportEnterToSend(textareaId, onSend) {
  const el = document.getElementById(textareaId);
  if (!el || el.dataset.enterBound === '1') return;
  el.dataset.enterBound = '1';
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onSend(event);
  });
}

async function loadSupportThread() {
  const box = document.getElementById('supportThread');
  if (!box || !currentBusinessCode) return;
  box.innerHTML = '<p class="muted" style="margin:0;">Φόρτωση συνομιλίας…</p>';
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/support`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      box.innerHTML = `<p class="muted" style="margin:0;">${escapeHtml(data.error || 'Η συνομιλία δεν φορτώθηκε.')}</p>`;
      return;
    }
    renderSupportThread(data.messages || []);
    updateSupportUnreadBadge(0);
  } catch (err) {
    if (err && err.message === 'Unauthorized') return;
    box.innerHTML = '<p class="muted" style="margin:0;">Η συνομιλία δεν φορτώθηκε.</p>';
  }
}

function openSupportModal() {
  const note = document.getElementById('supportNote');
  if (note) {
    note.hidden = true;
    note.textContent = '';
  }
  openModal('supportModal');
  loadSupportThread();
  bindSupportEnterToSend('supportMessage', (event) => {
    const form = document.getElementById('supportForm');
    if (form) form.requestSubmit();
    else sendSupportMessage(event);
  });
  setTimeout(() => document.getElementById('supportMessage')?.focus(), 50);
  lucide.createIcons();
}

function toggleSupportForm() {
  openSupportModal();
}

async function sendSupportMessage(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const note = document.getElementById('supportNote');
  const message = document.getElementById('supportMessage').value.trim();
  const notifyEmail = !!document.getElementById('supportNotifyEmail')?.checked;
  note.hidden = true;
  if (!message) {
    note.hidden = false;
    note.style.color = '#dc2626';
    note.textContent = 'Γράψε μήνυμα.';
    return;
  }
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/support`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, notify_email: notifyEmail })
    });
    const data = await res.json().catch(() => ({}));
    note.hidden = false;
    if (!res.ok) {
      note.style.color = '#dc2626';
      note.textContent = data.error || 'Το μήνυμα δεν στάλθηκε.';
      return;
    }
    note.style.color = '#166534';
    note.textContent = data.message || 'Στο chat.';
    document.getElementById('supportMessage').value = '';
    showToast(notifyEmail && data.email_sent ? 'Στο chat · και email.' : 'Στο chat.');
    await loadSupportThread();
  } catch (err) {
    if (err && err.message === 'Unauthorized') return;
    note.hidden = false;
    note.style.color = '#dc2626';
    note.textContent = 'Το μήνυμα δεν στάλθηκε.';
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const code = document.getElementById('forgotCode').value.trim().toLowerCase();
  if (!code) {
    showAuthNote('forgotMessage', 'Γράψε το business code.', true);
    return;
  }
  try {
    const res = await fetch(`${WORKER_URL}/api/admin/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_code: code })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Δεν στάλθηκε ο σύνδεσμος.');
    showAuthNote('forgotMessage', data.message || 'Αν ο λογαριασμός έχει email, θα λάβεις σύνδεσμο.', false);
  } catch (err) {
    showAuthNote('forgotMessage', err.message || 'Δεν στάλθηκε ο σύνδεσμος.', true);
  }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const password = document.getElementById('resetPass').value;
  const confirm = document.getElementById('resetPass2').value;
  if (password.length < 8) {
    showAuthNote('resetMessage', 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.', true);
    return;
  }
  if (password !== confirm) {
    showAuthNote('resetMessage', 'Οι κωδικοί δεν ταιριάζουν.', true);
    return;
  }
  try {
    const res = await fetch(`${WORKER_URL}/api/admin/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pendingResetToken, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ο κωδικός δεν άλλαξε.');
    pendingResetToken = '';
    if (data.business_code) document.getElementById('loginCode').value = data.business_code;
    document.getElementById('loginPass').value = '';
    showLoginForm();
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = 'Ο κωδικός άλλαξε. Συνδέσου με τον νέο.';
    errorEl.style.color = '#166534';
    errorEl.style.display = 'block';
  } catch (err) {
    showAuthNote('resetMessage', err.message || 'Ο κωδικός δεν άλλαξε.', true);
  }
}

function handleLogout(message) {
  clearAuth();
  currentBusinessCode = '';
  currentSessionToken = '';
  if (message) {
    // Δείχνουμε το μήνυμα στην οθόνη login μετά το reload.
    sessionStorage.setItem('logout_message', message);
  }
  location.reload();
}

async function loadDashboard(code) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboardScreen').style.display = 'block';
  document.getElementById('storeCodeSpan').innerText = `Code: ${code}`;

  try {
    const res = await adminFetch(`/api/${code}/admin/settings`);
    currentTenantData = await res.json();
    document.getElementById('storeTitle').innerText = currentTenantData.name;
    const businessEmail = String(currentTenantData.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail) && !sessionStorage.getItem('email_nudge_' + code)) {
      sessionStorage.setItem('email_nudge_' + code, '1');
      showToast('Βάλε email επιχείρησης στις ρυθμίσεις. Χωρίς αυτό δεν γίνεται ανάκτηση κωδικού.', true);
    }
    const billingFlag = new URLSearchParams(location.search).get('billing');
    const connectFlag = new URLSearchParams(location.search).get('connect');
    if (billingFlag || connectFlag) history.replaceState({}, '', location.pathname);
    if (billingFlag) {
      showToast(billingFlag === 'ok' ? 'Η πληρωμή καταχωρήθηκε.' : 'Η πληρωμή ακυρώθηκε.', billingFlag !== 'ok');
    }
    if (connectFlag === 'refresh') startStripeConnect();
    if (connectFlag === 'return') refreshStripeConnect();

    populateServicesDropdown();
    renderPlatformBanners();
    renderBillingBox();
    renderConnectStatus();
    updateSupportUnreadBadge(currentTenantData.support_unread);
  } catch (e) {
    console.error(e);
  }

  if (!calendar) initCalendar();
  fetchAppointments().then(() => {
    lastPendingCount = Number(document.getElementById('statPending').dataset.open) || 0;
    markDashFresh();
  });
  startDashAutoRefresh();
  renderAdminQr();
  lucide.createIcons();
}

let lastPendingCount = null;
let dashTimer = 0;

function markDashFresh() {
  const el = document.getElementById('dashFresh');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
}

function startDashAutoRefresh() {
  if (dashTimer) clearInterval(dashTimer);
  dashTimer = setInterval(() => {
    if (document.visibilityState === 'hidden' || !currentBusinessCode) return;
    refreshDashboard(true);
  }, 60000);
}

async function refreshDashboard(silent) {
  if (!currentBusinessCode) return;
  const btn = document.getElementById('refreshDashBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/settings`);
    if (res.ok) {
      currentTenantData = await res.json();
      const title = document.getElementById('storeTitle');
      if (title) title.innerText = currentTenantData.name || '';
      populateServicesDropdown();
      renderPlatformBanners();
      renderBillingBox();
      renderConnectStatus();
      updateSupportUnreadBadge(currentTenantData.support_unread);
    }
    await fetchAppointments();
    const pending = Number(document.getElementById('statPending').dataset.open) || 0;
    const pill = document.getElementById('pendingNew');
    const arrived = lastPendingCount !== null && pending > lastPendingCount;
    if (pill) pill.hidden = !arrived;
    lastPendingCount = pending;
    markDashFresh();
    if (arrived) showNewNotice();
    else if (!silent) showToast('Ενημερώθηκε.');
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast('Η ανανέωση δεν ολοκληρώθηκε.', true);
  } finally {
    if (btn) btn.disabled = false;
    lucide.createIcons();
  }
}

function renderAdminQr() {
  const box = document.getElementById('adminQr');
  if (!box) return;
  const url = managerLoginUrl();
  if (box.dataset.url === url) return;
  box.innerHTML = '';
  box.dataset.url = url;
  if (typeof QRCode === 'undefined') {
    box.textContent = url;
    return;
  }
  new QRCode(box, {
    text: url,
    width: 120,
    height: 120,
    correctLevel: QRCode.CorrectLevel.M
  });
}

function formFieldsFromTenant(tenant) {
  const d = { phone: true, email: true, instagram: true, notes: true, extra_label: 'Instagram' };
  const raw = tenant && tenant.form_fields;
  if (!raw || typeof raw !== 'object') return d;
  const instagram = raw.instagram !== false && raw.instagram !== 0 && raw.instagram !== '0';
  const hasLabel = Object.prototype.hasOwnProperty.call(raw, 'extra_label');
  return {
    phone: raw.phone !== false && raw.phone !== 0 && raw.phone !== '0',
    email: raw.email !== false && raw.email !== 0 && raw.email !== '0',
    instagram,
    notes: raw.notes !== false && raw.notes !== 0 && raw.notes !== '0',
    extra_label: hasLabel ? String(raw.extra_label || '').trim() : (instagram ? 'Instagram' : '')
  };
}

function guardContactFields(changed) {
  const phone = document.getElementById('formFieldPhone');
  const email = document.getElementById('formFieldEmail');
  if (phone.checked || email.checked) return;
  if (changed === 'phone') email.checked = true;
  else phone.checked = true;
  showToast('Πρέπει να μείνει τηλέφωνο ή email.', true);
}

function extraFieldTitle() {
  const fields = formFieldsFromTenant(currentTenantData);
  return fields.extra_label || 'Instagram';
}

function formFieldBoxes() {
  return ['formFieldPhone', 'formFieldEmail', 'formFieldInstagram', 'formFieldNotes']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function syncFormFieldSelect() {
  const master = document.getElementById('selectAllFormFields');
  const boxes = formFieldBoxes();
  if (!master || !boxes.length) return;
  master.checked = boxes.every((box) => box.checked);
  master.indeterminate = boxes.some((box) => box.checked) && !master.checked;
}

function toggleFormFields(checked) {
  if (checked) {
    formFieldBoxes().forEach((box) => { box.checked = true; });
  } else {
    const instagram = document.getElementById('formFieldInstagram');
    const notes = document.getElementById('formFieldNotes');
    if (instagram) instagram.checked = false;
    if (notes) notes.checked = false;
  }
  syncExtraField();
  syncFormFieldSelect();
}

function syncExtraField() {
  const on = document.getElementById('formFieldInstagram');
  const input = document.getElementById('formFieldExtraLabel');
  if (!on || !input) return;
  input.style.display = on.checked ? 'block' : 'none';
}

function toggleNamedChecks(name, checked) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((box) => { box.checked = checked; });
  if (name === 'w_day') syncHoursEditors();
  syncNamedChecks(name, name === 'w_day' ? 'selectAllDays' : '');
}

function syncNamedChecks(name, masterId) {
  const master = masterId ? document.getElementById(masterId) : null;
  const boxes = [...document.querySelectorAll(`input[name="${name}"]`)];
  if (!master || !boxes.length) return;
  master.checked = boxes.every((box) => box.checked);
  master.indeterminate = boxes.some((box) => box.checked) && !master.checked;
}

function populateServicesDropdown() {
  const services = currentTenantData.services || [];
  const serviceSelect = document.getElementById('massageType');
  serviceSelect.innerHTML = '';
  services.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = formatServiceLabel(s);
    opt.setAttribute('data-duration', s.duration);
    serviceSelect.appendChild(opt);
  });

  serviceSelect.onchange = (e) => {
    const selectedOpt = e.target.options[e.target.selectedIndex];
    document.getElementById('bookDuration').value = selectedOpt.getAttribute('data-duration') || 60;
  };
  if (services.length > 0) {
    document.getElementById('bookDuration').value = services[0].duration;
  }
}

function bucketServiceOptionsHtml(currentName, currentDuration) {
  const services = (currentTenantData && currentTenantData.services) || [];
  const current = String(currentName || '').trim();
  const opts = [];
  let matched = false;
  services.forEach((s) => {
    const name = String(s.name || '').trim();
    if (!name) return;
    const selected = name === current;
    if (selected) matched = true;
    opts.push(
      `<option value="${escapeHtml(name)}" data-duration="${Number(s.duration) || 60}"${selected ? ' selected' : ''}>${escapeHtml(formatServiceLabel(s))}</option>`
    );
  });
  if (current && !matched) {
    opts.unshift(
      `<option value="${escapeHtml(current)}" data-duration="${Number(currentDuration) || 60}" selected>${escapeHtml(current)}</option>`
    );
  }
  if (!opts.length) {
    opts.push(`<option value="${escapeHtml(current || 'Υπηρεσία')}" data-duration="${Number(currentDuration) || 60}" selected>${escapeHtml(current || 'Υπηρεσία')}</option>`);
  }
  return opts.join('');
}

function selectedBucketService() {
  const sel = document.getElementById('bucketServiceSelect');
  if (!sel) return null;
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return null;
  return {
    service_name: String(opt.value || '').trim(),
    duration: Number(opt.getAttribute('data-duration')) || 60
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function snapMinute(minutes) {
  if (minutes < 8) return '00';
  if (minutes < 23) return '15';
  if (minutes < 38) return '30';
  if (minutes < 53) return '45';
  return '00';
}

function addMinutesToClock(hour, minute, extra) {
  let total = parseInt(hour, 10) * 60 + parseInt(minute, 10) + extra;
  if (total < 0) total = 0;
  return { hour: pad2(Math.floor(total / 60) % 24), minute: pad2(total % 60) };
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el || value == null || value === '') return;
  if (![...el.options].some(opt => opt.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
  }
  el.value = value;
}

function slotFromDate(date, isTimeView) {
  const hourRaw = pad2(date.getHours());
  const minuteRaw = snapMinute(date.getMinutes());
  const rolled = (date.getMinutes() >= 53);
  const hour = rolled && isTimeView ? pad2(date.getHours() + 1) : hourRaw;
  const minute = rolled && isTimeView ? '00' : minuteRaw;
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    hour,
    minute,
    hasTime: !!isTimeView
  };
}

function formatSlotHint(slot) {
  const [y, m, d] = slot.date.split('-');
  const humanDate = `${d}/${m}/${y}`;
  return slot.hasTime ? `${humanDate}, ${slot.hour}:${slot.minute}` : humanDate;
}

function openSlotChoice(info) {
  const isTimeView = info.view.type.indexOf('timeGrid') === 0;
  const isDayGrid = info.view.type.indexOf('dayGrid') === 0;
  pendingSlot = slotFromDate(info.date, isTimeView);
  if (isDayGrid) {
    const n = appointmentsOnDate(pendingSlot.date).length;
    document.getElementById('slotChoiceTitle').textContent = formatLongGreekDate(pendingSlot.date);
    document.getElementById('slotChoiceHint').textContent = n === 1 ? '1 ραντεβού' : `${n} ραντεβού`;
  } else {
    document.getElementById('slotChoiceTitle').textContent = 'Νέα ενέργεια';
    document.getElementById('slotChoiceHint').textContent = formatSlotHint(pendingSlot);
  }
  renderDayClickList(isDayGrid ? pendingSlot.date : null);
  openModal('slotChoiceModal');
}

function renderDayClickList(dateStr) {
  const list = document.getElementById('dayAppointmentsList');
  if (!dateStr) {
    list.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  const rows = allAppointments
    .filter(item => item.date === dateStr)
    .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
  list.style.display = 'flex';
  if (!rows.length) {
    list.innerHTML = '<p class="today-empty">Δεν υπάρχουν ραντεβού αυτή την ημέρα.</p>';
    return;
  }
  list.innerHTML = rows.map(item => `
    <button type="button" class="apt-row" data-id="${escapeHtml(item.id)}">
      <div>
        <div style="font-weight:600;">${escapeHtml(appointmentTimeLabel(item))} · ${escapeHtml(item.status === 'BLOCKED' ? blockedLabel(item) : (item.customer_name || 'Χωρίς όνομα'))}</div>
        <div class="apt-row-meta">
          ${escapeHtml(item.service_name || '-')}
          ${item.customer_phone ? ' · ' + escapeHtml(item.customer_phone) : ''}
        </div>
      </div>
      <div style="display:flex; gap:0.35rem; flex-wrap:wrap; justify-content:flex-end;">${statusBadge(item)}</div>
    </button>
  `).join('');
  list.querySelectorAll('.apt-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const found = allAppointments.find(a => a.id === btn.getAttribute('data-id'));
      openAppointmentDetails(found);
    });
  });
}

function openBookingFromToolbar() {
  pendingSlot = null;
  openBookingModal();
}

function openBookingToBucket() {
  pendingSlot = null;
  // Κλείσε τη λίστα bucket αν είναι ανοιχτή — αλλιώς η φόρμα μένει από κάτω.
  if (isOverlayVisible('modal', 'listModal')) closeModal('listModal');
  if (isOverlayVisible('modal', 'actionModal')) closeModal('actionModal');
  openBookingModal();
  const unscheduled = document.getElementById('bookUnscheduled');
  if (unscheduled) {
    unscheduled.checked = true;
    syncBookUnscheduledFields();
  }
}

function openBlockFromToolbar() {
  pendingSlot = null;
  openBlockModal();
}

function chooseSlotBooking() {
  openBookingModal(pendingSlot);
}

function chooseSlotBlock() {
  openBlockModal(pendingSlot);
}

function openBookingModal(slot) {
  const form = document.querySelector('#bookingModal form');
  if (form) form.reset();
  populateServicesDropdown();
  const unscheduled = document.getElementById('bookUnscheduled');
  if (unscheduled) unscheduled.checked = false;
  if (slot) {
    document.getElementById('bookDate').value = slot.date;
    if (slot.hasTime) {
      setSelectValue('bookHour', slot.hour);
      setSelectValue('bookMinute', slot.minute);
    }
  }
  syncBookUnscheduledFields();
  openModal('bookingModal');
}

function syncBookUnscheduledFields() {
  const off = document.getElementById('bookUnscheduled')?.checked;
  const wrap = document.getElementById('bookWhenFields');
  if (wrap) wrap.style.opacity = off ? '0.45' : '1';
  ['bookDate', 'bookHour', 'bookMinute'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.required = !off;
    el.disabled = !!off;
  });
}

function openBlockModal(slot) {
  const form = document.querySelector('#blockModal form');
  if (form) form.reset();
  const fromSlot = !!(slot && slot.hasTime);
  document.getElementById('blockTimeGrid').classList.toggle('is-from-slot', fromSlot);
  document.getElementById('blockStartFields').hidden = fromSlot;
  document.getElementById('blockLead').hidden = !fromSlot;
  document.getElementById('blockEndAt').hidden = !fromSlot;
  document.getElementById('blockEndClocks').hidden = fromSlot;
  document.getElementById('blockSpanChoices').hidden = !fromSlot;
  if (slot) {
    document.getElementById('blockDate').value = slot.date;
    if (fromSlot) {
      setSelectValue('blockStartHour', slot.hour);
      setSelectValue('blockStartMin', slot.minute);
      document.getElementById('blockLead').textContent = `Από ${slot.hour}:${slot.minute}. Διάλεξε μέχρι πότε μένουν κλειστές.`;
      if (!fillBlockEndChoices(slot.hour, slot.minute)) {
        showToast('Αυτή είναι η τελευταία ώρα της μέρας.', true);
        return;
      }
    }
  }
  openModal('blockModal');
}

function fillBlockEndChoices(hour, minute) {
  const start = parseInt(hour, 10) * 60 + parseInt(minute, 10);
  const ends = [];
  for (let mins = start + 30; mins <= 22 * 60; mins += 30) ends.push(mins);
  const select = document.getElementById('blockEndAt');
  const choices = document.getElementById('blockSpanChoices');
  select.innerHTML = '';
  if (!ends.length) return false;
  ends.forEach((mins) => {
    const opt = document.createElement('option');
    opt.value = String(mins);
    opt.textContent = clockLabel(mins);
    select.appendChild(opt);
  });
  const presets = [
    { label: '30 λεπτά', mins: start + 30 },
    { label: '1 ώρα', mins: start + 60 },
    { label: '2 ώρες', mins: start + 120 },
    { label: 'Μέχρι τις 22:00', mins: 22 * 60 }
  ].filter((preset, index, all) => ends.includes(preset.mins) && all.findIndex((item) => item.mins === preset.mins) === index);
  choices.innerHTML = presets.map((preset) => `<button type="button" class="btn btn-outline span-btn" data-end="${preset.mins}">${preset.label}</button>`).join('');
  const apply = (mins) => {
    select.value = String(mins);
    applyBlockEndMinutes(mins);
    choices.querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-on', btn.getAttribute('data-end') === String(mins)));
  };
  choices.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => apply(parseInt(btn.getAttribute('data-end'), 10)));
  });
  select.onchange = () => apply(parseInt(select.value, 10));
  apply(ends[0]);
  return true;
}

function clockLabel(mins) {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

function applyBlockEndMinutes(mins) {
  setSelectValue('blockEndHour', pad2(Math.floor(mins / 60)));
  setSelectValue('blockEndMin', pad2(mins % 60));
}

// [SECTION: JS-CALENDAR]
function managerIsPhone() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function isPhoneDayGrid(viewType) {
  return managerIsPhone() && (viewType === 'dayGridMonth' || viewType === 'dayGridWeek');
}

function calendarToolbar() {
  return managerIsPhone()
    ? { left: 'prev,next', center: 'title', right: 'timeGridDay,dayGridWeek,dayGridMonth' }
    : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' };
}

function calendarButtonText() {
  return managerIsPhone()
    ? { today: 'Σήμερα', month: 'Μήνας', week: 'Εβδ.', day: 'Ημέρα' }
    : { today: 'Σήμερα', month: 'Μήνας', week: 'Εβδομάδα', day: 'Ημέρα' };
}

function calendarScrollTime() {
  const n = new Date();
  const hour = Math.min(20, Math.max(8, n.getHours() - 1));
  return `${String(hour).padStart(2, '0')}:00:00`;
}

function calendarPhoneHeight() {
  return Math.round(Math.max(440, Math.min(window.innerHeight * 0.7, 640)));
}

function calendarHeight() {
  if (!managerIsPhone()) return 'auto';
  if (calendar && calendar.view && (calendar.view.type === 'dayGridMonth' || calendar.view.type === 'dayGridWeek')) {
    return 'auto';
  }
  return calendarPhoneHeight();
}

function applyCalendarLayout() {
  if (!calendar) return;
  const phone = managerIsPhone();
  calendar.setOption('headerToolbar', calendarToolbar());
  calendar.setOption('buttonText', calendarButtonText());
  calendar.setOption('height', calendarHeight());
  calendar.setOption('expandRows', !phone);
  calendar.setOption('displayEventTime', !phone);
  applyCalendarEventTitles();
  paintMonthDayCounts();
}

function customerFirstName(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Χωρίς όνομα';
  return raw.split(/\s+/)[0];
}

function isCompactCalView(viewType) {
  return viewType === 'timeGridWeek' || viewType === 'dayGridWeek' || viewType === 'dayGridMonth';
}

function blockedLabel(item) {
  const reason = String((item && item.notes) || '').trim();
  if (reason && reason !== 'Μη διαθέσιμο') return reason;
  return 'Κλειδωμένες ώρες';
}

function calendarEventTitle(item, compact) {
  if (item && item.status === 'BLOCKED') return blockedLabel(item);
  const name = compact ? customerFirstName(item && item.customer_name) : (item && item.customer_name || 'Χωρίς όνομα');
  if (waitlistNeedsTime(item)) return `Ουρά · ${name}`;
  const service = (item && item.service_name) || '';
  return service ? `${name} · ${service}` : name;
}

function applyCalendarEventTitles() {
  if (!calendar) return;
  const compact = isCompactCalView(calendar.view && calendar.view.type);
  calendar.getEvents().forEach(ev => {
    const item = ev.extendedProps || {};
    ev.setProp('title', calendarEventTitle(item, compact));
  });
}

let calendarTouch = null;
let calendarIgnoreClickUntil = 0;

function bindCalendarSwipe(calendarEl) {
  calendarEl.addEventListener('touchstart', (event) => {
    if (!managerIsPhone() || !event.touches || event.touches.length !== 1) {
      calendarTouch = null;
      return;
    }
    const touch = event.touches[0];
    calendarTouch = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  calendarEl.addEventListener('touchend', (event) => {
    const start = calendarTouch;
    calendarTouch = null;
    if (!start || !calendar || !managerIsPhone()) return;
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
    calendarIgnoreClickUntil = Date.now() + 500;
    if (dx < 0) calendar.next();
    else calendar.prev();
  }, { passive: true });

  calendarEl.addEventListener('touchcancel', () => {
    calendarTouch = null;
  }, { passive: true });
}

function calendarClickIgnored() {
  return Date.now() < calendarIgnoreClickUntil;
}

function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  const phone = managerIsPhone();
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: phone ? 'timeGridDay' : 'timeGridWeek',
    height: phone ? calendarPhoneHeight() : 'auto',
    expandRows: !phone,
    nowIndicator: true,
    locale: 'el',
    navLinks: false,
    allDayText: 'Ουρά',
    displayEventTime: !phone,
    eventShortHeight: 22,
    eventMinHeight: 28,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotMinTime: '08:00:00',
    slotMaxTime: '22:00:00',
    scrollTime: calendarScrollTime(),
    stickyHeaderDates: true,
    headerToolbar: calendarToolbar(),
    buttonText: calendarButtonText(),
    views: {
      timeGridDay: {
        titleFormat: { weekday: 'short', day: 'numeric', month: 'short' },
        eventMinHeight: 52,
        eventShortHeight: 20
      },
      dayGridWeek: {
        titleFormat: { month: 'short', year: 'numeric' },
        dayHeaderFormat: { weekday: 'short', day: 'numeric' }
      },
      dayGridMonth: {
        titleFormat: { month: 'short', year: 'numeric' }
      }
    },
    eventClick: info => {
      if (calendarClickIgnored()) return;
      if (isPhoneDayGrid(info.view.type)) {
        info.jsEvent.preventDefault();
        openSlotChoice({ date: info.event.start, view: { type: info.view.type } });
        return;
      }
      const item = Object.assign({}, info.event.extendedProps, {
        id: info.event.id || (info.event.extendedProps && info.event.extendedProps.id)
      });
      openAppointmentDetails(item);
    },
    dateClick: info => {
      if (calendarClickIgnored()) return;
      openSlotChoice(info);
    },
    datesSet: () => {
      if (!calendar) return;
      const nextHeight = calendarHeight();
      if (calendar.getOption('height') !== nextHeight) {
        calendar.setOption('height', nextHeight);
      }
      paintMonthDayCounts();
      applyCalendarEventTitles();
    },
    windowResize: applyCalendarLayout
  });
  calendar.render();
  bindCalendarSwipe(calendarEl);
}

async function fetchAppointments() {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/appointments`);
    const data = await res.json();
    allAppointments = Array.isArray(data) ? data : [];

    let pending = 0, waitlist = 0, booked = 0, history = 0, unscheduled = 0;
    calendar.removeAllEvents();

    allAppointments.forEach(item => {
      if (isActiveBucketItem(item)) unscheduled++;
      if (item.status === 'PENDING' && !isUnscheduled(item)) pending++;
      if (item.status === 'WAITLIST') waitlist++;
      if (item.status === 'BOOKED' || item.status === 'CONFIRMED') {
        if (!isPastAppointment(item)) booked++;
      }
      if (item.status === 'REJECTED' || item.status === 'CANCELLED' || (isPastAppointment(item) && item.status !== 'BLOCKED' && item.status !== 'PENDING' && item.status !== 'WAITLIST')) history++;

      if (isUnscheduled(item)) return;

      let color = '#059669';
      if (item.status === 'PENDING') color = '#d97706';
      if (item.status === 'WAITLIST') color = '#7c3aed';
      if (item.status === 'BLOCKED') color = '#64748b';
      if (item.status === 'REJECTED') color = '#ef4444';
      if (item.status === 'CANCELLED') color = '#facc15';

      const floating = waitlistNeedsTime(item);
      calendar.addEvent({
        id: item.id,
        title: calendarEventTitle(item, false),
        allDay: floating,
        start: floating ? item.date : `${item.date}T${item.start_time}`,
        end: floating ? undefined : `${item.date}T${item.end_time}`,
        backgroundColor: color,
        borderColor: color,
        textColor: item.status === 'CANCELLED' ? '#713f12' : '#ffffff',
        extendedProps: item
      });
    });

    const realAppointments = allAppointments.filter(item => item.status !== 'BLOCKED');
    document.getElementById('statTotal').innerText = realAppointments.length;
    const pendingEl = document.getElementById('statPending');
    const waitEl = document.getElementById('statWaitlist');
    pendingEl.innerText = pending;
    // «Νέο αίτημα» μόνο για αιτήματα πελάτη (εκκρεμή/ουρά) — όχι για bucket που βάζει ο admin
    pendingEl.dataset.open = String(pending + waitlist);
    if (waitEl) {
      waitEl.textContent = `ουρά ${waitlist}`;
      waitEl.hidden = waitlist < 1;
    }
    document.getElementById('statBooked').innerText = booked;
    document.getElementById('statHistory').innerText = history;
    const unsEl = document.getElementById('statUnscheduled');
    if (unsEl) unsEl.innerText = unscheduled;
    renderTodayList();
    paintMonthDayCounts();
    applyCalendarEventTitles();
    if (document.getElementById('listModal').style.display === 'flex') {
      renderAppointmentList();
    }
  } catch (e) {
    console.error(e);
  }
}

// [SECTION: JS-LISTS] — εγκεκριμένα = μέλλον · ιστορικό = παρελθόν + REJECTED + CANCELLED
function isUnscheduled(item) {
  const date = String(item && item.date || '').trim();
  return !date || date === 'unscheduled';
}

function isActiveBucketItem(item) {
  if (!isUnscheduled(item)) return false;
  const status = String((item && item.status) || '');
  return status !== 'BLOCKED' && status !== 'REJECTED' && status !== 'CANCELLED';
}

function waitlistNeedsTime(item) {
  return item && item.status === 'WAITLIST'
    && /χωρίς συγκεκριμένη ώρα/i.test(String(item.notes || ''));
}

function needsDayOrTime(item) {
  return isUnscheduled(item) || waitlistNeedsTime(item) || !item.start_time;
}

function appointmentTimeLabel(item) {
  if (isUnscheduled(item)) return 'Bucket';
  return waitlistNeedsTime(item) ? 'Ουρά' : (item.start_time || '-');
}

function isPastAppointment(item) {
  if (!item || isUnscheduled(item)) return false;
  if (waitlistNeedsTime(item)) return item.date < todayISO();
  const end = item.end_time || item.start_time || '00:00';
  const stamp = new Date(`${item.date}T${end}`).getTime();
  return Number.isFinite(stamp) && stamp < Date.now();
}

function formatGreekDate(dateStr) {
  if (!dateStr || dateStr === 'unscheduled') return 'Χωρίς μέρα';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatLongGreekDate(dateStr) {
  if (!dateStr || dateStr === 'unscheduled') return 'Χωρίς μέρα';
  const d = new Date(`${dateStr}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return formatGreekDate(dateStr);
  return d.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function appointmentsOnDate(dateStr) {
  return allAppointments.filter(item => {
    if (item.date !== dateStr) return false;
    return item.status !== 'BLOCKED' && item.status !== 'REJECTED' && item.status !== 'CANCELLED';
  });
}

function paintMonthDayCounts() {
  const cells = document.querySelectorAll('#calendar .fc-daygrid-day');
  const show = calendar && isPhoneDayGrid(calendar.view.type);
  cells.forEach(cell => {
    const badge = cell.querySelector('.month-day-count');
    if (!show) {
      if (badge) badge.remove();
      cell.classList.remove('has-month-count');
      return;
    }
    const n = appointmentsOnDate(cell.getAttribute('data-date')).length;
    if (!n) {
      if (badge) badge.remove();
      cell.classList.remove('has-month-count');
      return;
    }
    let mark = badge;
    if (!mark) {
      mark = document.createElement('span');
      mark.className = 'month-day-count';
      const frame = cell.querySelector('.fc-daygrid-day-frame') || cell;
      frame.appendChild(mark);
    }
    mark.textContent = String(n);
    cell.classList.add('has-month-count');
  });
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
}

function renderTodayList() {
  const today = todayISO();
  document.getElementById('todayDateLabel').textContent = formatGreekDate(today);
  const rows = allAppointments
    .filter(item => item.date === today && item.status !== 'BLOCKED')
    .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));

  const list = document.getElementById('todayList');
  if (!rows.length) {
    list.innerHTML = '<p class="today-empty">Δεν υπάρχουν ραντεβού για σήμερα.</p>';
    return;
  }

  list.innerHTML = rows.map(item => `
    <button type="button" class="apt-row" data-id="${escapeHtml(item.id)}">
      <div>
        <div style="font-weight:600;">${escapeHtml(appointmentTimeLabel(item))} · ${escapeHtml(item.customer_name || 'Χωρίς όνομα')}</div>
        <div class="apt-row-meta">
          ${escapeHtml(item.service_name || '-')}
          ${item.customer_phone ? ' · <a href="tel:' + escapeHtml(item.customer_phone) + '" onclick="event.stopPropagation()">' + escapeHtml(item.customer_phone) + '</a>' : ''}
        </div>
      </div>
      <div style="display:flex; gap:0.35rem; flex-wrap:wrap; justify-content:flex-end;">${statusBadge(item)}</div>
    </button>
  `).join('');

  list.querySelectorAll('.apt-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const found = allAppointments.find(a => a.id === btn.getAttribute('data-id'));
      openAppointmentDetails(found);
    });
  });
}

function statusBadge(item) {
  const past = isPastAppointment(item);
  let cls = 'badge-booked';
  if (item.status === 'PENDING') cls = 'badge-pending';
  if (item.status === 'WAITLIST') cls = 'badge-waitlist';
  if (item.status === 'BLOCKED') cls = 'badge-blocked';
  if (item.status === 'REJECTED') cls = 'badge-rejected';
  if (item.status === 'CANCELLED') cls = 'badge-cancelled';
  const bits = [`<span class="badge ${cls}">${statusLabel(item.status)}</span>`];
  if (past) bits.push('<span class="badge badge-past">Παρελθόν</span>');
  if (item.proposed_date && item.propose_token) {
    bits.push(`<span class="badge badge-pending">Πρόταση ${escapeHtml(formatGreekDate(item.proposed_date))} ${escapeHtml((item.proposed_start_time || '').slice(0, 5))}</span>`);
  }
  return bits.join(' ');
}

function appointmentsForKind(kind) {
  return allAppointments.filter(item => {
    if (kind === 'unscheduled') {
      return isActiveBucketItem(item);
    }
    if (kind === 'all') return item.status !== 'BLOCKED';
    if (kind === 'pending') {
      return !isUnscheduled(item) && (item.status === 'PENDING' || item.status === 'WAITLIST');
    }
    if (kind === 'booked') {
      return (item.status === 'BOOKED' || item.status === 'CONFIRMED') && !isPastAppointment(item);
    }
    if (kind === 'history') {
      if (item.status === 'BLOCKED' || item.status === 'PENDING' || item.status === 'WAITLIST') return false;
      return item.status === 'REJECTED' || item.status === 'CANCELLED' || isPastAppointment(item);
    }
    return true;
  });
}

function foldSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ')
    .replace(/[ϊΐ]/g, 'ι')
    .replace(/[ϋΰ]/g, 'υ');
}

function matchesQuery(item, q) {
  if (!q) return true;
  const hay = foldSearch([item.customer_name, item.customer_phone, item.instagram, item.service_name, item.notes, item.date].join(' '));
  const needle = foldSearch(q);
  if (!searchRelaxed) return hay.includes(needle);
  return needle.split(/\s+/).filter(Boolean).every((part) => hay.includes(part));
}

function syncSearchModeBtn(show) {
  const input = document.getElementById('listSearch');
  const btn = document.getElementById('searchModeBtn');
  if (!input || !btn) return;
  if (show === true) {
    btn.hidden = false;
    return;
  }
  const apply = () => {
    const active = document.activeElement;
    btn.hidden = active !== input && active !== btn;
  };
  if (show === false) {
    setTimeout(apply, 0);
    return;
  }
  apply();
}

function toggleSearchMode() {
  searchRelaxed = !searchRelaxed;
  const btn = document.getElementById('searchModeBtn');
  if (btn) {
    btn.classList.toggle('is-on', searchRelaxed);
    btn.setAttribute('aria-pressed', searchRelaxed ? 'true' : 'false');
  }
  renderAppointmentList();
}

function openAppointmentList(kind) {
  if (kind === 'pending') {
    const pill = document.getElementById('pendingNew');
    if (pill) pill.hidden = true;
  }
  currentListKind = kind;
  const titles = {
    all: 'Συνολικά ραντεβού',
    pending: 'Εκκρεμή ραντεβού',
    booked: 'Εγκεκριμένα ραντεβού',
    history: 'Ιστορικό ραντεβού',
    unscheduled: 'Χωρίς μέρα'
  };
  const subtitles = {
    all: 'Όλα τα ραντεβού της επιχείρησης, χωρίς τα κλειστά slots.',
    pending: 'Αιτήματα που περιμένουν έγκριση.',
    booked: 'Μόνο μελλοντικά εγκεκριμένα.',
    history: 'Παρελθόντα, απορριφθέντα και ακυρωμένα.',
    unscheduled: 'Εσωτερική λίστα — σβήνεις ό,τι θες χωρίς ενημέρωση πελάτη. Όταν πατήσεις «Βάλε σε μέρα», στέλνεται email αν υπάρχει.'
  };
  document.getElementById('listTitle').textContent = titles[kind] || 'Ραντεβού';
  document.getElementById('listSubtitle').textContent = subtitles[kind] || '';
  document.getElementById('listSearch').value = '';
  syncSearchModeBtn();
  document.getElementById('listStatusFilter').value = '';
  document.getElementById('listStatusFilter').style.display = kind === 'pending' || kind === 'booked' || kind === 'unscheduled' ? 'none' : 'block';
  const addBucketBtn = document.getElementById('listAddBucketBtn');
  if (addBucketBtn) addBucketBtn.hidden = kind !== 'unscheduled';
  openModal('listModal');
  renderAppointmentList();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAppointmentList() {
  const q = (document.getElementById('listSearch').value || '').trim();
  const status = document.getElementById('listStatusFilter').value;
  const dayDir = currentListKind === 'booked' || currentListKind === 'pending' ? 1 : -1;
  const showBadge = currentListKind === 'all' || currentListKind === 'history';
  const rows = appointmentsForKind(currentListKind)
    .filter(item => !status || item.status === status)
    .filter(item => matchesQuery(item, q))
    .sort((a, b) => {
      const byDay = String(a.date || '').localeCompare(String(b.date || '')) * dayDir;
      if (byDay) return byDay;
      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });

  const list = document.getElementById('aptList');
  if (!rows.length) {
    list.innerHTML = '<div class="list-empty">Δεν βρέθηκαν ραντεβού.</div>';
    syncBulkBar();
    return;
  }

  const groups = [];
  rows.forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last.date !== item.date) groups.push({ date: item.date, items: [item] });
    else last.items.push(item);
  });

  const bucketList = currentListKind === 'unscheduled';
  list.innerHTML = groups.map((group) => `
    <section class="apt-day-group">
      <h3 class="apt-day">${escapeHtml(formatLongGreekDate(group.date))} · ${group.items.length}</h3>
      ${group.items.map((item) => `
        <div class="apt-row${bucketList ? ' apt-row-bucket' : ''}" data-id="${escapeHtml(item.id)}">
          ${bucketList ? '' : `<input type="checkbox" class="bulk-check" data-id="${escapeHtml(item.id)}" onclick="event.stopPropagation(); syncBulkBar()">`}
          <div class="apt-time${isUnscheduled(item) ? ' is-bucket' : ''}">${escapeHtml(isUnscheduled(item) ? appointmentTimeLabel(item) : appointmentTimeLabel(item).slice(0, 5))}</div>
          <button type="button" class="apt-row-main">
            <div style="font-weight:650;">
              <span class="client-name-btn" data-phone="${escapeHtml(item.customer_phone || '')}">${escapeHtml(item.customer_name || 'Χωρίς όνομα')}</span>
            </div>
            <div class="apt-row-meta">
              ${escapeHtml(item.service_name || '-')}
              ${item.customer_phone ? ' · ' + escapeHtml(item.customer_phone) : ''}
            </div>
          </button>
          ${bucketList ? `<button type="button" class="btn btn-quiet-danger apt-bucket-del" data-del-id="${escapeHtml(item.id)}" title="Διαγραφή από bucket" aria-label="Διαγραφή"><i data-lucide="trash-2" size="16"></i></button>` : ''}
          ${showBadge ? `<div class="apt-badges">${statusBadge(item)}</div>` : ''}
        </div>
      `).join('')}
    </section>
  `).join('');

  list.querySelectorAll('.apt-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.bulk-check')) return;
      if (e.target.closest('.apt-bucket-del')) {
        e.stopPropagation();
        deleteAppointmentById(e.target.closest('.apt-bucket-del').getAttribute('data-del-id'));
        return;
      }
      if (e.target.closest('.client-name-btn') && !bucketList) {
        e.stopPropagation();
        openClientDrawer(e.target.getAttribute('data-phone'), e.target.textContent);
        return;
      }
      const found = allAppointments.find(a => a.id === row.getAttribute('data-id'));
      openAppointmentDetails(found);
    });
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
  syncBulkBar();
}

function statusLabel(status) {
  const labels = { BOOKED: 'Εγκεκριμένο', PENDING: 'Εκκρεμές', WAITLIST: 'Ουρά', BLOCKED: 'Κλειδωμένο', REJECTED: 'Απορρίφθηκε', CONFIRMED: 'Εγκεκριμένο', CANCELLED: 'Ακυρώθηκε' };
  return labels[status] || status;
}

// [SECTION: JS-ACTIONS] — overlap προτάσεις, reschedule, CANCELLED ≠ REJECTED
function hideOverlapBox() {
  const box = document.getElementById('overlapBox');
  if (box) box.style.display = 'none';
}

function showOverlapBox(message, suggestions, onPick) {
  const box = document.getElementById('overlapBox');
  document.getElementById('overlapText').textContent = message + (suggestions && suggestions.length ? ' Κοντινές διαθέσιμες ώρες:' : '');
  const wrap = document.getElementById('overlapSuggestions');
  wrap.innerHTML = (suggestions || []).map((slot) =>
    `<button type="button" class="btn btn-outline" data-slot="${escapeHtml(slot)}">${escapeHtml(slot)}</button>`
  ).join('');
  wrap.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => onPick(btn.getAttribute('data-slot'));
  });
  box.style.display = 'block';
}

function openAppointmentDetails(item) {
  if (!item) return;
  selectedEventId = item.id;
  hideOverlapBox();

  if (isUnscheduled(item)) {
    document.getElementById('actTitle').textContent = item.customer_name || 'Χωρίς όνομα';
    document.getElementById('actDetails').innerHTML = `
      <div>
        <p class="guide-note" style="margin-top:0;">Εσωτερικό bucket — διέγραψέ το όποτε θες χωρίς ενημέρωση πελάτη. Email πάει μόνο όταν μπει στο πρόγραμμα.</p>
        <div class="detail-row"><span class="detail-k">Τηλέφωνο</span> <strong class="detail-v">${escapeHtml(item.customer_phone || '-')}</strong></div>
        <div class="form-group" style="margin:0.55rem 0 0;">
          <label for="bucketServiceSelect">Υπηρεσία</label>
          <select class="field" id="bucketServiceSelect">${bucketServiceOptionsHtml(item.service_name, item.duration)}</select>
          <p class="muted" style="margin:0.35rem 0 0;">Μπορείς να την αλλάξεις πριν το βάλεις σε μέρα.</p>
        </div>
        <div class="form-group" style="margin:0.75rem 0 0;">
          <label for="bucketCustomerEmail">Email πελάτη (προαιρετικό)</label>
          <input class="field" type="email" id="bucketCustomerEmail" value="${escapeHtml(item.customer_email || '')}" placeholder="για επιβεβαίωση όταν μπει στο πρόγραμμα" maxlength="120">
          <p class="muted" style="margin:0.35rem 0 0;">Αν δεν έχει email, ενημέρωσέ τον κατ’ ιδίαν (τηλ./μήνυμα) αφού το βάλεις σε μέρα.</p>
        </div>
      </div>
    `;
    const rescheduleHint = document.getElementById('rescheduleHint');
    if (rescheduleHint) rescheduleHint.textContent = 'Διάλεξε μέρα και ώρα για να μπει στο ημερολόγιο.';
    document.getElementById('rescheduleDate').value = '';
    document.getElementById('rescheduleTime').value = '';
    const immediateBox = document.getElementById('rescheduleImmediate');
    if (immediateBox) {
      immediateBox.checked = true;
      const immLabel = immediateBox.closest('label');
      if (immLabel) immLabel.style.display = 'none';
    }
    document.getElementById('btnApprove').style.display = 'none';
    document.getElementById('btnReject').style.display = 'none';
    document.getElementById('btnCancelAppt').style.display = 'none';
    const captureBtn = document.getElementById('btnHoldCapture');
    const refundBtn = document.getElementById('btnHoldRefund');
    if (captureBtn) captureBtn.style.display = 'none';
    if (refundBtn) refundBtn.style.display = 'none';
    document.getElementById('reasonGroup').style.display = 'none';
    document.getElementById('actReason').value = '';
    document.getElementById('rescheduleGroup').style.display = 'grid';
    const rescheduleBtn = document.getElementById('btnReschedule');
    rescheduleBtn.style.display = 'inline-flex';
    rescheduleBtn.innerHTML = '<i data-lucide="calendar-plus" size="16"></i> Βάλε σε μέρα';
    const deleteBtn = document.getElementById('btnDeleteAppt');
    deleteBtn.style.display = 'inline-flex';
    deleteBtn.innerHTML = '<i data-lucide="trash-2" size="16"></i> Διαγραφή';
    openModal('actionModal');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const pastNote = isPastAppointment(item)
    ? '<div class="detail-row"><span class="detail-k">Ετικέτα</span> <strong class="detail-v">Παρελθόν</strong></div>'
    : '';

  const waitlistNote = item.status === 'WAITLIST'
    ? '<p class="guide-note">Ουρά ακύρωσης — δεν κλείνει ώρα. Επικοινώνησε και όρισε εσύ πότε βολεύει.</p>'
    : '';
  const requestNote = item.status === 'PENDING' && currentTenantData && currentTenantData.intake_mode === 'request'
    ? '<p class="guide-note">Προτιμώμενη ώρα. Επικοινώνησε με τον πελάτη πριν την έγκριση.</p>'
    : '';

  document.getElementById('actTitle').innerHTML = item.status === 'BLOCKED'
    ? escapeHtml(blockedLabel(item))
    : `<button type="button" class="client-name-btn" onclick="openClientDrawer('${jsString(item.customer_phone || '')}', '${jsString(item.customer_name || '')}')">${escapeHtml(item.customer_name || 'Ραντεβού')}</button>`;
  document.getElementById('actDetails').innerHTML = `
    <div>
      <div class="detail-row"><span class="detail-k">Ημερομηνία</span> <strong class="detail-v">${escapeHtml(formatGreekDate(item.date))}</strong></div>
      <div class="detail-row"><span class="detail-k">Τηλέφωνο</span> <strong class="detail-v">${escapeHtml(item.customer_phone || '-')}</strong></div>
      <div class="detail-row"><span class="detail-k">Email</span> <strong class="detail-v">${escapeHtml(item.customer_email || '-')}</strong></div>
      ${item.instagram ? `<div class="detail-row"><span class="detail-k">${escapeHtml(extraFieldTitle())}</span> <strong class="detail-v">${escapeHtml(item.instagram)}</strong></div>` : ''}
      <div class="detail-row"><span class="detail-k">Υπηρεσία</span> <strong class="detail-v">${escapeHtml(item.service_name || '-')}</strong></div>
      <div class="detail-row"><span class="detail-k">Ώρα</span> <strong class="detail-v">${waitlistNeedsTime(item) ? 'χωρίς συγκεκριμένη ώρα' : `${item.start_time || '-'} – ${item.end_time || '-'}`}</strong></div>
      ${item.proposed_date && item.propose_token ? `<div class="detail-row"><span class="detail-k">Πρόταση</span> <strong class="detail-v">${escapeHtml(formatGreekDate(item.proposed_date))} · ${escapeHtml((item.proposed_start_time || '').slice(0, 5))} (εκκρεμεί αποδοχή)</strong></div>` : ''}
      <div class="detail-row"><span class="detail-k">Κατάσταση</span> <strong class="detail-v">${statusLabel(item.status)}</strong></div>
      ${holdLabel(item.hold_status, item) ? `<div class="detail-row"><span class="detail-k">Κάρτα</span> <strong class="detail-v">${escapeHtml(holdLabel(item.hold_status, item))}${item.hold_cents ? ` · ${(Number(item.hold_cents) / 100).toFixed(2)}€` : ''}</strong></div>` : ''}
      ${pastNote}
      ${waitlistNote}
      ${requestNote}
    </div>
  `;
  const rescheduleHint = document.getElementById('rescheduleHint');
  if (rescheduleHint) {
    rescheduleHint.textContent = needsDayOrTime(item)
      ? 'Διάλεξε σε ποια μέρα και ώρα θα μπει αυτό το ραντεβού.'
      : 'Διάλεξε νέα ημερομηνία και ώρα. Θα σταλεί πρόταση στον πελάτη με σύνδεσμο αποδοχής (ή εφάρμοσε άμεσα αν συμφωνήσατε στο τηλέφωνο).';
  }
  document.getElementById('rescheduleDate').value = item.proposed_date || item.date || '';
  document.getElementById('rescheduleTime').value = item.proposed_start_time || item.start_time || '';
  const immediateBox = document.getElementById('rescheduleImmediate');
  if (immediateBox) {
    immediateBox.checked = waitlistNeedsTime(item);
    const immLabel = immediateBox.closest('label');
    if (immLabel) immLabel.style.display = '';
  }
  const past = isPastAppointment(item);
  const actionable = item.status === 'PENDING' || item.status === 'WAITLIST';
  const approved = item.status === 'BOOKED' || item.status === 'CONFIRMED';
  const historyItem = past || item.status === 'REJECTED' || item.status === 'CANCELLED';
  document.getElementById('btnApprove').style.display = (item.status === 'BLOCKED' || approved || item.status === 'CANCELLED' || item.status === 'REJECTED') ? 'none' : 'inline-flex';
  document.getElementById('btnReject').style.display = actionable && !past ? 'inline-flex' : 'none';
  document.getElementById('btnCancelAppt').style.display = approved && !past ? 'inline-flex' : 'none';
  const hold = item.hold_status || '';
  const captureBtn = document.getElementById('btnHoldCapture');
  const refundBtn = document.getElementById('btnHoldRefund');
  if (captureBtn) captureBtn.style.display = hold === 'authorized' ? 'inline-flex' : 'none';
  if (refundBtn) refundBtn.style.display = hold === 'captured' ? 'inline-flex' : 'none';
  const deleteBtn = document.getElementById('btnDeleteAppt');
  deleteBtn.style.display = canDeleteAppointment(item) ? 'inline-flex' : 'none';
  deleteBtn.innerHTML = historyItem
    ? '<i data-lucide="trash-2" size="16"></i> Διαγραφή'
    : '<i data-lucide="trash-2" size="16"></i> Διαγραφή οριστικά';
  const canReschedule = item.status !== 'BLOCKED' && !past;
  document.getElementById('rescheduleGroup').style.display = 'none';
  const rescheduleBtn = document.getElementById('btnReschedule');
  rescheduleBtn.style.display = canReschedule ? 'inline-flex' : 'none';
  rescheduleBtn.innerHTML = waitlistNeedsTime(item)
    ? '<i data-lucide="calendar-plus" size="16"></i> Βάλε σε μέρα'
    : '<i data-lucide="clock" size="16"></i> Αλλαγή ώρας';
  document.getElementById('reasonGroup').style.display = (actionable || (approved && !past)) ? 'block' : 'none';
  document.getElementById('actReason').value = item.status_reason || '';
  openModal('actionModal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function jsString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function withLock(fn) {
  if (actionLock) return;
  actionLock = true;
  try {
    await fn();
  } finally {
    actionLock = false;
  }
}

async function updateStatus(status, extra) {
  await withLock(async () => {
    const reason = (document.getElementById('actReason').value || '').trim();
    const current = allAppointments.find((a) => a.id === selectedEventId);
    if (status === 'BOOKED' && needsDayOrTime(current)) {
      showToast('Πρώτα βάλε μέρα και ώρα, μετά έγκρινε.', true);
      document.getElementById('rescheduleGroup').style.display = 'grid';
      const rescheduleBtn = document.getElementById('btnReschedule');
      rescheduleBtn.innerHTML = '<i data-lucide="check" size="16"></i> Αποθήκευση μέρας';
      lucide.createIcons();
      return;
    }
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEventId, status, reason, ...(extra || {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.overlap) {
        showOverlapBox(data.error || 'Το slot είναι κατειλημμένο.', data.suggestions || [], async (slot) => {
          document.getElementById('rescheduleTime').value = slot;
          await rescheduleAppointment(slot);
          await updateStatus('BOOKED');
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Σφάλμα ενημέρωσης');
      closeModal('actionModal');
      lastUndo = current ? { type: 'status', id: current.id, status: current.status } : null;
      showToast(status === 'CANCELLED' ? 'Το ραντεβού ακυρώθηκε.' : 'Η κατάσταση ενημερώθηκε.', false, true);
      fetchAppointments();
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast(e.message || 'Σφάλμα ενημέρωσης.', true);
    }
  });
}

function holdLabel(status, item) {
  if (status === 'captured' && item && item.pay_mode === 'online') return 'Πληρωμένη online';
  return {
    awaiting_card: 'Αναμονή κάρτας',
    authorized: 'Εγγύηση κράτησης',
    card_saved: 'Κάρτα εγγύησης αποθηκευμένη',
    captured: 'Εγγύηση χρεωμένη',
    released: 'Εγγύηση αποδεσμευμένη',
    refunded: 'Επιστράφηκε',
    failed: 'Η εγγύηση απέτυχε'
  }[status] || '';
}

async function settleHold(action) {
  await withLock(async () => {
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEventId, action })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Η κάρτα δεν ενημερώθηκε.');
      closeModal('actionModal');
      const text = action === 'refund' ? 'Η επιστροφή καταχωρήθηκε.' : (action === 'capture' ? 'Η εγγύηση χρεώθηκε.' : 'Η εγγύηση αποδεσμεύτηκε.');
      showToast(text);
      fetchAppointments();
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message || 'Η κάρτα δεν ενημερώθηκε.', true);
    }
  });
}

function paymentRows() {
  return (allAppointments || []).filter((item) => {
    const hold = String(item.hold_status || '');
    return hold && hold !== 'none' && hold !== 'awaiting_card';
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.start_time || '').localeCompare(String(a.start_time || '')));
}

function openPaymentsModal() {
  const filter = document.getElementById('paymentsFilter');
  if (filter) filter.value = 'all';
  renderPaymentsList();
  openModal('paymentsModal');
  lucide.createIcons();
}

function renderPaymentsList() {
  const wrap = document.getElementById('paymentsList');
  if (!wrap) return;
  const filter = (document.getElementById('paymentsFilter') || {}).value || 'all';
  let rows = paymentRows();
  if (filter !== 'all') rows = rows.filter((item) => item.hold_status === filter);
  if (!rows.length) {
    wrap.innerHTML = '<p class="guide-note">Δεν υπάρχουν ακόμη κινήσεις κάρτας.</p>';
    return;
  }
  wrap.innerHTML = rows.map((item) => {
    const amount = item.hold_cents ? `${(Number(item.hold_cents) / 100).toFixed(2)}€` : '—';
    const mode = item.pay_mode === 'online' ? 'Online' : (item.pay_mode === 'shop' ? 'Κατάστημα' : '');
    return `<button type="button" class="apt-row payment-row" onclick="openPaymentAppointment('${jsString(item.id)}')">
      <div>
        <strong>${escapeHtml(item.customer_name || 'Πελάτης')}</strong>
        <div style="color:var(--text-muted);font-size:0.82rem;margin-top:0.15rem;">${escapeHtml(formatGreekDate(item.date))} · ${escapeHtml(item.start_time || '')} · ${escapeHtml(item.service_name || '')}</div>
      </div>
      <div class="payment-meta">
        <span>${escapeHtml(holdLabel(item.hold_status, item))}</span>
        <strong>${escapeHtml(amount)}</strong>
        ${mode ? `<span class="payment-mode">${escapeHtml(mode)}</span>` : ''}
      </div>
    </button>`;
  }).join('');
}

function openPaymentAppointment(id) {
  closeModal('paymentsModal');
  const item = (allAppointments || []).find((row) => row.id === id);
  if (item) openAppointmentDetails(item);
}

async function exportPaymentsCsv() {
  const from = (document.getElementById('paymentsExportFrom') || {}).value || '';
  const to = (document.getElementById('paymentsExportTo') || {}).value || '';
  const params = new URLSearchParams({ format: 'csv', mode: 'accountant', by: 'settled' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/payments/export?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Η εξαγωγή απέτυχε');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${currentBusinessCode || 'shop'}-${from || 'all'}-${to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Η εξαγωγή για λογιστή κατέβηκε.');
  } catch (e) {
    if (e.message !== 'Unauthorized') showToast(e.message || 'Η εξαγωγή απέτυχε.', true);
  }
}

function forceApprove() {
  hideOverlapBox();
  updateStatus('BOOKED', { force: true });
}

function toggleRescheduleEditor() {
  const group = document.getElementById('rescheduleGroup');
  const current = allAppointments.find((a) => a.id === selectedEventId);
  if (group.style.display === 'grid') {
    rescheduleAppointment();
    return;
  }
  group.style.display = 'grid';
  document.getElementById('btnReschedule').innerHTML = needsDayOrTime(current)
    ? '<i data-lucide="calendar-plus" size="16"></i> Βάλε σε μέρα'
    : '<i data-lucide="check" size="16"></i> Αποστολή πρότασης';
  lucide.createIcons();
}

async function rescheduleAppointment(forcedTime) {
  await withLock(async () => {
    const date = document.getElementById('rescheduleDate').value;
    const time = forcedTime || document.getElementById('rescheduleTime').value;
    if (!date || !time) {
      showToast('Συμπληρώστε ημερομηνία και ώρα.', true);
      return;
    }
    const current = allAppointments.find((a) => a.id === selectedEventId);
    const wasBucket = current && isUnscheduled(current);
    const immediate = document.getElementById('rescheduleImmediate')?.checked === true
      || needsDayOrTime(current);
    const bucketEmail = (document.getElementById('bucketCustomerEmail')?.value || '').trim();
    const bucketService = wasBucket ? selectedBucketService() : null;
    try {
      const payload = {
        id: selectedEventId,
        date,
        time: time.length === 5 ? time : time.slice(0, 5),
        immediate
      };
      if (wasBucket && bucketEmail) payload.email = bucketEmail;
      if (bucketService && bucketService.service_name) {
        payload.service_name = bucketService.service_name;
        payload.duration = bucketService.duration;
      }
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.overlap) {
        showOverlapBox(data.error || 'Το slot είναι κατειλημμένο.', data.suggestions || [], (slot) => {
          document.getElementById('rescheduleTime').value = slot;
          rescheduleAppointment(slot);
        });
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Σφάλμα αλλαγής ώρας');
      hideOverlapBox();
      if (data.mode === 'proposed') {
        showToast(data.email_sent
          ? 'Στάλθηκε πρόταση στον πελάτη για αποδοχή.'
          : 'Η πρόταση αποθηκεύτηκε (το email δεν στάλθηκε).');
      } else if (wasBucket || data.from_bucket) {
        if (data.email_sent) {
          showToast('Μπήκε στο ημερολόγιο · στάλθηκε email επιβεβαίωσης στον πελάτη.');
        } else if (data.email_error === 'missing_email') {
          showToast('Μπήκε στο ημερολόγιο. Δεν υπάρχει email πελάτη — ενημέρωσέ τον κατ’ ιδίαν ή βάλε email και ξαναπρογραμμάτισε.', true);
        } else {
          showToast('Μπήκε στο ημερολόγιο. Το email επιβεβαίωσης δεν στάλθηκε — ενημέρωσε τον πελάτη κατ’ ιδίαν αν χρειάζεται.', true);
        }
      } else {
        showToast(data.email_sent ? 'Η ώρα ενημερώθηκε · ενημερώθηκε ο πελάτης με email.' : 'Η ώρα ενημερώθηκε.');
      }
      document.getElementById('rescheduleGroup').style.display = 'none';
      document.getElementById('btnReschedule').innerHTML = '<i data-lucide="clock" size="16"></i> Αλλαγή ώρας';
      lucide.createIcons();
      await fetchAppointments();
      const found = (allAppointments || []).find((a) => a.id === selectedEventId);
      if (found && data.mode === 'applied') {
        found.date = date;
        found.start_time = time.length === 5 ? time : time.slice(0, 5);
        found.proposed_date = null;
        found.proposed_start_time = null;
        found.propose_token = null;
        if (wasBucket) {
          found.status = 'BOOKED';
          if (bucketService && bucketService.service_name) {
            found.service_name = bucketService.service_name;
            found.duration = bucketService.duration;
          }
        }
      }
      // Από bucket → κανονικό συμβάν: κλείσε την απλή κάρτα.
      if ((wasBucket || data.from_bucket) && data.mode === 'applied') {
        closeModal('actionModal');
        if (currentListKind === 'unscheduled' && isOverlayVisible('modal', 'listModal')) {
          renderAppointmentList();
        }
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast(e.message || 'Σφάλμα αλλαγής ώρας.', true);
    }
  });
}

async function deleteAppointmentById(id) {
  selectedEventId = id;
  await deleteAppointment();
}

async function deleteAppointment() {
  const current = allAppointments.find((a) => a.id === selectedEventId);
  const fromBucket = current && isUnscheduled(current);
  // Bucket: χωρίς ενημέρωση πελάτη. Τα υπόλοιπα κρατάνε confirm.
  if (!fromBucket && !confirm('Διαγραφή ραντεβού; Μπορείτε να αναιρέσετε αμέσως μετά.')) return;
  await withLock(async () => {
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedEventId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Σφάλμα διαγραφής');
      closeModal('actionModal');
      lastUndo = current ? { type: 'delete', id: current.id, snapshot: current } : null;
      showToast(fromBucket ? 'Διαγράφηκε από το bucket.' : 'Το ραντεβού διαγράφηκε.', false, !fromBucket);
      await fetchAppointments();
      if (fromBucket && currentListKind === 'unscheduled' && isOverlayVisible('modal', 'listModal')) {
        renderAppointmentList();
      }
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast(e.message || 'Σφάλμα διαγραφής.', true);
    }
  });
}

async function restoreAppointment(snapshot) {
  if (!snapshot || !snapshot.id) return;
  await restoreAppointments([snapshot], 'Η διαγραφή αναιρέθηκε.');
}

async function restoreAppointments(snapshots, message) {
  const rows = (snapshots || []).filter((snapshot) => snapshot && snapshot.id);
  if (!rows.length) return;
  await withLock(async () => {
    try {
      for (const snapshot of rows) {
        const res = await adminFetch(`/api/${currentBusinessCode}/admin/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Σφάλμα αναίρεσης');
      }
      selectedEventId = rows[0].id;
      showToast(message || 'Η διαγραφή αναιρέθηκε.');
      await fetchAppointments();
    } catch (e) {
      if (e.message !== 'Unauthorized') showToast(e.message || 'Σφάλμα αναίρεσης.', true);
    }
  });
}

async function handleManualBooking(e) {
  e.preventDefault();
  const selectedOpt = document.getElementById('massageType').selectedOptions[0];
  const duration = parseInt(selectedOpt.getAttribute('data-duration')) || 60;
  const unscheduled = !!document.getElementById('bookUnscheduled')?.checked;
  const time = `${document.getElementById('bookHour').value}:${document.getElementById('bookMinute').value}`;

  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('custName').value.trim(),
        phone: document.getElementById('custPhone').value.trim(),
        service_name: document.getElementById('massageType').value,
        duration: duration,
        unscheduled,
        date: unscheduled ? '' : document.getElementById('bookDate').value,
        time: unscheduled ? '' : time
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Αποτυχία κράτησης');
    closeModal('bookingModal');
    closeModal('slotChoiceModal');
    e.target.reset();
    syncBookUnscheduledFields();
    showToast(unscheduled ? 'Μπήκε στο bucket «Χωρίς μέρα».' : 'Το νέο ραντεβού προστέθηκε.');
    fetchAppointments();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

async function handleBlockSlot(e) {
  e.preventDefault();
  const start = `${document.getElementById('blockStartHour').value}:${document.getElementById('blockStartMin').value}`;
  const end = `${document.getElementById('blockEndHour').value}:${document.getElementById('blockEndMin').value}`;
  if (!document.getElementById('blockStartHour').value || !document.getElementById('blockEndHour').value || end <= start) {
    showToast('Η ώρα λήξης πρέπει να είναι μετά την έναρξη.', true);
    return;
  }

  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/block-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: document.getElementById('blockDate').value,
        start_time: start,
        end_time: end,
        reason: document.getElementById('blockReason').value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Αποτυχία κλεισίματος ωρών');
    closeModal('blockModal');
    closeModal('slotChoiceModal');
    e.target.reset();
    showToast('Οι ώρες κλειδώθηκαν.');
    fetchAppointments();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

function billingStatusText(data) {
  const end = data.billing_period_end ? new Date(data.billing_period_end) : null;
  const until = end && !Number.isNaN(end.getTime())
    ? end.toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const plan = data.billing_plan === 'year'
    ? 'ετήσια'
    : (data.billing_plan === 'month'
      ? 'μηνιαία'
      : (data.billing_plan === 'lifetime' ? 'εφάπαξ' : ''));
  if (data.billing_plan === 'lifetime' && (data.billing_status === 'active' || data.billing_exempt === true)) {
    return 'Έχεις εφάπαξ άδεια (μία φορά). Δεν χρειάζεται μηνιαία συνδρομή.';
  }
  if (data.billing_status === 'active' || data.billing_status === 'trialing') {
    return `Η συνδρομή είναι ενεργή${plan ? ' (' + plan + ')' : ''}${until ? '. Ισχύει ως ' + until : ''}.`;
  }
  if (data.billing_status === 'past_due') {
    const warn = data.billing_warning;
    if (warn && warn.days_left != null && warn.days_left > 0) {
      return `Η πληρωμή εκκρεμεί. Η σελίδα κρατήσεων μένει ανοιχτή για ${warn.days_left} ακόμη μέρες.`;
    }
    return 'Η πληρωμή εκκρεμεί. Η σελίδα κρατήσεων μένει ανοιχτή για λίγο ακόμα.';
  }
  if (data.billing_status === 'unpaid') {
    return data.billing_hold
      ? 'Η συνδρομή είναι απλήρωτη. Η σελίδα κρατήσεων είναι κλειστή.'
      : 'Η συνδρομή είναι απλήρωτη. Τακτοποίησε την πληρωμή πριν κλείσει η φόρμα.';
  }
  if (data.billing_status === 'canceled') {
    return data.billing_hold
      ? 'Η συνδρομή ακυρώθηκε. Η σελίδα κρατήσεων είναι κλειστή.'
      : 'Η συνδρομή ακυρώθηκε. Υπάρχει ακόμα περίοδος χάριτος πριν κλείσει η φόρμα.';
  }
  return 'Διάλεξε μηνιαία ή ετήσια συνδρομή. Η τιμή φαίνεται στη σελίδα πληρωμής.';
}

let platformNoticeOkStep = 0;

function renderPlatformBanners() {
  const noticeEl = document.getElementById('platformNotice');
  const warnEl = document.getElementById('billingWarnBanner');
  if (!currentTenantData) {
    if (noticeEl) noticeEl.hidden = true;
    if (warnEl) warnEl.hidden = true;
    return;
  }
  const notice = currentTenantData.admin_notice;
  if (noticeEl) {
    if (notice && notice.body) {
      document.getElementById('platformNoticeBody').textContent = notice.body;
      document.getElementById('platformNoticeSign').textContent = notice.signature || 'QuickBook';
      document.getElementById('platformNoticeContact').textContent = notice.contact || '';
      platformNoticeOkStep = 0;
      noticeEl.classList.remove('confirming');
      const hint = document.getElementById('platformNoticeHint');
      const btn = document.getElementById('platformNoticeOk');
      if (hint) hint.textContent = 'Πάτα ΟΚ δύο φορές για επιβεβαίωση.';
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'ΟΚ';
      }
      noticeEl.hidden = false;
      const noticeKey = `notice:${notice.updated_at || ''}:${String(notice.body).slice(0, 80)}`;
      revealAdminMessage(noticeEl, noticeKey);
    } else {
      noticeEl.hidden = true;
      platformNoticeOkStep = 0;
    }
  }
  if (warnEl) {
    const warn = currentTenantData.billing_warning;
    if (currentTenantData.billing_enabled && warn) {
      const title = document.getElementById('billingWarnTitle');
      const text = document.getElementById('billingWarnText');
      if (warn.held) {
        title.textContent = 'Η δημόσια φόρμα κρατήσεων είναι κλειστή';
        text.textContent = 'Η συνδρομή δεν είναι πληρωμένη. Τακτοποίησε την πληρωμή από τις ρυθμίσεις ή επικοινώνησε με την υποστήριξη.';
      } else if (warn.days_left != null && warn.days_left > 0) {
        title.textContent = 'Προσοχή: πρόβλημα πληρωμής συνδρομής';
        text.textContent = `Έχεις ακόμη περίπου ${warn.days_left} μέρες. Μετά η δημόσια σελίδα κρατήσεων θα κλείσει αυτόματα μέχρι να τακτοποιηθεί η πληρωμή.`;
      } else {
        title.textContent = 'Προσοχή: πρόβλημα πληρωμής συνδρομής';
        text.textContent = 'Η περίοδος χάριτος τελειώνει. Τακτοποίησε την πληρωμή για να μην κλείσει η φόρμα.';
      }
      warnEl.hidden = false;
    } else {
      warnEl.hidden = true;
    }
  }
}

async function confirmPlatformNotice() {
  const noticeEl = document.getElementById('platformNotice');
  const hint = document.getElementById('platformNoticeHint');
  const btn = document.getElementById('platformNoticeOk');
  if (!currentBusinessCode || !noticeEl || noticeEl.hidden) return;

  if (platformNoticeOkStep < 1) {
    platformNoticeOkStep = 1;
    noticeEl.classList.add('confirming');
    if (hint) hint.textContent = 'Ξανά ΟΚ για επιβεβαίωση ανάγνωσης.';
    if (btn) btn.textContent = 'ΟΚ — διάβασα';
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notice/ack`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Η επιβεβαίωση δεν καταχωρήθηκε.');
    currentTenantData.admin_notice = null;
    noticeEl.hidden = true;
    platformNoticeOkStep = 0;
    // Αν μένει unread στο chat, δείξε το banner μετά το ΟΚ
    updateSupportUnreadBadge(currentTenantData.support_unread);
    showToast('Επιβεβαιώθηκε ότι διάβασες το μήνυμα.');
  } catch (err) {
    if (btn) btn.disabled = false;
    if (err.message !== 'Unauthorized') showToast(err.message || 'Η επιβεβαίωση απέτυχε.', true);
  }
}

function renderBillingBox() {
  const box = document.getElementById('billingBox');
  const nav = document.getElementById('settingsNavBilling');
  const offNote = document.getElementById('billingOffNote');
  if (!currentTenantData) return;
  const on = currentTenantData.billing_enabled === true;
  if (nav) nav.hidden = !on;
  if (offNote) offNote.hidden = on;
  if (!box) return;
  box.hidden = !on;
  if (!on) return;
  document.getElementById('billingText').textContent = billingStatusText(currentTenantData);
  const live = currentTenantData.billing_plan === 'lifetime'
    || currentTenantData.billing_status === 'active'
    || currentTenantData.billing_status === 'past_due'
    || currentTenantData.billing_status === 'trialing';
  document.getElementById('billingStart').hidden = live;
  document.getElementById('billingPortal').hidden = !live || currentTenantData.billing_plan === 'lifetime';
}

async function startBilling(plan) {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Η πληρωμή δεν ξεκίνησε.');
    location.href = data.url;
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

function renderConnectStatus() {
  const el = document.getElementById('connectStatus');
  if (!el || !currentTenantData) return;
  if (currentTenantData.connect_ready) {
    el.textContent = 'Το Stripe είναι συνδεδεμένο. Οι δεσμεύσεις καρτών πηγαίνουν στο κατάστημα.';
  } else if (currentTenantData.connect_started) {
    el.textContent = 'Η σύνδεση Stripe δεν έχει ολοκληρωθεί. Πάτα ξανά το κουμπί και τελείωσε τη φόρμα.';
  } else {
    el.textContent = 'Χωρίς σύνδεση Stripe, η Εγγύηση Κράτησης δεν ανοίγει.';
  }
}

async function startStripeConnect() {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/connect/start`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Η σύνδεση Stripe δεν άνοιξε.');
    location.href = data.url;
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

async function refreshStripeConnect() {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/connect/status`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ο λογαριασμός Stripe δεν διαβάστηκε.');
    currentTenantData.connect_ready = data.connect_ready === true;
    currentTenantData.connect_started = data.connect_started === true;
    renderConnectStatus();
    showToast(data.connect_ready ? 'Το Stripe συνδέθηκε.' : 'Η φόρμα Stripe δεν ολοκληρώθηκε.', !data.connect_ready);
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

async function openBillingPortal() {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/billing/portal`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Η διαχείριση δεν άνοιξε.');
    location.href = data.url;
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
}

// [SECTION: JS-SETTINGS]
function showSettingsPanel(name) {
  document.querySelectorAll('.settings-panel').forEach((el) => {
    el.classList.toggle('active', el.id === `settingsPanel-${name}`);
  });
  document.querySelectorAll('.settings-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-settings-panel') === name);
  });
}

function syncDepositModeUi() {
  const fixed = document.getElementById('depositModeFixed')?.checked === true;
  const pctWrap = document.getElementById('depositPercentWrap');
  const fixedWrap = document.getElementById('depositFixedWrap');
  if (pctWrap) pctWrap.style.display = fixed ? 'none' : 'block';
  if (fixedWrap) fixedWrap.style.display = fixed ? 'block' : 'none';
}

function openSettingsModal() {
  if (!currentTenantData) return;
  showSettingsPanel('profile');
  document.getElementById('setName').value = currentTenantData.name || '';
  document.getElementById('setEmail').value = currentTenantData.email || '';
  const emailNotify = document.getElementById('setEmailNotify');
  if (emailNotify) emailNotify.checked = currentTenantData.email_notify !== false;
  const clientHold = document.getElementById('setClientHold');
  if (clientHold) clientHold.checked = currentTenantData.client_hold_enabled === true;
  const payOnline = document.getElementById('setPayOnline');
  if (payOnline) payOnline.checked = currentTenantData.pay_online_enabled !== false;
  const payShop = document.getElementById('setPayShop');
  if (payShop) payShop.checked = currentTenantData.pay_shop_enabled !== false;
  const depositPct = document.getElementById('setDepositPercent');
  if (depositPct) depositPct.value = currentTenantData.deposit_percent || 50;
  const depositFixed = document.getElementById('setDepositFixed');
  if (depositFixed) depositFixed.value = currentTenantData.deposit_fixed_euros || 1;
  const modeFixed = currentTenantData.deposit_mode === 'fixed';
  const modePct = document.getElementById('depositModePercent');
  const modeFix = document.getElementById('depositModeFixed');
  if (modePct) modePct.checked = !modeFixed;
  if (modeFix) modeFix.checked = modeFixed;
  syncDepositModeUi();
  const cancelHours = document.getElementById('setCancelHours');
  if (cancelHours) cancelHours.value = currentTenantData.cancel_hours === 0 ? 0 : (currentTenantData.cancel_hours || 24);
  const holdDays = document.getElementById('setHoldDays');
  if (holdDays) holdDays.value = currentTenantData.hold_days_before === 0 ? 0 : (currentTenantData.hold_days_before ?? 2);
  renderConnectStatus();
  document.getElementById('setPhone').value = currentTenantData.phone || '';
  document.getElementById('setAddress').value = currentTenantData.address || '';
  document.getElementById('setLogo').value = currentTenantData.logo_url || '';
  document.getElementById('setColor').value = currentTenantData.brand_color || '#4f46e5';
  document.getElementById('setBookingSubtitle').value = currentTenantData.booking_subtitle || '';
  document.getElementById('setWelcomeText').value = currentTenantData.welcome_text || '';
  document.getElementById('setSuccessMessage').value = currentTenantData.success_message || '';
  const savedTheme = ['light', 'dark', 'warm', 'ocean'].includes(currentTenantData.client_theme)
    ? currentTenantData.client_theme
    : 'light';
  document.querySelectorAll('input[name="clientTheme"]').forEach(r => {
    r.checked = r.value === savedTheme;
  });
  document.getElementById('setBuffer').value = currentTenantData.buffer_minutes || 0;
  renderBillingBox();
  const fields = formFieldsFromTenant(currentTenantData);
  document.getElementById('formFieldPhone').checked = fields.phone;
  document.getElementById('formFieldEmail').checked = fields.email;
  document.getElementById('formFieldInstagram').checked = fields.instagram;
  document.getElementById('formFieldNotes').checked = fields.notes;
  document.getElementById('formFieldExtraLabel').value = fields.extra_label || '';
  syncExtraField();
  syncFormFieldSelect();
  document.getElementById('setTelegramChatId').value = currentTenantData.telegram_chat_id || '';
  const botUser = String(currentTenantData.telegram_bot_username || '').replace(/^@/, '');
  const botWrap = document.getElementById('telegramBotLinkWrap');
  const botLink = document.getElementById('telegramBotLink');
  if (botWrap && botLink && /^[A-Za-z0-9_]{5,32}$/.test(botUser)) {
    botLink.href = `https://t.me/${botUser}`;
    botLink.textContent = `Άνοιξε @${botUser}`;
    botWrap.style.display = 'block';
  } else if (botWrap) {
    botWrap.style.display = 'none';
  }
  document.getElementById('managerMobileUrl').value = managerLoginUrl();
  const calendarUrl = document.getElementById('calendarUrl');
  const calendarLink = document.getElementById('calendarGoogleLink');
  const calendarMissing = document.getElementById('calendarMissing');
  const ics = currentTenantData.calendar_url || '';
  if (calendarUrl) calendarUrl.value = ics;
  if (calendarLink) {
    calendarLink.href = currentTenantData.google_calendar_url || '#';
    calendarLink.style.display = ics ? '' : 'none';
  }
  if (calendarMissing) calendarMissing.style.display = ics ? 'none' : 'block';
  if (calendarUrl) calendarUrl.style.display = ics ? '' : 'none';
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('newPassword2').value = '';

  const workDays = currentTenantData.work_days || [1, 2, 3, 4, 5];
  document.querySelectorAll('input[name="w_day"]').forEach(cb => {
    cb.checked = workDays.includes(parseInt(cb.value));
  });
  syncNamedChecks('w_day', 'selectAllDays');

  const hours = currentTenantData.working_hours;
  const perDay = hours && !Array.isArray(hours);
  document.getElementById('perDayHoursToggle').checked = !!perDay;
  fillShiftList('setShiftsList', perDay ? [{ start: '09:00', end: '21:00' }] : (hours || [{ start: '09:00', end: '21:00' }]));
  window._perDayHoursDraft = perDay ? { ...hours } : {};
  syncHoursEditors(true);

  const servicesList = document.getElementById('setServicesList');
  servicesList.innerHTML = '';
  (currentTenantData.services || []).forEach(s => {
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
      <input class="field" type="text" value="${s.name}" placeholder="Όνομα" style="flex:2">
      <input class="field" type="number" value="${s.duration}" placeholder="Min" min="5" style="flex:1">
      <input class="field" type="number" value="${optionalPriceInputValue(s.price)}" placeholder="Κενό = κατόπιν συνεννόησης" min="0" step="any" style="flex:1">
      <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding:0.5rem;"><i data-lucide="trash-2" size="14"></i></button>
    `;
    servicesList.appendChild(row);
  });

  updateAppearancePreview();
  openModal('settingsModal');
  lucide.createIcons();
}

function updateAppearancePreview() {
  const preview = document.getElementById('clientAppearancePreview');
  if (!preview) return;

  const theme = (document.querySelector('input[name="clientTheme"]:checked') || {}).value || 'light';
  const brandColor = document.getElementById('setColor').value || '#4f46e5';
  const logoUrl = document.getElementById('setLogo').value.trim() || 'demo-logo.svg';
  const logo = document.getElementById('previewLogo');
  const welcome = document.getElementById('setWelcomeText').value.trim();

  preview.dataset.previewTheme = theme;
  preview.style.setProperty('--preview-brand', brandColor);
  document.getElementById('previewName').textContent =
    document.getElementById('setName').value.trim() || 'Η επιχείρησή σας';
  document.getElementById('previewSubtitle').textContent =
    document.getElementById('setBookingSubtitle').value.trim() || 'Κλείστε το ραντεβού σας εύκολα και γρήγορα';
  document.getElementById('previewWelcome').textContent = welcome || 'Καλώς ήρθατε!';
  document.getElementById('previewWelcome').style.display = welcome ? 'block' : 'none';
  document.getElementById('previewSuccess').textContent =
    document.getElementById('setSuccessMessage').value.trim() || 'Η κράτησή σας καταχωρήθηκε!';

  logo.onerror = () => {
    logo.onerror = null;
    logo.src = 'demo-logo.svg';
  };
  logo.src = logoUrl;
}

// [SECTION: JS-OVERLAY] — στοίβα overlay + history.back() για Android/iOS Back
function lastOverlayIndex(kind, id) {
  for (let i = overlayStack.length - 1; i >= 0; i--) {
    if (overlayStack[i].kind === kind && overlayStack[i].id === id) return i;
  }
  return -1;
}

function hideOverlay(kind, id) {
  if (kind === 'drawer') {
    const drawer = document.getElementById('clientDrawer');
    if (drawer) drawer.classList.remove('open');
    return;
  }
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function isOverlayVisible(kind, id) {
  if (kind === 'drawer') {
    const drawer = document.getElementById('clientDrawer');
    return !!(drawer && drawer.classList.contains('open'));
  }
  const el = document.getElementById(id);
  return !!(el && el.style.display === 'flex');
}

function pushOverlay(kind, id) {
  if (overlayStack.some(item => item.kind === kind && item.id === id)) return;
  overlayStack.push({ kind, id });
  history.pushState({ rhapsodusOverlay: true, kind, id, n: overlayStack.length }, '', location.href);
}

function closeOverlay(kind, id) {
  if (!isOverlayVisible(kind, id)) return;
  hideOverlay(kind, id);
  const idx = lastOverlayIndex(kind, id);
  if (idx === -1) return;
  const isTop = idx === overlayStack.length - 1;
  overlayStack.splice(idx, 1);
  if (isTop) {
    silentPop += 1;
    history.back();
  }
}

function dismissTopOverlay() {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return false;
  closeOverlay(top.kind, top.id);
  return true;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const already = el.style.display === 'flex';
  el.style.display = 'flex';
  if (!already) pushOverlay('modal', id);
  el.style.zIndex = String(100 + Math.max(1, overlayStack.length) * 10);
  lucide.createIcons();
}

function closeModal(id) {
  closeOverlay('modal', id);
}

const DAY_LABELS = { 0: 'Κυριακή', 1: 'Δευτέρα', 2: 'Τρίτη', 3: 'Τετάρτη', 4: 'Πέμπτη', 5: 'Παρασκευή', 6: 'Σάββατο' };

function clockPart(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  const hour = match ? String(Math.min(23, Number(match[1]))).padStart(2, '0') : '09';
  const minute = match ? match[2] : '00';
  return { hour, minute };
}

function shiftClock(value, kind) {
  const picked = clockPart(value);
  const minutes = ['00', '30'];
  if (!minutes.includes(picked.minute)) minutes.push(picked.minute);
  const hourBtns = Array.from({ length: 24 }, (_, i) => {
    const hour = String(i).padStart(2, '0');
    return `<button type="button" class="shift-tick${hour === picked.hour ? ' is-on' : ''}" data-h="${hour}">${hour}</button>`;
  }).join('');
  const minuteBtns = minutes.map((minute) => `<button type="button" class="shift-tick${minute === picked.minute ? ' is-on' : ''}" data-m="${minute}">${minute}</button>`).join('');
  return `
    <div class="shift-clock" data-kind="${kind}">
      <button type="button" class="shift-clock-btn">${picked.hour}:${picked.minute}</button>
      <div class="shift-clock-panel" hidden>
        <div class="shift-clock-col">${hourBtns}</div>
        <div class="shift-clock-col shift-clock-mins">${minuteBtns}</div>
      </div>
      <input type="hidden" class="shift-${kind}-h" value="${picked.hour}">
      <input type="hidden" class="shift-${kind}-m" value="${picked.minute}">
    </div>`;
}

function shiftRowHtml(start, end) {
  return `
    <div class="shift-row">
      <span class="shift-k">Από</span> ${shiftClock(start, 'start')}
      <span class="shift-k">Έως</span> ${shiftClock(end, 'end')}
      <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding:0.5rem;"><i data-lucide="trash-2" size="14"></i></button>
      <p class="shift-foul" hidden>Η λήξη είναι πριν την έναρξη.</p>
    </div>
  `;
}

function fillShiftList(listId, shifts) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  (shifts && shifts.length ? shifts : [{ start: '09:00', end: '21:00' }]).forEach(sh => {
    list.insertAdjacentHTML('beforeend', shiftRowHtml(sh.start || '09:00', sh.end || '17:00'));
  });
  list.querySelectorAll('.shift-row').forEach(markShiftRow);
}

function collectShifts(listEl) {
  const hours = [];
  if (!listEl) return hours;
  listEl.querySelectorAll('.shift-row').forEach(row => {
    const start = `${row.querySelector('.shift-start-h')?.value || ''}:${row.querySelector('.shift-start-m')?.value || ''}`;
    const end = `${row.querySelector('.shift-end-h')?.value || ''}:${row.querySelector('.shift-end-m')?.value || ''}`;
    if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) hours.push({ start, end });
  });
  return hours;
}

function invalidShift(shifts) {
  return (shifts || []).find((shift) => shift.end <= shift.start) || null;
}

function markShiftRow(row) {
  if (!row) return;
  const start = `${row.querySelector('.shift-start-h')?.value || ''}:${row.querySelector('.shift-start-m')?.value || ''}`;
  const end = `${row.querySelector('.shift-end-h')?.value || ''}:${row.querySelector('.shift-end-m')?.value || ''}`;
  const bad = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && end <= start;
  row.classList.toggle('is-bad', bad);
  const note = row.querySelector('.shift-foul');
  if (note) note.hidden = !bad;
}

function closeShiftClocks(except) {
  document.querySelectorAll('.shift-clock-panel').forEach((panel) => {
    if (panel !== except) panel.hidden = true;
  });
}

document.addEventListener('click', (event) => {
  const tick = event.target.closest('.shift-tick');
  const opener = event.target.closest('.shift-clock-btn');
  if (!tick && !opener) {
    closeShiftClocks(null);
    return;
  }
  const clock = event.target.closest('.shift-clock');
  const row = clock && clock.closest('.shift-row');
  if (opener && clock) {
    const panel = clock.querySelector('.shift-clock-panel');
    const open = panel.hidden;
    closeShiftClocks(null);
    panel.hidden = !open;
    if (open) panel.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!tick || !clock || !row) return;
  const hour = tick.getAttribute('data-h');
  const minute = tick.getAttribute('data-m');
  const kind = clock.getAttribute('data-kind');
  if (hour) clock.querySelector(`.shift-${kind}-h`).value = hour;
  if (minute) clock.querySelector(`.shift-${kind}-m`).value = minute;
  const h = clock.querySelector(`.shift-${kind}-h`).value;
  const m = clock.querySelector(`.shift-${kind}-m`).value;
  clock.querySelector('.shift-clock-btn').textContent = `${h}:${m}`;
  clock.querySelectorAll('.shift-tick').forEach((btn) => {
    const on = (hour && btn.getAttribute('data-h') === hour) || (minute && btn.getAttribute('data-m') === minute);
    if (btn.hasAttribute(hour ? 'data-h' : 'data-m')) btn.classList.toggle('is-on', on);
  });
  if (minute) clock.querySelector('.shift-clock-panel').hidden = true;
  markShiftRow(row);
});

function addShiftRow(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.insertAdjacentHTML('beforeend', shiftRowHtml('09:00', '17:00'));
  lucide.createIcons();
}

function syncHoursEditors(fromOpen) {
  const perDay = document.getElementById('perDayHoursToggle').checked;
  const shared = document.getElementById('sharedHoursEditor');
  const perDayBox = document.getElementById('perDayHoursEditor');
  shared.style.display = perDay ? 'none' : 'block';
  perDayBox.style.display = perDay ? 'block' : 'none';
  if (!perDay) return;

  const sharedShifts = collectShifts(document.getElementById('setShiftsList'));
  const fallback = sharedShifts.length ? sharedShifts : [{ start: '09:00', end: '21:00' }];
  const draft = window._perDayHoursDraft || {};
  if (!fromOpen) {
    perDayBox.querySelectorAll('[data-day-shifts]').forEach(list => {
      draft[list.getAttribute('data-day-shifts')] = collectShifts(list);
    });
  }

  const days = [...document.querySelectorAll('input[name="w_day"]:checked')].map(cb => cb.value);
  perDayBox.innerHTML = '<label>Ωράριο ανά εργάσιμη ημέρα</label>';
  days.forEach(day => {
    const listId = `dayShifts-${day}`;
    const existing = draft[day] || fallback;
    perDayBox.insertAdjacentHTML('beforeend', `
      <div class="day-hours-block">
        <div class="day-hours-title">${DAY_LABELS[day] || day}</div>
        <div id="${listId}" data-day-shifts="${day}"></div>
        <button type="button" class="btn" onclick="addShiftRow('${listId}')" style="background:#059669; margin-top: 0.4rem; font-size: 0.75rem;">+ Βάρδια</button>
      </div>
    `);
    fillShiftList(listId, existing);
  });
  window._perDayHoursDraft = draft;
  syncNamedChecks('w_day', 'selectAllDays');
  lucide.createIcons();
}

function addModalShift() {
  addShiftRow('setShiftsList');
}

function addModalService() {
  const list = document.getElementById('setServicesList');
  const row = document.createElement('div');
  row.className = 'service-row';
  row.innerHTML = `
    <input class="field" type="text" placeholder="Όνομα Υπηρεσίας" style="flex:2">
    <input class="field" type="number" value="60" placeholder="Min" min="5" style="flex:1">
    <input class="field" type="number" placeholder="Κενό = κατόπιν συνεννόησης" min="0" step="any" style="flex:1">
    <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding:0.5rem;"><i data-lucide="trash-2" size="14"></i></button>
  `;
  list.appendChild(row);
  lucide.createIcons();
}

async function saveSettings(e) {
  e.preventDefault();
  await withLock(async () => {
  const name = document.getElementById('setName').value.trim();
  const email = document.getElementById('setEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Το email της επιχείρησης είναι υποχρεωτικό. Εκεί στέλνεται ο νέος κωδικός.', true);
    document.getElementById('setEmail').focus();
    return;
  }
  const phone = document.getElementById('setPhone').value.trim();
  const address = document.getElementById('setAddress').value.trim();
  const logo_url = document.getElementById('setLogo').value.trim();
  const brand_color = document.getElementById('setColor').value;
  const client_theme = (document.querySelector('input[name="clientTheme"]:checked') || {}).value || 'light';
  const booking_subtitle = document.getElementById('setBookingSubtitle').value.trim();
  const welcome_text = document.getElementById('setWelcomeText').value.trim();
  const success_message = document.getElementById('setSuccessMessage').value.trim();
  const buffer_minutes = parseInt(document.getElementById('setBuffer').value) || 0;
  const telegram_chat_id = document.getElementById('setTelegramChatId').value.trim();
  const extraOn = document.getElementById('formFieldInstagram').checked;
  const extraLabel = document.getElementById('formFieldExtraLabel').value.trim();
  if (extraOn && !extraLabel) {
    showToast('Γράψε τίτλο για το επιπλέον πεδίο.', true);
    document.getElementById('formFieldExtraLabel').focus();
    return;
  }
  const form_fields = {
    phone: document.getElementById('formFieldPhone').checked,
    email: document.getElementById('formFieldEmail').checked,
    instagram: extraOn,
    notes: document.getElementById('formFieldNotes').checked,
    extra_label: extraLabel
  };
  if (!form_fields.phone && !form_fields.email) {
    showToast('Πρέπει να μείνει τηλέφωνο ή email στη φόρμα.', true);
    return;
  }

  let work_days = [];
  document.querySelectorAll('input[name="w_day"]:checked').forEach(cb => work_days.push(parseInt(cb.value)));

  let working_hours;
  if (document.getElementById('perDayHoursToggle').checked) {
    working_hours = {};
    document.querySelectorAll('#perDayHoursEditor [data-day-shifts]').forEach(list => {
      const shifts = collectShifts(list);
      working_hours[list.getAttribute('data-day-shifts')] = shifts.length ? shifts : [{ start: '09:00', end: '21:00' }];
    });
  } else {
    working_hours = collectShifts(document.getElementById('setShiftsList'));
    if (!working_hours.length) working_hours = [{ start: '09:00', end: '21:00' }];
  }

  const allShifts = Array.isArray(working_hours) ? working_hours : Object.values(working_hours).flat();
  const badShift = invalidShift(allShifts);
  if (badShift) {
    showToast(`Η βάρδια ${badShift.start}–${badShift.end} τελειώνει πριν ξεκινήσει.`, true);
    return;
  }

  let services = [];
  document.querySelectorAll('#setServicesList .service-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    if (inputs[0].value) {
      const service = {
        name: inputs[0].value,
        duration: parseInt(inputs[1].value, 10) || 60,
        price: parseOptionalPrice(inputs[2].value)
      };
      services.push(service);
    }
  });

  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/update-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, email, phone, address, logo_url, brand_color,
        client_theme, booking_subtitle, welcome_text, success_message,
        work_days, working_hours, services,
        buffer_minutes, telegram_chat_id, form_fields,
        email_notify: document.getElementById('setEmailNotify').checked,
        client_hold_enabled: document.getElementById('setClientHold') ? document.getElementById('setClientHold').checked : false,
        pay_online_enabled: document.getElementById('setPayOnline') ? document.getElementById('setPayOnline').checked : true,
        pay_shop_enabled: document.getElementById('setPayShop') ? document.getElementById('setPayShop').checked : true,
        deposit_mode: document.getElementById('depositModeFixed')?.checked ? 'fixed' : 'percent',
        deposit_percent: document.getElementById('setDepositPercent') ? Number(document.getElementById('setDepositPercent').value) : 50,
        deposit_fixed_euros: document.getElementById('setDepositFixed') ? Number(document.getElementById('setDepositFixed').value) : 1,
        cancel_hours: document.getElementById('setCancelHours') ? Number(document.getElementById('setCancelHours').value) : 24,
        hold_days_before: document.getElementById('setHoldDays') ? Number(document.getElementById('setHoldDays').value) : 2
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Σφάλμα αποθήκευσης ρυθμίσεων');

    showToast('Οι ρυθμίσεις ενημερώθηκαν με επιτυχία!');
    closeModal('settingsModal');
    loadDashboard(currentBusinessCode);
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message, true);
  }
  });
}

// [SECTION: JS-BULK]
function syncBulkBar() {
  const checks = [...document.querySelectorAll('#aptList .bulk-check')];
  const ids = checks.filter((el) => el.checked).map((el) => el.getAttribute('data-id'));
  const bar = document.getElementById('bulkBar');
  if (!bar) return;
  bar.style.display = checks.length ? 'flex' : 'none';
  const allBox = document.getElementById('selectAllApts');
  if (allBox) {
    allBox.checked = checks.length > 0 && ids.length === checks.length;
    allBox.indeterminate = ids.length > 0 && ids.length < checks.length;
  }
  document.getElementById('bulkCount').textContent = `${ids.length} επιλεγμένα`;
  renderBulkActions(ids);
}

function toggleSelectAllApts(checked) {
  document.querySelectorAll('#aptList .bulk-check').forEach((el) => { el.checked = checked; });
  syncBulkBar();
}

function selectedAppointments(ids) {
  const wanted = new Set(ids || selectedBulkIds());
  return allAppointments.filter((item) => wanted.has(item.id));
}

function canDeleteAppointment(item) {
  if (!item) return false;
  if (isUnscheduled(item)) return true;
  if (item.status === 'BLOCKED') return true;
  if (item.status === 'REJECTED' || item.status === 'CANCELLED') return true;
  return isPastAppointment(item);
}

function renderBulkActions(ids) {
  const wrap = document.getElementById('bulkActions');
  if (!wrap) return;
  const selected = selectedAppointments(ids);
  if (!selected.length) {
    wrap.innerHTML = '';
    return;
  }
  const pending = selected.filter((item) => item.status === 'PENDING' || item.status === 'WAITLIST');
  const rejectable = pending.filter((item) => !isPastAppointment(item));
  const cancellable = selected.filter((item) => (item.status === 'BOOKED' || item.status === 'CONFIRMED') && !isPastAppointment(item));
  const removable = selected.filter((item) => canDeleteAppointment(item));
  const buttons = [];
  if (currentListKind === 'pending' || currentListKind === 'all') {
    if (pending.length) buttons.push(`<button type="button" class="btn" onclick="bulkSetStatus('BOOKED')">Έγκριση (${pending.length})</button>`);
    if (rejectable.length) buttons.push(`<button type="button" class="btn btn-outline" onclick="bulkSetStatus('REJECTED')">Απόρριψη (${rejectable.length})</button>`);
  }
  if ((currentListKind === 'booked' || currentListKind === 'all') && cancellable.length) {
    buttons.push(`<button type="button" class="btn btn-warning" onclick="bulkCancelSelected()">Ακύρωση (${cancellable.length})</button>`);
  }
  if ((currentListKind === 'history' || currentListKind === 'all' || currentListKind === 'unscheduled') && removable.length) {
    buttons.push(`<button type="button" class="btn btn-danger" onclick="bulkDeleteSelected()">Διαγραφή (${removable.length})</button>`);
  }
  wrap.innerHTML = buttons.join('');
}

function selectedBulkIds() {
  return [...document.querySelectorAll('.bulk-check:checked')].map((el) => el.getAttribute('data-id'));
}

async function bulkCancelSelected() {
  const ids = selectedBulkIds();
  if (!ids.length) return;
  if (!confirm(`Ακύρωση ${ids.length} εγκεκριμένων ραντεβού;`)) return;
  await withLock(async () => {
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/bulk-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, reason: (document.getElementById('actReason') && document.getElementById('actReason').value) || '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Σφάλμα μαζικής ακύρωσης');
      showToast(`Ακυρώθηκαν ${data.cancelled || 0} ραντεβού.`);
      fetchAppointments();
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, true);
    }
  });
}

async function bulkSetStatus(status) {
  const pending = selectedAppointments().filter((item) => item.status === 'PENDING' || item.status === 'WAITLIST');
  const selected = status === 'REJECTED' ? pending.filter((item) => !isPastAppointment(item)) : pending;
  if (!selected.length) {
    if (status === 'REJECTED' && pending.length) showToast('Τα παρελθόντα δεν απορρίπτονται.', true);
    return;
  }
  const label = status === 'BOOKED' ? 'Έγκριση' : 'Απόρριψη';
  const leftOut = status === 'REJECTED' ? pending.length - selected.length : 0;
  const note = leftOut ? ' Τα παρελθόντα μένουν ως έχουν.' : '';
  if (!confirm(`${label} ${selected.length} εκκρεμών;${note}`)) return;
  await withLock(async () => {
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/bulk-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected.map((item) => item.id), status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Σφάλμα μαζικής ενημέρωσης');
      const skipped = data.skipped ? ` (${data.skipped} δεν άλλαξαν)` : '';
      showToast(`${label}: ${data.updated || 0}${skipped}.`);
      fetchAppointments();
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, true);
    }
  });
}

async function bulkDeleteSelected() {
  const selected = selectedAppointments().filter((item) => canDeleteAppointment(item));
  if (!selected.length) return;
  if (!confirm(`Διαγραφή ${selected.length} ακυρωμένων ή απορριφθέντων;`)) return;
  await withLock(async () => {
    try {
      const res = await adminFetch(`/api/${currentBusinessCode}/admin/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected.map((item) => item.id) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Σφάλμα διαγραφής');
      lastUndo = { type: 'bulk-delete', snapshots: selected };
      showToast(`Διαγράφηκαν ${data.deleted || 0} ραντεβού.`, false, true);
      fetchAppointments();
    } catch (err) {
      if (err.message !== 'Unauthorized') showToast(err.message, true);
    }
  });
}

// [SECTION: JS-CLIENT] — κλικ στο όνομα ανοίγει ιστορικό επισκέψεων
function clientMatches(item, phone, name) {
  const p = String(phone || '').replace(/\D/g, '');
  if (p && String(item.customer_phone || '').replace(/\D/g, '') === p) return true;
  return foldSearch(item.customer_name) === foldSearch(name);
}

function openClientDrawer(phone, name) {
  const visits = allAppointments.filter((item) => item.status !== 'BLOCKED' && clientMatches(item, phone, name))
    .sort((a, b) => `${b.date}T${b.start_time || ''}`.localeCompare(`${a.date}T${a.start_time || ''}`));
  const done = visits.filter((item) => item.status === 'BOOKED' || item.status === 'CONFIRMED' || item.status === 'CANCELLED');
  const last = done[0] || visits[0];
  const notes = visits.map((item) => item.notes).filter(Boolean);
  document.getElementById('clientDrawerTitle').textContent = name || 'Πελάτης';
  document.getElementById('clientDrawerBody').innerHTML = `
    <p><strong>Επισκέψεις:</strong> ${done.length}</p>
    <p><strong>Τελευταία:</strong> ${last ? `${formatGreekDate(last.date)} · ${escapeHtml(last.service_name || '')}` : '—'}</p>
    <p><strong>Τηλέφωνο:</strong> ${escapeHtml(phone || '—')}</p>
    <h4 style="margin:1rem 0 0.4rem;">Σημειώσεις</h4>
    ${notes.length ? notes.slice(0, 8).map((n) => `<p style="color:var(--text-muted); font-size:0.85rem;">${escapeHtml(n)}</p>`).join('') : '<p style="color:var(--text-muted);">Δεν υπάρχουν σημειώσεις.</p>'}
  `;
  document.getElementById('clientDrawer').classList.add('open');
  pushOverlay('drawer', 'clientDrawer');
}

function closeClientDrawer() {
  closeOverlay('drawer', 'clientDrawer');
}

let newNoticeTimer;
function showNewNotice() {
  const el = document.getElementById('newToast');
  if (!el) return;
  document.body.appendChild(el);
  el.hidden = false;
  el.style.position = 'fixed';
  el.style.right = '1.25rem';
  el.style.left = 'auto';
  el.style.bottom = document.getElementById('toast')?.classList.contains('show') ? '5.6rem' : '1.25rem';
  el.style.zIndex = '100000';
  clearTimeout(newNoticeTimer);
  newNoticeTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

// [SECTION: JS-TOAST] — αναίρεση επαναφέρει previous_status
function showToast(text, isError = false, undoable = false) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const undoBtn = document.getElementById('toastUndo');
  if (!toast || !toastText) return;
  document.body.appendChild(toast);
  toastText.textContent = text;
  toast.style.display = 'flex';
  toast.style.position = 'fixed';
  toast.style.right = '1.25rem';
  toast.style.bottom = '1.25rem';
  toast.style.left = 'auto';
  toast.style.transform = 'none';
  toast.style.zIndex = '99999';
  toast.style.background = isError ? '#ef4444' : '#0f172a';
  toast.style.color = '#fff';
  toast.classList.add('show');
  const canUndo = Boolean(undoable && lastUndo && (lastUndo.id || (lastUndo.snapshots && lastUndo.snapshots.length)));
  if (undoBtn) {
    undoBtn.style.display = canUndo ? 'inline-flex' : 'none';
    undoBtn.onclick = () => {
      if (!lastUndo) return;
      const undo = lastUndo;
      lastUndo = null;
      undoBtn.style.display = 'none';
      toast.style.display = 'none';
      toast.classList.remove('show');
      if (undo.type === 'delete') {
        restoreAppointment(undo.snapshot);
        return;
      }
      if (undo.type === 'bulk-delete') {
        restoreAppointments(undo.snapshots, 'Οι διαγραφές αναιρέθηκαν.');
        return;
      }
      selectedEventId = undo.id;
      updateStatus(undo.status);
    };
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = 'none';
    toast.classList.remove('show');
    if (undoBtn) undoBtn.style.display = 'none';
  }, canUndo ? 12000 : 3000);
}

// [SECTION: JS-NOTES] — sticky notes board ανά επιχείρηση
let selectedNoteColor = 'yellow';
let shopNotesCache = [];

function openStickyBoard() {
  selectedNoteColor = 'yellow';
  syncNoteColorPicker();
  const body = document.getElementById('noteBody');
  if (body) body.value = '';
  openModal('notesModal');
  loadStickyNotes();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function syncNoteColorPicker() {
  document.querySelectorAll('#noteColorPicker .note-color').forEach((btn) => {
    const on = btn.getAttribute('data-color') === selectedNoteColor;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

document.getElementById('noteColorPicker')?.addEventListener('click', (event) => {
  const btn = event.target.closest('.note-color');
  if (!btn) return;
  selectedNoteColor = btn.getAttribute('data-color') || 'yellow';
  syncNoteColorPicker();
});

async function loadStickyNotes() {
  const board = document.getElementById('notesBoard');
  if (!board || !currentBusinessCode) return;
  board.innerHTML = '<p class="muted" style="margin:0;">Φόρτωση…</p>';
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Οι σημειώσεις δεν φορτώθηκαν.');
    shopNotesCache = data.notes || [];
    renderStickyNotes();
  } catch (err) {
    board.innerHTML = `<p class="error-text" style="margin:0;">${escapeHtml(err.message || 'Σφάλμα')}</p>`;
  }
}

const NOTE_COLORS = ['yellow', 'pink', 'mint', 'blue', 'lavender'];

function renderStickyNotes() {
  const board = document.getElementById('notesBoard');
  if (!board) return;
  if (!shopNotesCache.length) {
    board.innerHTML = '<p class="muted" style="margin:0;">Δεν έχεις κολλήσει ακόμα σημείωση. Γράψε κάτι πάνω και πάτα «Κόλλησε».</p>';
    return;
  }
  board.innerHTML = shopNotesCache.map((note) => {
    const color = note.color || 'yellow';
    const colors = NOTE_COLORS.map((c) => `
      <button type="button" class="note-color${c === color ? ' is-on' : ''}" data-color="${c}"
        title="Χρώμα" aria-pressed="${c === color ? 'true' : 'false'}"
        onclick="event.stopPropagation(); saveStickyNoteColor('${jsString(note.id)}', '${c}')"></button>
    `).join('');
    return `
    <article class="sticky-note color-${escapeHtml(color)}${note.done ? ' is-done' : ''}" data-id="${escapeHtml(note.id)}"
      onclick="focusStickyNote(event, '${jsString(note.id)}')">
      <div class="sticky-note-top">
        <label class="sticky-note-done" onclick="event.stopPropagation()">
          <input type="checkbox" ${note.done ? 'checked' : ''} onchange="toggleStickyNoteDone('${jsString(note.id)}', this.checked)">
          <span>${note.done ? 'Έγινε' : 'To-do'}</span>
        </label>
        <button type="button" class="sticky-note-del" onclick="event.stopPropagation(); deleteStickyNote('${jsString(note.id)}')" title="Διαγραφή" aria-label="Διαγραφή">×</button>
      </div>
      <div class="sticky-note-colors" onclick="event.stopPropagation()">${colors}</div>
      <textarea class="sticky-note-body" maxlength="800"
        onclick="event.stopPropagation()"
        onfocus="this.dataset.orig = this.value"
        onblur="saveStickyNoteBody('${jsString(note.id)}', this.value)">${escapeHtml(note.body || '')}</textarea>
    </article>`;
  }).join('');
}

function focusStickyNote(event, id) {
  if (event.target.closest('textarea, button, label, input, .sticky-note-colors')) return;
  const note = document.querySelector(`.sticky-note[data-id="${CSS.escape(id)}"] .sticky-note-body`);
  if (note) {
    note.focus();
    const len = note.value.length;
    try { note.setSelectionRange(len, len); } catch (_) { /* ignore */ }
  }
}

async function saveStickyNoteColor(id, color) {
  const next = NOTE_COLORS.includes(color) ? color : 'yellow';
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, color: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Δεν ενημερώθηκε το χρώμα.');
    const row = shopNotesCache.find((n) => n.id === id);
    if (row) row.color = next;
    renderStickyNotes();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα', true);
  }
}

async function createStickyNote(event) {
  event.preventDefault();
  const input = document.getElementById('noteBody');
  const body = (input?.value || '').trim();
  if (!body) return;
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, color: selectedNoteColor })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Η σημείωση δεν αποθηκεύτηκε.');
    input.value = '';
    await loadStickyNotes();
    showToast('Κολλήθηκε σημείωση.');
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα', true);
  }
}

async function saveStickyNoteBody(id, body) {
  const text = String(body || '').trim();
  if (!text) {
    showToast('Άδεια σημείωση — γράψε κάτι ή διέγραψέ την.', true);
    await loadStickyNotes();
    return;
  }
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, body: text })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Δεν αποθηκεύτηκε.');
    const row = shopNotesCache.find((n) => n.id === id);
    if (row) row.body = text;
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα', true);
  }
}

async function toggleStickyNoteDone(id, done) {
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, done: !!done })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Δεν ενημερώθηκε.');
    await loadStickyNotes();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα', true);
  }
}

async function deleteStickyNote(id) {
  if (!confirm('Να διαγραφεί αυτή η σημείωση;')) return;
  try {
    const res = await adminFetch(`/api/${currentBusinessCode}/admin/notes`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Δεν διαγράφηκε.');
    await loadStickyNotes();
  } catch (err) {
    if (err.message !== 'Unauthorized') showToast(err.message || 'Σφάλμα', true);
  }
}

// Εμφάνιση μηνύματος logout (π.χ. λήξη συνεδρίας) μετά από reload, αν υπάρχει.
(function showPendingLogoutMessage() {
  const msg = sessionStorage.getItem('logout_message');
  if (msg) {
    sessionStorage.removeItem('logout_message');
    window.addEventListener('DOMContentLoaded', () => {
      const errorEl = document.getElementById('loginError');
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
      }
    });
  }
})();
