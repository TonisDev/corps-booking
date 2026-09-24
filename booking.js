        // [SECTION: JS-SETUP]
        const API_BASE_URL = "https://corporate-bookings.tonisdevv.workers.dev";
        const CLIENT_THEMES = ['light', 'dark', 'warm', 'ocean'];
        const urlParams = new URLSearchParams(window.location.search);
        const business_code = urlParams.get('business_code');

        function parseOptionalPrice(raw) {
            if (raw === null || raw === undefined || raw === '') return null;
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
        }

        function formatServiceLabel(service) {
            const duration = service.duration || 60;
            const price = parseOptionalPrice(service && service.price);
            if (price === null) return `${service.name} (${duration} min · κατόπιν συνεννόησης)`;
            return `${service.name} (${duration} min · ${price}€)`;
        }

        function applyClientTheme(theme) {
            const next = CLIENT_THEMES.includes(theme) ? theme : 'light';
            document.documentElement.setAttribute('data-theme', next);
            document.body.setAttribute('data-theme', next);
            document.documentElement.style.colorScheme = next === 'dark' ? 'dark' : 'light';
        }

        const dateInput = document.getElementById('date');
        const timeHourSelect = document.getElementById('timeHour');
        const timeMinuteSelect = document.getElementById('timeMinute');
        const serviceSelect = document.getElementById('service');
        const bookingForm = document.getElementById('bookingForm');
        const responseContainer = document.getElementById('responseContainer');
        const responseMessage = document.getElementById('responseMessage');
        const gcalBtn = document.getElementById('gcalBtn');
        const slotHint = document.getElementById('slotHint');
        const initialLoader = document.getElementById('initialLoader');
        const businessHeader = document.getElementById('businessHeader');

        let businessData = null;
        let availableSlots = [];
        let waitlistMode = false;

        function isRequestMode() {
            return businessData && businessData.intake_mode === 'request';
        }

        // [SECTION: JS-WAITLIST]
        function waitlistAllowed() {
            return Boolean(businessData && Number(businessData.waitlist_enabled) === 1);
        }

        function hideWaitlistBox() {
            waitlistMode = false;
            const box = document.getElementById('waitlistBox');
            const wrap = document.getElementById('timePickerWrap');
            if (box) box.classList.add('hidden');
            if (wrap) wrap.style.display = '';
            document.getElementById('timeLabel').style.display = '';
        }

        function showWaitlistCta(dateStr) {
            waitlistMode = true;
            resetTimePickers('—');
            const wrap = document.getElementById('timePickerWrap');
            if (wrap) wrap.style.display = 'none';
            document.getElementById('timeLabel').style.display = 'none';
            const box = document.getElementById('waitlistBox');
            document.getElementById('waitlistCopy').textContent =
                'Ουπς, φαίνεται ότι όλες οι ώρες είναι κατειλημμένες.';
            document.getElementById('waitlistAsk').textContent =
                'Θέλεις να είσαι ο πρώτος που θα ενημερωθεί εάν υπάρξει ακύρωση;';
            box.classList.remove('hidden');
            slotHint.textContent = 'Δεν χρειάζεται να επιλέξεις ώρα. Πάτα το κουμπί από κάτω.';
            slotHint.className = 'field-help field-help-wait';
            document.getElementById('submitBtnText').textContent = 'Ναι, ενημερώστε με';
        }

        function applyPublicFormFields(raw) {
            const fields = {
                phone: raw && raw.phone !== false && raw.phone !== 0,
                email: raw && raw.email !== false && raw.email !== 0,
                instagram: !(raw && (raw.instagram === false || raw.instagram === 0)),
                notes: !(raw && (raw.notes === false || raw.notes === 0))
            };
            if (!raw) {
                fields.phone = true;
                fields.email = true;
            }
            const named = raw && Object.prototype.hasOwnProperty.call(raw, 'extra_label');
            const extraLabel = named
                ? String(raw.extra_label || '').trim()
                : (fields.instagram ? 'Instagram' : '');
            fields.instagram = fields.instagram && Boolean(extraLabel);
            const extraLabelEl = document.getElementById('extraFieldLabel');
            if (extraLabelEl && extraLabel) extraLabelEl.textContent = extraLabel;
            const setWrap = (wrapId, inputId, on, required) => {
                const wrap = document.getElementById(wrapId);
                const input = document.getElementById(inputId);
                if (wrap) wrap.style.display = on ? '' : 'none';
                if (input) {
                    input.required = Boolean(on && required);
                    if (!on) input.value = '';
                }
            };
            setWrap('wrapPhone', 'phone', fields.phone, true);
            setWrap('wrapEmail', 'email', fields.email, true);
            setWrap('wrapInstagram', 'instagram', fields.instagram, false);
            setWrap('wrapNotes', 'notes', fields.notes, false);
        }

        function isoDate(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function isShopClosedOn(dateOrStr) {
            const dateStr = typeof dateOrStr === 'string' ? dateOrStr : isoDate(dateOrStr);
            return getShiftsForDate(dateStr).length === 0;
        }

        function openShopInfo() {
            const modal = document.getElementById('shopInfoModal');
            const box = document.getElementById('clientQr');
            modal.classList.remove('hidden');
            document.body.classList.add('shop-info-open');
            if (box.dataset.ready === '1') return;
            if (typeof QRCode === 'undefined') {
                box.textContent = 'QR μη διαθέσιμο';
                box.dataset.ready = '1';
                return;
            }
            box.innerHTML = '';
            new QRCode(box, {
                text: window.location.href,
                width: 148,
                height: 148,
                correctLevel: QRCode.CorrectLevel.M
            });
            box.dataset.ready = '1';
        }

        function closeShopInfo() {
            document.getElementById('shopInfoModal').classList.add('hidden');
            document.body.classList.remove('shop-info-open');
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeShopInfo();
        });

        // [SECTION: JS-REQUEST] — προτιμώμενες ώρες χωρίς BLOCKED / BOOKED / CONFIRMED
        function preferredSlotsForDate(dateStr, blocked, duration) {
            const shifts = getShiftsForDate(dateStr);
            const slots = [];
            const step = 30;
            const blockedRanges = (blocked || []).map((occ) => ({
                start: timeToMinutes(occ.start_time),
                end: timeToMinutes(occ.end_time)
            }));
            shifts.forEach((shift) => {
                const alignedStart = Math.ceil(shift.start / step) * step;
                for (let mins = alignedStart; mins < shift.end; mins += step) {
                    const hit = blockedRanges.some((r) => mins >= r.start && mins < r.end);
                    if (!hit) slots.push(minutesToTime(mins));
                }
            });
            return [...new Set(slots)].sort();
        }

        function fillPreferredTimes(hint, asWaitlist, dateStr, blocked, duration) {
            hideWaitlistBox();
            waitlistMode = !!asWaitlist;
            availableSlots = preferredSlotsForDate(dateStr, blocked, duration);
            if (!availableSlots.length) {
                const closed = getShiftsForDate(dateStr).length === 0;
                resetTimePickers(closed ? 'Κλειστό' : '—');
                slotHint.textContent = closed
                    ? 'Η επιχείρηση είναι κλειστή αυτή την ημέρα.'
                    : 'Οι ώρες είναι κλειστές ή ήδη κατειλημμένες.';
                slotHint.className = 'field-help field-help-wait';
                return;
            }
            fillHourOptions(availableSlots);
            const windows = getShiftsForDate(dateStr).map((shift) => `${minutesToTime(shift.start)}–${minutesToTime(shift.end)}`);
            slotHint.textContent = windows.length ? `Ωράριο: ${windows.join(', ')}. ${hint}` : hint;
            slotHint.className = asWaitlist ? 'field-help field-help-wait' : 'field-help';
        }

        function fillHourOptions(slots) {
            const hours = [...new Set(slots.map((slot) => slot.slice(0, 2)))];
            timeHourSelect.innerHTML = '<option value="">Ώρα</option>';
            hours.forEach((hour) => timeHourSelect.appendChild(new Option(hour, hour)));
            timeHourSelect.disabled = false;
            timeHourSelect.classList.remove('bg-gray-50');
            refreshMinuteOptions();
        }

        function selectedTimeValue() {
            if (!timeHourSelect.value || !timeMinuteSelect.value) return '';
            return `${timeHourSelect.value}:${timeMinuteSelect.value}`;
        }

        function resetTimePickers(hourLabel = 'Ώρα') {
            timeHourSelect.innerHTML = `<option value="">${hourLabel}</option>`;
            timeHourSelect.disabled = true;
            timeHourSelect.classList.add('bg-gray-50');
            timeMinuteSelect.innerHTML = '<option value="">--</option><option value="00">00</option><option value="30">30</option>';
            timeMinuteSelect.value = '';
            timeMinuteSelect.disabled = true;
            timeMinuteSelect.classList.add('bg-gray-50');
            availableSlots = [];
            closeTimeRollers();
            paintTime();
        }

        // [SECTION: JS-TIME] — ένα ορατό πεδίο· τα #timeHour/#timeMinute μένουν κρυφά για την τιμή
        const timeBtn = document.getElementById('timeDropdownBtn');
        const timePanel = document.getElementById('timeRollers');

        function closeTimeRollers() {
            timePanel.classList.add('hidden');
            timeBtn.classList.remove('is-open');
        }

        function paintTime() {
            const hours = [...timeHourSelect.options].filter((o) => o.value).map((o) => o.value);
            const mins = [...timeMinuteSelect.options].filter((o) => o.value).map((o) => o.value);
            const item = (on, key, val) =>
                `<button type="button" class="time-item${on ? ' is-on' : ''}" data-${key}="${val}">${val}</button>`;
            document.getElementById('timeHourCol').innerHTML = hours.map((h) => item(timeHourSelect.value === h, 'h', h)).join('') || '—';
            document.getElementById('timeMinuteCol').innerHTML = mins.map((m) => item(timeMinuteSelect.value === m, 'm', m)).join('') || '—';
            timeBtn.disabled = timeHourSelect.disabled;
            const first = timeHourSelect.options[0];
            timeBtn.textContent = selectedTimeValue()
                || (timeHourSelect.disabled && first && first.textContent !== 'Ώρα' && first.textContent)
                || (timeHourSelect.value ? `${timeHourSelect.value}:—` : 'Επιλέξτε ώρα');
            if (!timePanel.classList.contains('hidden')) {
                timePanel.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
            }
        }

        function refreshMinuteOptions() {
            const hour = timeHourSelect.value;
            const minutes = hour
                ? availableSlots.filter((s) => s.startsWith(`${hour}:`)).map((s) => s.slice(3))
                : [...new Set(availableSlots.map((s) => s.slice(3)))];
            timeMinuteSelect.innerHTML = '<option value="">--</option>';
            ['00', '30'].forEach((min) => {
                if (minutes.includes(min)) timeMinuteSelect.appendChild(new Option(min, min));
            });
            timeMinuteSelect.disabled = !hour || timeMinuteSelect.options.length < 2;
            paintTime();
        }
        let availabilityRequestId = 0; // αγνοεί αργοπορημένη /availability αν άλλαξε μέρα/υπηρεσία

        const timeToMinutes = (timeStr) => {
            const match = String(timeStr || '').match(/(\d{1,2}):(\d{2})/);
            if (!match) return NaN;
            return Number(match[1]) * 60 + Number(match[2]);
        };

        const minutesToTime = (totalMins) => {
            const h = Math.floor(totalMins / 60).toString().padStart(2, '0');
            const m = (totalMins % 60).toString().padStart(2, '0');
            return `${h}:${m}`;
        };

        // Ωράριο ημέρας σε λεπτά, ή [] αν η μέρα είναι κλειστή.
        function shiftsForWeekday(workingHours, dayOfWeek) {
            const fallback = [{ start: '09:00', end: '21:00' }];
            if (Array.isArray(workingHours) && workingHours.length > 0) return workingHours;
            if (workingHours && typeof workingHours === 'object') {
                const key = String(dayOfWeek);
                const list = workingHours[key] || (workingHours.by_day && workingHours.by_day[key]);
                if (Array.isArray(list) && list.length > 0) return list;
                if (Array.isArray(workingHours.shared) && workingHours.shared.length > 0) return workingHours.shared;
                return [];
            }
            return fallback;
        }

        function getShiftsForDate(dateStr) {
            const workDays = (businessData && businessData.work_days && businessData.work_days.length > 0)
                ? businessData.work_days
                : [1, 2, 3, 4, 5];

            const [y, m, d] = dateStr.split('-').map(Number);
            const dayOfWeek = new Date(y, m - 1, d).getDay();

            if (!workDays.map(Number).includes(dayOfWeek)) return [];

            return shiftsForWeekday(businessData && businessData.working_hours, dayOfWeek).map(sh => ({
                start: timeToMinutes(sh.start),
                end: timeToMinutes(sh.end)
            })).filter((shift) => Number.isFinite(shift.start) && Number.isFinite(shift.end) && shift.end > shift.start)
              .sort((a, b) => a.start - b.start);
        }

        // [SECTION: JS-INIT] — GET /info, εμφάνιση επιχείρησης, ημερολόγιο
        async function initPage() {
            if (!business_code) return;

            try {
                const res = await fetch(`${API_BASE_URL}/api/${business_code}/info`, { cache: 'no-store' });
                let payload = {};
                try { payload = await res.json(); } catch (e) {}
                if (!res.ok) {
                    throw new Error(payload.error || 'Η επιχείρηση δεν βρέθηκε.');
                }

                businessData = payload;

                applyClientTheme(businessData.client_theme || 'light');

                if (businessData.brand_color) {
                    document.documentElement.style.setProperty('--brand-color', businessData.brand_color);
                    document.body.style.setProperty('--brand-color', businessData.brand_color);
                }
                document.getElementById('businessName').textContent = businessData.name;
                document.getElementById('pageTitle').textContent = `Κράτηση Ραντεβού | ${businessData.name}`;
                const businessLogo = document.getElementById('businessLogo');
                businessLogo.src = businessData.logo_url || 'demo-logo.svg';
                businessLogo.alt = `Λογότυπο ${businessData.name}`;
                businessLogo.onerror = () => {
                    businessLogo.onerror = null;
                    businessLogo.src = 'demo-logo.svg';
                };
                document.getElementById('businessSubtitle').textContent =
                    businessData.booking_subtitle || 'Κλείστε το ραντεβού σας εύκολα και γρήγορα';
                const welcomeText = document.getElementById('welcomeText');
                if (businessData.welcome_text) {
                    welcomeText.textContent = businessData.welcome_text;
                    welcomeText.classList.remove('hidden');
                } else {
                    welcomeText.classList.add('hidden');
                }

                document.getElementById('shopInfoTitle').textContent = businessData.name || 'Πληροφορίες';
                if (businessData.address) {
                    const addrLink = document.getElementById('businessAddress');
                    addrLink.textContent = businessData.address;
                    addrLink.href = `https://maps.google.com/?q=${encodeURIComponent(businessData.address)}`;
                    document.getElementById('shopInfoAddressRow').classList.remove('hidden');
                }
                if (businessData.phone) {
                    const phoneLink = document.getElementById('businessPhone');
                    phoneLink.textContent = businessData.phone;
                    phoneLink.href = `tel:${businessData.phone}`;
                    document.getElementById('shopInfoPhoneRow').classList.remove('hidden');
                }

                fp.set('disableMobile', true);
                fp.set('disable', [(date) => isShopClosedOn(date)]);
                applyPublicFormFields(businessData.form_fields);

                businessHeader.classList.remove('hidden');

                (businessData.services || []).forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.name;
                    opt.setAttribute('data-duration', s.duration || 60);
                    opt.textContent = formatServiceLabel(s);
                    serviceSelect.appendChild(opt);
                });
                syncServicePicker();

                initialLoader.classList.add('hidden');
                bookingForm.classList.remove('hidden');

                if (isRequestMode()) {
                    document.getElementById('timeLabel').textContent = 'Προτιμώμενη ώρα *';
                    slotHint.textContent = 'Δεν κλείνει ώρα. Προτείνετε μέρα και ώρα· θα επικοινωνήσουμε για επιβεβαίωση.';
                    document.getElementById('submitBtnText').textContent = 'Αίτημα ραντεβού';
                    if (!businessData.booking_subtitle) {
                        document.getElementById('businessSubtitle').textContent = 'Στείλτε αίτημα ραντεβού για μέρα και ώρα';
                    }
                }

            } catch (err) {
                initialLoader.classList.add('hidden');
                const errorEl = document.getElementById('loadingError');
                errorEl.textContent = err.message || 'Η επιχείρηση δεν βρέθηκε ή υπάρχει πρόβλημα σύνδεσης.';
                errorEl.classList.remove('hidden');
            }
        }

        const fp = flatpickr(dateInput, {
            locale: 'gr',
            dateFormat: 'Y-m-d',
            minDate: 'today',
            disableMobile: true,
            disable: [(date) => businessData ? isShopClosedOn(date) : false],
            onChange: function (selectedDates, dateStr) {
                if (!dateStr) return;
                if (isShopClosedOn(dateStr)) {
                    dateInput.value = '';
                    fp.clear();
                    resetTimePickers('Κλειστό');
                    slotHint.textContent = 'Η επιχείρηση είναι κλειστή αυτή την ημέρα.';
                    slotHint.className = 'field-help field-help-wait';
                    return;
                }
                if (serviceSelect.value) {
                    fetchAvailableSlots(dateStr);
                }
            }
        });

        serviceSelect.addEventListener('change', () => {
            syncServicePicker();
            if (dateInput.value) {
                fetchAvailableSlots(dateInput.value);
            }
        });
        bookingForm.addEventListener('reset', () => {
            window.setTimeout(syncServicePicker, 0);
        });
        serviceSelect.addEventListener('invalid', (event) => {
            if (!window.matchMedia('(max-width: 640px)').matches) return;
            event.preventDefault();
            setServiceMenu(true);
        });

        const servicePickerBtn = document.getElementById('servicePickerBtn');
        const servicePickerList = document.getElementById('servicePickerList');

        function serviceMenuOpen() {
            return servicePickerList && !servicePickerList.classList.contains('hidden');
        }

        function setServiceMenu(open) {
            if (!servicePickerList || !servicePickerBtn) return;
            servicePickerList.classList.toggle('hidden', !open);
            servicePickerBtn.classList.toggle('is-open', open);
            servicePickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            document.documentElement.classList.toggle('service-menu-open', open);
            if (open) {
                const roomBelow = window.innerHeight - servicePickerBtn.getBoundingClientRect().bottom;
                servicePickerList.classList.toggle('is-up', roomBelow < 220);
                servicePickerList.classList.toggle('can-scroll', servicePickerList.scrollHeight > servicePickerList.clientHeight + 2);
            }
        }

        function syncServicePicker() {
            if (!servicePickerBtn || !servicePickerList) return;
            const chosen = serviceSelect.selectedOptions[0];
            servicePickerBtn.textContent = chosen && chosen.value ? chosen.textContent : 'Επιλέξτε υπηρεσία';
            servicePickerList.innerHTML = '';
            [...serviceSelect.options].forEach((option) => {
                if (!option.value) return;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'service-picker-item' + (option.selected ? ' is-on' : '');
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
                item.textContent = option.textContent;
                item.addEventListener('click', () => {
                    serviceSelect.value = option.value;
                    serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    setServiceMenu(false);
                });
                servicePickerList.appendChild(item);
            });
        }

        servicePickerBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!window.matchMedia('(max-width: 640px)').matches) return;
            setServiceMenu(!serviceMenuOpen());
        });
        servicePickerList?.addEventListener('click', (event) => event.stopPropagation());
        servicePickerList?.addEventListener('touchmove', (event) => {
            if (!servicePickerList.classList.contains('can-scroll')) event.preventDefault();
        }, { passive: false });
        document.addEventListener('click', () => {
            if (serviceMenuOpen()) setServiceMenu(false);
        });

        timeHourSelect.addEventListener('change', refreshMinuteOptions);
        document.getElementById('timePickerWrap').addEventListener('click', (event) => {
            event.stopPropagation();
            if (timeBtn.contains(event.target)) {
                if (timeHourSelect.disabled) return;
                timePanel.classList.toggle('hidden');
                timeBtn.classList.toggle('is-open', !timePanel.classList.contains('hidden'));
                paintTime();
                const hourCol = document.getElementById('timeHourCol');
                if (hourCol) hourCol.scrollTop = 0;
                return;
            }
            const hour = event.target.getAttribute('data-h');
            const min = event.target.getAttribute('data-m');
            if (hour) {
                timeHourSelect.value = hour;
                refreshMinuteOptions();
            }
            if (min) {
                timeMinuteSelect.value = min;
                timeMinuteSelect.disabled = false;
                if (timeHourSelect.value) closeTimeRollers();
                paintTime();
            }
        });
        document.addEventListener('click', closeTimeRollers);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeTimeRollers();
        });
        paintTime();

        // [SECTION: JS-SLOTS] — GET /availability, κλασικά slots (όχι request mode)
        async function fetchAvailableSlots(dateStr) {
            const requestId = ++availabilityRequestId;
            waitlistMode = false;
            hideWaitlistBox();
            resetTimePickers('Υπολογισμός...');
            slotHint.textContent = 'Παρακαλώ περιμένετε...';
            slotHint.className = 'field-help';
            if (!isRequestMode()) {
                document.getElementById('timeLabel').textContent = 'Διαθέσιμη Ώρα *';
                document.getElementById('submitBtnText').textContent = 'Υποβολή Αιτήματος Κράτησης';
            }

            const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
            const duration = parseInt(selectedOption.getAttribute('data-duration')) || 60;
            const bufferMinutes = (businessData && businessData.buffer_minutes) || 0;

            const shifts = getShiftsForDate(dateStr);
            if (shifts.length === 0) {
                if (requestId !== availabilityRequestId) return;
                resetTimePickers('Κλειστό');
                slotHint.textContent = 'Η επιχείρηση είναι κλειστή αυτή την ημέρα.';
                slotHint.className = 'field-help field-help-wait';
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/${business_code}/availability?date=${dateStr}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('Availability request failed');
                const data = await response.json();

                if (requestId !== availabilityRequestId) return;
                window._lastOccupied = data.occupied || [];

                if (data.day_full) {
                    if (waitlistAllowed()) {
                        showWaitlistCta(dateStr);
                    } else {
                        resetTimePickers('—');
                        slotHint.textContent = 'Η ημέρα έχει ήδη τα ραντεβού που δέχεται.';
                        slotHint.className = 'field-help field-help-wait';
                    }
                    return;
                }

                if (isRequestMode()) {
                    const blocked = (data.occupied || []).filter((occ) => occ.status === 'BLOCKED');
                    fillPreferredTimes(
                      'Προτιμώμενη ώρα μέσα στο ωράριο — δεν δεσμεύεται αυτόματα.',
                      false,
                      dateStr,
                      blocked,
                      duration
                    );
                    if (!availableSlots.length && waitlistAllowed()) {
                        showWaitlistCta(dateStr);
                        return;
                    }
                    document.getElementById('timeLabel').textContent = 'Προτιμώμενη ώρα *';
                    document.getElementById('submitBtnText').textContent = 'Αίτημα ραντεβού';
                    return;
                }

                const occupied = data.occupied || [];
                const stepMinutes = 30;
                let freeSlots = [];

                shifts.forEach(shift => {
                    const alignedStart = Math.ceil(shift.start / stepMinutes) * stepMinutes;
                    for (let currentMins = alignedStart; currentMins + duration <= shift.end; currentMins += stepMinutes) {
                        const slotStartMins = currentMins;
                        const slotEndMins = currentMins + duration + bufferMinutes;

                        const isOverlapping = occupied.some(occ => {
                            const occStart = timeToMinutes(occ.start_time);
                            const occEnd = timeToMinutes(occ.end_time);
                            return (slotStartMins < occEnd && slotEndMins > occStart);
                        });

                        if (!isOverlapping) {
                            freeSlots.push(minutesToTime(slotStartMins));
                        }
                    }
                });

                freeSlots = [...new Set(freeSlots)].sort();
                availableSlots = freeSlots;

                if (freeSlots.length === 0) {
                    if (waitlistAllowed()) {
                        showWaitlistCta(dateStr);
                        return;
                    }
                    resetTimePickers('—');
                    slotHint.textContent = 'Η ημέρα είναι πλήρης.';
                    slotHint.className = 'field-help field-help-wait';
                    return;
                }

                fillHourOptions(freeSlots);
                const windows = shifts.map((shift) => `${minutesToTime(shift.start)}–${minutesToTime(shift.end)}`);
                const missed = shifts.filter((shift) => !freeSlots.some((slot) => {
                    const mins = timeToMinutes(slot);
                    return mins >= shift.start && mins < shift.end;
                }));
                const missedNote = missed.map((shift) => {
                    const label = `${minutesToTime(shift.start)}–${minutesToTime(shift.end)}`;
                    if (duration > shift.end - shift.start) return `${label} δεν χωράει την υπηρεσία (${duration} λεπτά)`;
                    return `${label} είναι κατειλημμένη`;
                }).join('. ');
                slotHint.textContent = `Ωράριο: ${windows.join(', ')}. Διαθέσιμες: ${freeSlots.length}.${missedNote ? ' ' + missedNote + '.' : ''}`;
                slotHint.className = 'field-help field-help-ok';

            } catch (err) {
                if (requestId !== availabilityRequestId) return;
                resetTimePickers('Σφάλμα');
                slotHint.textContent = 'Αποτυχία σύνδεσης με τον διακομιστή.';
                slotHint.className = 'field-help field-help-err';
            }
        }

        function generateGoogleCalendarUrl(serviceName, dateStr, timeStr, durationMinutes) {
            const cleanDate = dateStr.replace(/-/g, '');
            const startCleanTime = timeStr.replace(/:/g, '') + '00';

            const startMins = timeToMinutes(timeStr);
            const endMins = startMins + durationMinutes;
            const endCleanTime = minutesToTime(endMins).replace(/:/g, '') + '00';

            const startDateTime = `${cleanDate}T${startCleanTime}`;
            const endDateTime = `${cleanDate}T${endCleanTime}`;

            const title = encodeURIComponent(`Ραντεβού: ${serviceName} (${businessData?.name || ''})`);
            const details = encodeURIComponent(`Κράτηση ραντεβού μέσω ${businessData?.name || 'πλατφόρμας'}.`);
            const location = encodeURIComponent(businessData?.address || '');

            return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDateTime}/${endDateTime}&details=${details}&location=${location}&ctz=Europe/Athens`;
        }

        function showSuccessDialog(text, calendarUrl) {
            const modal = document.getElementById('successModal');
            document.getElementById('successText').textContent = text;
            const calendar = document.getElementById('successCalendar');
            if (calendarUrl) {
                calendar.href = calendarUrl;
                calendar.classList.remove('hidden');
            } else {
                calendar.classList.add('hidden');
            }
            modal.classList.remove('hidden');
            document.getElementById('successOk').focus();
        }

        function closeSuccessDialog() {
            document.getElementById('successModal').classList.add('hidden');
        }

        function revealBookingResponse() {
            responseContainer.classList.remove('hidden');
            const card = responseContainer.closest('.booking-card');
            if (card) card.classList.add('is-answered');
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
            if (!window.matchMedia('(max-width: 640px)').matches) return;
            window.setTimeout(() => {
                responseContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                responseMessage.focus({ preventScroll: true });
            }, 60);
        }

        // [SECTION: JS-SUBMIT] — POST /bookings (slots | request | waitlist)
        bookingForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (document.getElementById('website').value !== '') return;

            if (!waitlistMode && (!selectedTimeValue() || !availableSlots.includes(selectedTimeValue()))) {
                gcalBtn.classList.add('hidden');
                responseMessage.className = 'text-red-600';
                responseMessage.textContent = 'Παρακαλώ επιλέξτε διαθέσιμη ώρα (π.χ. 18:00 ή 18:30).';
                revealBookingResponse();
                return;
            }

            const submitBtn = document.getElementById('submitBtn');
            const submitBtnText = document.getElementById('submitBtnText');
            const submitSpinner = document.getElementById('submitSpinner');

            submitBtn.disabled = true;
            submitBtnText.textContent = 'Αποστολή...';
            submitSpinner.classList.remove('hidden');
            responseContainer.classList.add('hidden');
            responseContainer.closest('.booking-card')?.classList.remove('is-answered');
            gcalBtn.classList.add('hidden');

            const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
            const duration = parseInt(selectedOption.getAttribute('data-duration')) || 60;
            const dateVal = dateInput.value;
            const timeVal = selectedTimeValue();
            const serviceNameVal = serviceSelect.value;
            const fields = (businessData && businessData.form_fields) || {};
            const customerName = document.getElementById('name').value.trim();
            const notesVal = fields.notes === false ? '' : (document.getElementById('notes').value || '').trim();
            const waitlistNote = 'Λίστα αναμονής — χωρίς συγκεκριμένη ώρα';

            const payload = {
                name: customerName,
                phone: fields.phone === false ? '' : document.getElementById('phone').value.trim(),
                email: fields.email === false ? '' : document.getElementById('email').value.trim(),
                instagram: fields.instagram === false ? '' : document.getElementById('instagram').value.trim(),
                service_name: serviceNameVal,
                duration: duration,
                date: dateVal,
                time: waitlistMode ? '' : timeVal,
                notes: waitlistMode
                    ? (notesVal && !notesVal.includes(waitlistNote) ? `${notesVal}\n${waitlistNote}` : (notesVal || waitlistNote))
                    : notesVal,
                waitlist: waitlistMode
            };

            try {
                const res = await fetch(`${API_BASE_URL}/api/${business_code}/bookings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    const successText = data.message || businessData?.success_message || 'Η κράτηση ολοκληρώθηκε επιτυχώς!';
                    let calendarUrl = '';
                    if (data.status !== 'WAITLIST' && !isRequestMode()) {
                        calendarUrl = generateGoogleCalendarUrl(serviceNameVal, dateVal, timeVal, duration);
                    }
                    bookingForm.reset();
                    resetTimePickers();
                    hideWaitlistBox();
                    slotHint.textContent = isRequestMode()
                        ? 'Προτιμώμενη ώρα — δεν δεσμεύεται αυτόματα. Θα επιβεβαιώσουμε μαζί σας.'
                        : 'Επιλέξτε ώρα και μετά 00 ή 30, μόνο από τις διαθέσιμες.';
                    slotHint.className = 'field-help';
                    document.getElementById('submitBtnText').textContent = isRequestMode() ? 'Αίτημα ραντεβού' : 'Υποβολή Αιτήματος Κράτησης';
                    fp.clear();
                    responseContainer.classList.add('hidden');
                    gcalBtn.classList.add('hidden');
                    showSuccessDialog(successText, calendarUrl);
                } else {
                    responseMessage.className = 'text-red-600';
                    responseMessage.textContent = data.error || 'Προέκυψε σφάλμα.';
                    revealBookingResponse();
                }
            } catch (err) {
                responseMessage.className = 'text-red-600';
                responseMessage.textContent = 'Σφάλμα σύνδεσης με τον διακομιστή.';
                revealBookingResponse();
            } finally {
                submitBtn.disabled = false;
                submitSpinner.classList.add('hidden');
                submitBtnText.textContent = waitlistMode
                    ? 'Ναι, ενημερώστε με'
                    : (isRequestMode() ? 'Αίτημα ραντεβού' : 'Υποβολή Αιτήματος Κράτησης');
            }
        });

        document.getElementById('leadForm')?.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const status = document.getElementById('leadStatus');
            const button = form.querySelector('button');
            const body = Object.fromEntries(new FormData(form).entries());
            status.textContent = '';
            status.className = 'home-lead-status';
            button.disabled = true;
            try {
                const res = await fetch(`${API_BASE_URL}/api/install-requests`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Το αίτημα δεν στάλθηκε.');
                form.reset();
                status.classList.add('is-ok');
                status.textContent = 'Το αίτημα καταχωρήθηκε.';
            } catch (err) {
                status.classList.add('is-err');
                status.textContent = err.message || 'Το αίτημα δεν στάλθηκε.';
            } finally {
                button.disabled = false;
            }
        });

document.getElementById('shopInfoBtn')?.addEventListener('click', openShopInfo);
document.getElementById('successOk')?.addEventListener('click', closeSuccessDialog);
document.getElementById('shopInfoModal')?.addEventListener('click', (event) => {
    if (event.target.id === 'shopInfoModal') closeShopInfo();
});
document.querySelector('.shop-info-close')?.addEventListener('click', closeShopInfo);

initPage();
