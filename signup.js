const API_BASE_URL = 'https://corporate-bookings.tonisdevv.workers.dev';
const STEPS = [
  {
    title: 'Πώς λέγεται η επιχείρηση;',
    lead: 'Αυτό το όνομα βλέπουν οι πελάτες. Ο σύνδεσμος φτιάχνεται μόνος του — μπορείς να τον αλλάξεις.'
  },
  {
    title: 'Πού σε βρίσκουμε;',
    lead: 'Το email είναι υποχρεωτικό. Εκεί έρχεται ο σύνδεσμος αν ξεχάσεις τον κωδικό.'
  },
  {
    title: 'Διάλεξε κωδικό',
    lead: 'Με αυτόν μπαίνεις στον πίνακα. Τα κριτήρια φαίνονται κάτω από τα πεδία.'
  },
  {
    title: 'Δώσε του χρώμα',
    lead: 'Το χρώμα βάφει το κουμπί στη φόρμα των πελατών. Το λογότυπο μπορείς να το προσθέσεις και αργότερα.'
  },
  {
    title: 'Πότε δουλεύεις;',
    lead: 'Επέλεξε τις μέρες. Το ωράριο από κάτω ισχύει για όλες.'
  },
  {
    title: 'Τι προσφέρεις;',
    lead: 'Μία υπηρεσία φτάνει για αρχή. Άσε κενή την τιμή αν δεν θέλεις να φαίνεται στον πελάτη.'
  },
  {
    title: 'Ρίξε μια ματιά',
    lead: '1 μήνας δωρεάν χρήσης, χωρίς δέσμευση κάρτας. Ό,τι θέλεις το αλλάζεις εύκολα από τις ρυθμίσεις.'
  }
];
const SWATCHES = ['#4f46e5', '#0f766e', '#c2410c', '#be185d', '#0369a1', '#0f172a'];
const GREEK = {
  α: 'a', ά: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i',
  θ: 'th', ι: 'i', ί: 'i', ϊ: 'i', ΐ: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', ό: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', ϋ: 'y',
  ΰ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ώ: 'o'
};

let step = 0;
let codeEdited = false;
let logoDataUrl = '';

const form = document.getElementById('signupForm');
const statusEl = document.getElementById('signupStatus');
const nameInput = document.getElementById('signupName');
const codeInput = document.getElementById('signupCode');
const colorInput = document.getElementById('signupColor');

