(() => {
    const PRECISIONS = ['day', 'few-hours', 'hour', 'minute', 'second'];

    const $ = (id) => document.getElementById(id);

    const escapeHtml = (value) => (value || '').toString().replace(/[&<"'>]/g, (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[match]));

    const makeDomId = (value) => encodeURIComponent(String(value));

    const formatDays = (days) => {
        if (days === 1) return '1 den';
        if (days >= 2 && days <= 4) return `${days} dny`;
        return `${days} dní`;
    };

    const formatTime = (totalSeconds, precision) => {
        const safeSeconds = Math.max(0, totalSeconds);
        const days = Math.floor(safeSeconds / 86400);
        const hours = Math.floor((safeSeconds % 86400) / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const seconds = safeSeconds % 60;
        const daysPrefix = days > 0 ? `${formatDays(days)} ` : '';

        switch (precision) {
            case 'day':
                return formatDays(days);
            case 'few-hours':
            case 'hour':
                return `${daysPrefix}${hours}h`;
            case 'minute':
                return `${daysPrefix}${hours}h ${minutes}m`;
            case 'second':
            default:
                return `${daysPrefix}${hours}h ${minutes}m ${seconds}s`;
        }
    };

    const unixToDatetimeLocal = (unixSeconds) => {
        if (!unixSeconds) return '';

        const date = new Date(unixSeconds * 1000);
        const pad = (value) => value.toString().padStart(2, '0');

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const initIndexPage = () => {
        const gridEl = $('counters-grid');
        const errorEl = $('error-msg');
        let counters = [];

        const renderGrid = () => {
            gridEl.innerHTML = counters.map((counter) => `
                <div class="counter-card">
                    <div class="counter-name">[ ${escapeHtml(counter.name)} ]</div>
                    <div class="counter-desc">${escapeHtml(counter.description) || 'No description'}</div>
                    <div class="counter-value" id="val-${counter.domId}">...</div>
                    ${counter.info ? `<div class="counter-info">${escapeHtml(counter.info)}</div>` : ''}
                </div>
            `).join('');
        };

        const tick = () => {
            const now = Math.floor(Date.now() / 1000);

            counters.forEach((counter) => {
                const valueEl = $(`val-${counter.domId}`);
                if (valueEl) {
                    valueEl.innerText = formatTime(Math.max(0, now - counter.timestamp), counter.precision);
                }
            });
        };

        const fetchCounters = async () => {
            try {
                const res = await fetch('/counters');
                if (!res.ok) throw new Error(res.statusText);

                counters = (await res.json()).map((counter) => ({
                    ...counter,
                    domId: makeDomId(counter.name)
                }));

                errorEl.style.display = 'none';
                renderGrid();
                tick();
            } catch (error) {
                errorEl.innerText = `[ERR] API unreachable: ${error.message}`;
                errorEl.style.display = 'block';
            }
        };

        fetchCounters();
        setInterval(tick, 1000);
        setInterval(fetchCounters, 15000);
    };

    const initAdminPage = () => {
        const gridEl = $('counters-grid');
        const logEl = $('log');
        const passInput = $('auth-pass');
        const rememberBox = $('remember-pass');
        const lockoutBtn = document.querySelector('[data-action="lockout"]');
        let counters = [];

        passInput.value = localStorage.getItem('sudo_pass') || '';
        if (rememberBox) {
            rememberBox.checked = !!passInput.value;
        }

        const handleAuthChange = () => {
            if (rememberBox && rememberBox.checked) {
                localStorage.setItem('sudo_pass', passInput.value);
                return;
            }

            localStorage.removeItem('sudo_pass');
        };

        passInput.addEventListener('input', handleAuthChange);
        if (rememberBox) rememberBox.addEventListener('change', handleAuthChange);

        const logMsg = (message, isError = false) => {
            const time = new Date().toLocaleTimeString();
            logEl.insertAdjacentHTML('afterbegin', `<div class="log-entry ${isError ? 'log-err' : 'log-ok'}">[${time}] ${escapeHtml(message)}</div>`);
        };

        const apiCall = async (endpoint, method, payload = null) => {
            const pass = passInput.value;
            if (!pass) {
                logMsg('Error: Password is required!', true);
                throw new Error('Missing password');
            }

            const options = {
                method,
                headers: {
                    Authorization: 'Basic ' + btoa(':' + pass),
                    'Content-Type': 'application/json'
                }
            };

            if (payload) {
                options.body = JSON.stringify(payload);
            }

            try {
                const res = await fetch(endpoint, options);
                const data = await res.json();

                if (!res.ok) throw new Error(data.error || 'Unknown API error');

                logMsg(`${method} ${endpoint} -> OK`);
                return data;
            } catch (error) {
                logMsg(`${method} ${endpoint} -> ${error.message}`, true);
                throw error;
            }
        };

        const readCounterForm = (counterId) => ({
            name: $(`name-${counterId}`).value.trim(),
            description: $(`desc-${counterId}`).value,
            info: $(`info-${counterId}`).value,
            precision: $(`prec-${counterId}`).value,
            timestampValue: $(`ts-${counterId}`).value
        });

        const saveCounter = async (counterId) => {
            const form = readCounterForm(counterId);
            if (!form.name) return logMsg('Name cannot be empty', true);

            const timestamp = form.timestampValue
                ? Math.floor(new Date(form.timestampValue).getTime() / 1000)
                : Math.floor(Date.now() / 1000);

            try {
                await apiCall(`/counter/${form.name}`, 'PUT', {
                    description: form.description,
                    info: form.info,
                    precision: form.precision,
                    timestamp
                });
                loadCounters();
            } catch (error) {
                void error;
            }
        };

        const resetCounter = async (counterId) => {
            const { name } = readCounterForm(counterId);

            try {
                await apiCall(`/counter/${name}/reset`, 'POST');
                loadCounters();
            } catch (error) {
                void error;
            }
        };

        const deleteCounter = async (counterId) => {
            const { name } = readCounterForm(counterId);
            if (!confirm(`Are you sure you want to delete counter '${name}'?`)) return;

            try {
                await apiCall(`/counter/${name}`, 'DELETE');
                loadCounters();
            } catch (error) {
                void error;
            }
        };

        const triggerLockout = async () => {
            if (!confirm('WARNING: This irreversibly destroys the password file. The admin interface will return HTTP 403 until a new password is set via CLI. Continue?')) return;

            try {
                await apiCall('/lockout', 'POST');
                alert('Lockout successful. Admin interface is now locked.');
            } catch (error) {
                void error;
            }
        };

        const renderNewCounterCard = () => `
            <div class="counter-card new-card" id="card-new">
                <div class="counter-value" id="val-new">[ NOVÉ POČÍTADLO ]</div>
                <div class="form-group">
                    <label>NAME (ID)</label>
                    <input type="text" id="name-new" placeholder="e.g. fire">
                </div>
                <div class="form-group">
                    <label>DESCRIPTION</label>
                    <input type="text" id="desc-new">
                </div>
                <div class="form-group">
                    <label>INFO (Detail)</label>
                    <input type="text" id="info-new">
                </div>
                <div class="form-group">
                    <label>PRECISION</label>
                    <select id="prec-new">
                        ${PRECISIONS.map((precision) => `<option value="${precision}" ${precision === 'day' ? 'selected' : ''}>${precision}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>TIMESTAMP (Empty = Now)</label>
                    <input type="datetime-local" id="ts-new">
                </div>
                <div class="actions">
                    <button class="btn action-btn" type="button" data-action="save" data-id="new">[+] CREATE</button>
                </div>
            </div>`;

        const renderCounterCard = (counter) => `
            <div class="counter-card" id="card-${counter.domId}">
                <div class="counter-value" id="val-${counter.domId}">...</div>
                <div class="form-group">
                    <label>NAME (ID)</label>
                    <input type="text" id="name-${counter.domId}" value="${escapeHtml(counter.name)}" disabled>
                </div>
                <div class="form-group">
                    <label>DESCRIPTION</label>
                    <input type="text" id="desc-${counter.domId}" value="${escapeHtml(counter.description)}">
                </div>
                <div class="form-group">
                    <label>INFO (Detail)</label>
                    <input type="text" id="info-${counter.domId}" value="${escapeHtml(counter.info)}">
                </div>
                <div class="form-group">
                    <label>PRECISION</label>
                    <select id="prec-${counter.domId}">
                        ${PRECISIONS.map((precision) => `<option value="${precision}" ${counter.precision === precision ? 'selected' : ''}>${precision}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>TIMESTAMP (Empty = Now)</label>
                    <input type="datetime-local" id="ts-${counter.domId}" value="${unixToDatetimeLocal(counter.timestamp)}">
                </div>
                <div class="actions">
                    <button class="btn action-btn" type="button" data-action="save" data-id="${counter.domId}">SAVE</button>
                    <button class="btn" type="button" data-action="reset" data-id="${counter.domId}">RESET TO NOW</button>
                    <button class="btn danger-btn" type="button" data-action="delete" data-id="${counter.domId}">DELETE</button>
                </div>
            </div>`;

        const loadCounters = async () => {
            try {
                const res = await fetch('/counters');
                if (!res.ok) throw new Error(res.statusText);

                counters = (await res.json()).map((counter) => ({
                    ...counter,
                    domId: makeDomId(counter.name)
                }));

                gridEl.innerHTML = renderNewCounterCard() + counters.map(renderCounterCard).join('');
                tick();
            } catch (error) {
                logMsg(`Failed to load counters: ${error.message}`, true);
            }
        };

        const tick = () => {
            const now = Math.floor(Date.now() / 1000);

            counters.forEach((counter) => {
                const valueEl = $(`val-${counter.domId}`);
                const precisionEl = $(`prec-${counter.domId}`);
                const precision = precisionEl ? precisionEl.value : counter.precision;

                if (valueEl) {
                    valueEl.innerText = formatTime(Math.max(0, now - counter.timestamp), precision);
                }
            });

            const newValueEl = $('val-new');
            if (newValueEl) {
                newValueEl.innerText = '[ NOVÉ POČÍTADLO ]';
            }
        };

        gridEl.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button || !gridEl.contains(button)) return;

            const { action, id } = button.dataset;
            if (action === 'save') saveCounter(id);
            if (action === 'reset') resetCounter(id);
            if (action === 'delete') deleteCounter(id);
        });

        gridEl.addEventListener('change', (event) => {
            const select = event.target.closest('select');
            if (!select || !gridEl.contains(select) || !select.id.startsWith('prec-')) return;

            saveCounter(select.id.slice(5));
        });

        if (lockoutBtn) {
            lockoutBtn.addEventListener('click', triggerLockout);
        }

        loadCounters();
        setInterval(tick, 1000);
    };

    if ($('error-msg')) {
        initIndexPage();
    }

    if ($('log')) {
        initAdminPage();
    }
})();