function slugify(value) {
  const mapped = String(value || '').toLowerCase().split('').map((ch) => GREEK[ch] || ch).join('');
  return mapped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function setStatus(text, kind) {
  statusEl.textContent = text || '';
  statusEl.className = 'home-lead-status' + (kind ? ' is-' + kind : '');
}

function paintBrand(color) {
  const next = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#4f46e5';
  document.documentElement.style.setProperty('--brand-color', next);
  document.querySelectorAll('.wizard-swatch').forEach((swatch) => {
    const on = swatch.dataset.color.toLowerCase() === next.toLowerCase();
    swatch.classList.toggle('is-on', on);
    swatch.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function paintPreview() {
  const color = colorInput.value || '#4f46e5';
  paintBrand(color);
  const previewName = document.getElementById('signupPreviewName');
  const previewLogo = document.getElementById('signupPreviewLogo');
  previewName.textContent = nameInput.value.trim() || 'Η επιχείρησή σου';
  const remote = String(document.getElementById('signupLogoUrl').value || '').trim();
  const src = logoDataUrl || (/^https:\/\/\S+$/i.test(remote) ? remote : '');
  previewLogo.hidden = !src;
  if (src) previewLogo.src = src;
}

function readDays() {
  return [...document.querySelectorAll('#signupDays .wizard-day.is-on')].map((btn) => parseInt(btn.dataset.day, 10));
}

const DAY_SHORT = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];

function dedupeShifts(shifts) {
  const seen = new Set();
  return shifts.filter((shift) => {
    const key = `${shift.start}-${shift.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readShiftRows(root) {
  return [...root.querySelectorAll(':scope > .wizard-shift, :scope > .wizard-day-hours')].map((row) => {
    const inputs = row.querySelectorAll('input[type="time"]');
    return { start: inputs[0] ? inputs[0].value : '', end: inputs[1] ? inputs[1].value : '' };
  }).filter((shift) => shift.start && shift.end);
}

function rawShifts() {
  return readShiftRows(document.getElementById('signupShifts'));
}

function shiftOverlap(shifts) {
  const list = shifts.filter((shift) => shift.start && shift.end && shift.end > shift.start);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (list[i].start < list[j].end && list[i].end > list[j].start) return [list[i], list[j]];
    }
  }
  return null;
}

function overlapMessage(pair) {
  return `Οι βάρδιες ${pair[0].start}–${pair[0].end} και ${pair[1].start}–${pair[1].end} επικαλύπτονται.`;
}

function readShifts() {
  return dedupeShifts(rawShifts());
}

function readHours() {
  const general = readShifts();
  const perDay = document.getElementById('signupPerDay').checked;
  if (!perDay) return general;
  const out = {};
  readDays().forEach((day) => {
    const row = document.querySelector(`#signupDayHours [data-day="${day}"]`);
    if (!row) {
      out[day] = general;
      return;
    }
    const inputs = row.querySelectorAll('input[type="time"]');
    const shift = { start: inputs[0].value, end: inputs[1].value };
    const same = general.length === 1 && general[0].start === shift.start && general[0].end === shift.end;
    out[day] = same ? general : [shift];
  });
  const lists = Object.values(out);
  const allSame = lists.length && lists.every((list) => JSON.stringify(list) === JSON.stringify(lists[0]));
  return allSame ? lists[0] : out;
}

function readServices() {
  return [...document.querySelectorAll('#signupServices .wizard-service')].map((row) => {
    const inputs = row.querySelectorAll('input');
    const service = {
      name: inputs[0].value.trim(),
      duration: parseInt(inputs[1].value, 10) || 60
    };
    if (inputs[2].value !== '') service.price = Number(inputs[2].value);
    return service;
  }).filter((service) => service.name);
}

function dayLabel(days) {
  return days.map((day) => DAY_SHORT[day]).join(', ');
}

function hoursSummary() {
  const hours = readHours();
  if (Array.isArray(hours)) {
    const span = hours.map((shift) => `${shift.start}–${shift.end}`).join(', ');
    return `${dayLabel(readDays())} · ${span}`;
  }
  return readDays().map((day) => {
    const list = hours[day] || [];
    return `${DAY_SHORT[day]} ${list.map((shift) => `${shift.start}–${shift.end}`).join(', ')}`;
  }).join(' · ');
}

function fillSummary() {
  const list = document.getElementById('signupSummary');
  const services = readServices().map((service) => service.name).join(', ');
  const rows = [
    ['Επιχείρηση', nameInput.value.trim(), 0],
    ['Σύνδεσμος', `quickbook.gr/?business_code=${codeInput.value.trim()}`, 0],
    ['Email', document.getElementById('signupEmail').value.trim(), 1],
    ['Ωράριο', hoursSummary(), 4],
    ['Υπηρεσίες', services, 5]
  ];
  list.replaceChildren();
  rows.forEach(([label, value, target]) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${label}: ${value || '—'}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Αλλαγή';
    edit.addEventListener('click', () => showStep(target));
    li.append(text, edit);
    list.appendChild(li);
  });
  const colorItem = document.createElement('li');
  const colorText = document.createElement('span');
  const chip = document.createElement('i');
  chip.className = 'wizard-color-chip';
  chip.style.background = colorInput.value;
  colorText.append('Χρώμα: ', chip, document.createTextNode(` ${colorInput.value}`));
  const colorEdit = document.createElement('button');
  colorEdit.type = 'button';
  colorEdit.textContent = 'Αλλαγή';
  colorEdit.addEventListener('click', () => showStep(3));
  colorItem.append(colorText, colorEdit);
  list.appendChild(colorItem);
}

function validate(index) {
  if (index === 0) {
    if (!nameInput.value.trim()) return 'Γράψε το όνομα της επιχείρησης.';
    const code = codeInput.value.trim().toLowerCase();
    codeInput.value = code;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || code.length < 2) {
      return 'Ο σύνδεσμος θέλει πεζά λατινικά, αριθμούς και παύλες, π.χ. studio-name.';
    }
  }
  if (index === 1) {
    const email = document.getElementById('signupEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Βάλε ένα έγκυρο email.';
  }
  if (index === 2) {
    const pass = document.getElementById('signupPass').value;
    if (pass.length < 8) return 'Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες.';
    if (pass !== document.getElementById('signupPass2').value) return 'Οι δύο κωδικοί δεν ταιριάζουν.';
  }
  if (index === 4) {
    if (!readDays().length) return 'Διάλεξε τουλάχιστον μία ημέρα.';
    const shifts = rawShifts();
    if (!shifts.length) return 'Βάλε τουλάχιστον μία βάρδια.';
    if (shifts.some((shift) => shift.end <= shift.start)) return 'Κάθε βάρδια πρέπει να τελειώνει μετά την έναρξή της.';
    const overlap = shiftOverlap(shifts);
    if (overlap) return overlapMessage(overlap);
    if (document.getElementById('signupPerDay').checked) {
      const bad = [...document.querySelectorAll('#signupDayHours .wizard-day-hours')].some((row) => {
        const inputs = row.querySelectorAll('input[type="time"]');
        return !inputs[0].value || !inputs[1].value || inputs[1].value <= inputs[0].value;
      });
      if (bad) return 'Κάθε μέρα με δικό της ωράριο πρέπει να τελειώνει μετά την έναρξη.';
    }
  }
  if (index === 5 && !readServices().length) return 'Βάλε τουλάχιστον μία υπηρεσία.';
  return '';
}

function paintRules() {
  const code = codeInput.value.trim().toLowerCase();
  const codeRule = document.getElementById('signupCodeRule');
  const codeOk = code.length >= 2 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code);
  if (!code) {
    codeRule.textContent = 'Πεζά λατινικά, αριθμοί και παύλες. Από 2 χαρακτήρες, π.χ. nikos.';
    codeRule.className = 'wizard-rule';
  } else if (!codeOk) {
    codeRule.textContent = code.length < 2
      ? `Ο σύνδεσμος θέλει τουλάχιστον 2 χαρακτήρες. Τώρα έχει ${code.length}.`
      : 'Μόνο πεζά λατινικά, αριθμοί και παύλες. Τα ελληνικά και τα σύμβολα δεν περνάνε.';
    codeRule.className = 'wizard-rule is-bad';
  } else {
    codeRule.textContent = 'Ο σύνδεσμος είναι εντάξει.';
    codeRule.className = 'wizard-rule is-ok';
  }
  const pass = document.getElementById('signupPass').value;
  const pass2 = document.getElementById('signupPass2').value;
  const len = document.querySelector('#signupPassRules [data-rule="len"]');
  const match = document.querySelector('#signupPassRules [data-rule="match"]');
  len.textContent = pass.length
    ? `Τουλάχιστον 8 χαρακτήρες (${pass.length}/8)`
    : 'Τουλάχιστον 8 χαρακτήρες';
  len.className = pass.length >= 8 ? 'is-ok' : (pass.length ? 'is-bad' : '');
  match.className = pass && pass2 && pass === pass2 ? 'is-ok' : (pass2 ? 'is-bad' : '');
}

function paintShiftNote() {
  const note = document.getElementById('signupHoursNote');
  const rows = [...document.querySelectorAll('#signupShifts .wizard-shift')];
  const shifts = rows.map((row) => {
    const inputs = row.querySelectorAll('input[type="time"]');
    return { row, start: inputs[0] ? inputs[0].value : '', end: inputs[1] ? inputs[1].value : '' };
  });
  rows.forEach((row) => row.classList.remove('is-overlap'));
  const overlap = shiftOverlap(shifts);
  shifts.forEach((shift, index) => {
    const hits = shifts.some((other, otherIndex) => otherIndex !== index
      && shift.start && shift.end && other.start && other.end
      && shift.end > shift.start && other.end > other.start
      && shift.start < other.end && shift.end > other.start);
    shift.row.classList.toggle('is-overlap', hits);
  });
  if (overlap) {
    note.textContent = `⚠ ${overlapMessage(overlap)} Άλλαξέ τες για να συνεχίσεις.`;
    note.className = 'wizard-rule is-warn';
    return;
  }
  note.className = 'wizard-rule';
  note.textContent = 'Ισχύει για όλες τις μέρες που επέλεξες. Δεύτερη βάρδια είναι για διάλειμμα, π.χ. πρωί και απόγευμα, χωρίς να πέφτει πάνω στην πρώτη.';
}

function renderDayHours() {
  const box = document.getElementById('signupDayHours');
  const on = document.getElementById('signupPerDay').checked;
  box.hidden = !on;
  if (!on) return;
  const previous = {};
  box.querySelectorAll('[data-day]').forEach((row) => {
    const inputs = row.querySelectorAll('input[type="time"]');
    previous[row.dataset.day] = { start: inputs[0].value, end: inputs[1].value };
  });
  const general = readShifts()[0] || { start: '09:00', end: '21:00' };
  box.replaceChildren();
  const hint = document.createElement('p');
  hint.className = 'wizard-rule';
  hint.textContent = 'Άλλαξε μόνο τη μέρα που διαφέρει. Οι υπόλοιπες μένουν στο κοινό ωράριο.';
  box.appendChild(hint);
  readDays().forEach((day) => {
    const saved = previous[day] || general;
    const row = document.createElement('div');
    row.className = 'wizard-day-hours';
    row.dataset.day = String(day);
    row.innerHTML = `<span>${DAY_SHORT[day]}</span><input type="time" value="${saved.start}" aria-label="${DAY_SHORT[day]} από"><span>–</span><input type="time" value="${saved.end}" aria-label="${DAY_SHORT[day]} έως">`;
    box.appendChild(row);
  });
}

function paintNext() {
  paintRules();
  paintShiftNote();
  const last = step === STEPS.length - 1;
  const ready = last
    ? document.getElementById('signupTerms').checked
    : validate(step) === '';
  document.getElementById('wizardNext').classList.toggle('is-ready', !last && ready);
  document.getElementById('wizardCreate').classList.toggle('is-ready', last && ready);
}

function showStep(next) {
  step = next;
  setStatus('');
  document.getElementById('wizardKicker').textContent = `Βήμα ${step + 1} από ${STEPS.length}`;
  document.getElementById('wizardTitle').textContent = STEPS[step].title;
  document.getElementById('wizardLead').textContent = STEPS[step].lead;
  document.querySelectorAll('.wizard-step').forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });
  document.querySelectorAll('#wizardProgress button').forEach((dot, index) => {
    dot.classList.toggle('is-on', index === step);
    dot.classList.toggle('is-done', index < step);
  });
  document.getElementById('wizardBack').hidden = step === 0;
  const last = step === STEPS.length - 1;
  document.getElementById('wizardNext').hidden = last;
  document.getElementById('wizardCreate').hidden = !last;
  if (step === 3) paintPreview();
  if (step === 6) fillSummary();
  paintNext();
  const focusable = document.querySelector(`.wizard-step[data-step="${step}"] input, .wizard-step[data-step="${step}"] button`);
  if (focusable) focusable.focus();
}

function buildProgress() {
  const bar = document.getElementById('wizardProgress');
  STEPS.forEach((item, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.dataset.step = String(index);
    dot.setAttribute('aria-label', item.title);
    dot.addEventListener('click', () => {
      if (index < step) showStep(index);
    });
    bar.appendChild(dot);
  });
}

function addShift() {
  const row = document.createElement('div');
  row.className = 'wizard-shift';
  row.innerHTML = '<input type="time" value="09:00" aria-label="Από"><span>–</span><input type="time" value="17:00" aria-label="Έως"><button type="button" class="home-lead-mini">Αφαίρεση</button>';
  row.querySelector('button').addEventListener('click', () => row.remove());
  document.getElementById('signupShifts').appendChild(row);
}

function addService() {
  const row = document.createElement('div');
  row.className = 'wizard-service';
  row.innerHTML = '<input type="text" maxlength="80" placeholder="Όνομα" aria-label="Όνομα υπηρεσίας"><input type="number" min="15" max="480" value="60" aria-label="Διάρκεια λεπτά"><input type="number" min="0" step="0.5" placeholder="Τιμή €" aria-label="Τιμή"><button type="button" class="home-lead-mini">Αφαίρεση</button>';
  row.querySelector('button').addEventListener('click', () => row.remove());
  document.getElementById('signupServices').appendChild(row);
}

function buildSwatches() {
  const box = document.getElementById('signupSwatches');
  SWATCHES.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wizard-swatch';
    button.dataset.color = color;
    button.style.background = color;
    button.setAttribute('aria-label', color);
    button.addEventListener('click', () => {
      colorInput.value = color;
      paintPreview();
    });
    box.appendChild(button);
  });
}

nameInput.addEventListener('input', () => {
  if (!codeEdited) codeInput.value = slugify(nameInput.value);
  if (step === 3) paintPreview();
});
codeInput.addEventListener('input', () => { codeEdited = true; });
colorInput.addEventListener('input', paintPreview);
document.getElementById('signupLogoUrl').addEventListener('input', paintPreview);

document.getElementById('signupLogo').addEventListener('change', () => {
  const file = document.getElementById('signupLogo').files && document.getElementById('signupLogo').files[0];
  logoDataUrl = '';
  if (!file) {
    paintPreview();
    return;
  }
  if (file.size > 1500000) {
    setStatus('Η εικόνα είναι μεγάλη. Μέχρι 1,5 MB.', 'err');
    document.getElementById('signupLogo').value = '';
    return;
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    setStatus('Μόνο PNG, JPG ή WEBP.', 'err');
    document.getElementById('signupLogo').value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    logoDataUrl = String(reader.result || '');
    setStatus('');
    paintPreview();
  };
  reader.onerror = () => setStatus('Η εικόνα δεν διαβάστηκε.', 'err');
  reader.readAsDataURL(file);
});

document.getElementById('signupDays').addEventListener('click', (event) => {
  const button = event.target.closest('.wizard-day');
  if (!button) return;
  button.classList.toggle('is-on');
  button.setAttribute('aria-pressed', button.classList.contains('is-on') ? 'true' : 'false');
  renderDayHours();
  paintNext();
});

document.getElementById('signupPerDay').addEventListener('change', renderDayHours);

form.addEventListener('input', paintNext);
form.addEventListener('change', paintNext);

document.getElementById('signupShowPass').addEventListener('click', () => {
  const show = document.getElementById('signupPass').type === 'password';
  document.getElementById('signupPass').type = show ? 'text' : 'password';
  document.getElementById('signupPass2').type = show ? 'text' : 'password';
  document.getElementById('signupShowPass').textContent = show ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού';
});

document.getElementById('signupAddShift').addEventListener('click', () => {
  addShift();
  paintNext();
});
document.getElementById('signupAddService').addEventListener('click', () => {
  addService();
  paintNext();
});
document.getElementById('signupShifts').addEventListener('click', (event) => {
  if (event.target.closest('button')) paintNext();
});
document.getElementById('signupServices').addEventListener('click', (event) => {
  if (event.target.closest('button')) paintNext();
});

document.getElementById('wizardBack').addEventListener('click', () => {
  if (step > 0) showStep(step - 1);
});
document.getElementById('wizardNext').addEventListener('click', () => {
  const problem = validate(step);
  if (problem) {
    setStatus(problem, 'err');
    return;
  }
  showStep(step + 1);
});

form.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
  if (step < STEPS.length - 1) {
    event.preventDefault();
    document.getElementById('wizardNext').click();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  for (let index = 0; index <= 5; index += 1) {
    const problem = validate(index);
    if (problem) {
      showStep(index);
      setStatus(problem, 'err');
      return;
    }
  }
  if (!document.getElementById('signupTerms').checked) {
    setStatus('Χρειάζεται αποδοχή των όρων επιχειρήσεων.', 'err');
    return;
  }
  const button = document.getElementById('wizardCreate');
  button.disabled = true;
  setStatus('');
  const payload = {
    name: nameInput.value.trim(),
    business_code: codeInput.value.trim().toLowerCase(),
    email: document.getElementById('signupEmail').value.trim(),
    phone: document.getElementById('signupPhone').value.trim(),
    address: document.getElementById('signupAddress').value.trim(),
    password: document.getElementById('signupPass').value,
    accept_terms: true,
    website: form.website.value || '',
    work_days: readDays(),
    working_hours: readHours(),
    services: readServices(),
    brand_color: colorInput.value,
    logo_url: document.getElementById('signupLogoUrl').value.trim(),
    logo_image: logoDataUrl
  };
  try {
    const res = await fetch(`${API_BASE_URL}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Το προφίλ δεν δημιουργήθηκε.');
    document.getElementById('wizardLive').hidden = true;
    document.getElementById('wizardDone').hidden = false;
    document.getElementById('wizardDoneText').textContent = data.message || 'Το προφίλ είναι έτοιμο. Μπες στον πίνακα με τον κωδικό που έβαλες.';
    document.getElementById('wizardDoneLink').href = `manager.html?code=${encodeURIComponent(data.business_code || payload.business_code)}`;
  } catch (err) {
    setStatus(err.message || 'Το προφίλ δεν δημιουργήθηκε.', 'err');
    button.disabled = false;
  }
});

buildSwatches();
buildProgress();
showStep(0);
