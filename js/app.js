import { HistoryManager } from './history.js';
import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';
import { UserManager } from './user.js';
import { QueueManager } from './queue.js';
import { DashboardManager } from './dashboard.js?v=21';

const settings = new SettingsManager();
const userManager = new UserManager(settings);
const dashboardManager = new DashboardManager(settings);

const audio = new AudioManager(settings);
const historyManager = new HistoryManager(settings, {
    onRedial: (num) => { ui.panels.history.classList.add('hidden'); ui.dialString.value = num; }
});

const ui = {
    dialString: document.getElementById('dialString'),
    loginPage: document.getElementById('loginPage'),
    mainApp: document.getElementById('mainApp'),
    loginInputs: { user: document.getElementById('loginUser'), pass: document.getElementById('loginPass'), domain: document.getElementById('loginDomain'), wss: document.getElementById('loginWss') },
    inputs: {
        user: document.getElementById('cfgUser'), pass: document.getElementById('cfgPass'),
        domain: document.getElementById('cfgDomain'), wss: document.getElementById('cfgWss'),
        mic: document.getElementById('cfgMic'), speaker: document.getElementById('cfgSpeaker'),
        ringer: document.getElementById('cfgRinging'), ringtone: document.getElementById('cfgRingtone')
    },
    panels: {
        config: document.getElementById('configModal'),
        incoming: document.getElementById('incomingModal'),
        idle: document.getElementById('idleState'),
        active: document.getElementById('activeState'),
        controls: document.getElementById('controlsBar'),
        history: document.getElementById('historyModal')
    },
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    btnCall: document.getElementById('btnCall')
};

const phoneCallbacks = {
    onStatus: (s) => {
        const ls = s ? s.toLowerCase() : "";
        ui.statusText.innerText = s;
        ui.statusDot.className = (ls === 'registered' || ls === 'connected') ? 'status-indicator connected' : 'status-indicator';
        if (ls === 'registered') {
            void refreshAgentIdentityFromApi().then(() => syncAgentPanelTitle());
        }
    },
    onIncoming: (c, a, r) => {
        document.getElementById('incomingIdentity').innerText = c;
        ui.panels.incoming.classList.remove('hidden');
        audio.startRinging();
        document.getElementById('btnAnswer').onclick = () => { a(); ui.panels.incoming.classList.add('hidden'); audio.stopRinging(); };
        document.getElementById('btnReject').onclick = () => { r(); ui.panels.incoming.classList.add('hidden'); audio.stopRinging(); };
    },
    onCallStart: (rem) => {
        ui.panels.idle.classList.add('hidden');
        ui.panels.active.classList.remove('hidden');
        ui.panels.controls.classList.add('active');
        document.getElementById('remoteIdentity').innerText = rem || "Unknown";
        startTimer();
    },
    onCallEnd: () => { ui.panels.active.classList.add('hidden'); ui.panels.idle.classList.remove('hidden'); ui.panels.controls.classList.remove('active'); stopTimer(); }
};

const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);

/**
 * Match live-status directory entry for the current login (extension, short ext, or auth SIP id).
 * Skips queue rows so queue extensions do not steal the match.
 * @param {Record<string, unknown>|null|undefined} directory
 * @param {string} username
 * @returns {{ name?: string, callerId?: string, key: string } & Record<string, unknown>|null}
 */
function findDirectoryEntryForUser(directory, username) {
    if (!directory || username == null || username === '') return null;
    const s = String(username).trim();
    if (!s) return null;

    /** @type {Map<string, Record<string, unknown> & { key: string }>} */
    const byKey = new Map();

    const push = (key, d) => {
        if (!key || !d || typeof d !== 'object') return;
        if (d.type === 'queue') return;
        const k = String(key);
        if (!byKey.has(k)) byKey.set(k, { ...d, key: k });
    };

    const direct = directory[s];
    if (direct && typeof direct === 'object') push(s, /** @type {Record<string, unknown>} */ (direct));

    for (const [key, d] of Object.entries(directory)) {
        if (!d || typeof d !== 'object') continue;
        if (d.type === 'queue') continue;
        const ext = d.extension != null ? String(d.extension) : '';
        const short = d.shortNumber != null ? String(d.shortNumber) : '';
        const authLogin = d.authLogin != null ? String(d.authLogin).trim() : '';
        if (ext === s || short === s || key === s || authLogin === s) {
            push(key, /** @type {Record<string, unknown>} */ (d));
        }
    }

    for (const row of byKey.values()) {
        if (row.type === 'agent') return row;
    }
    const first = byKey.values().next().value;
    return first ?? null;
}

/** Fetches phonebook-backed display name + CLI from the same API as the supervisor dashboard. */
async function refreshAgentIdentityFromApi() {
    const user = settings.get('username');
    if (!user) return;
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/live-status`);
        if (!res.ok) return;
        const data = await res.json();
        const entry = findDirectoryEntryForUser(data.directory, user);
        if (entry) {
            userManager.applyPhonebookIdentity({
                name: entry.name != null ? String(entry.name) : '',
                callerId: entry.callerId != null ? String(entry.callerId) : '',
                extension: user
            });
        }
    } catch (e) {
        console.warn('refreshAgentIdentityFromApi:', e);
    }
}

/** Sidebar header: phonebook display name, else CLI, else extension (use case: human-readable agent id). */
function syncAgentPanelTitle() {
    const titleEl = document.getElementById('agentPanelTitle');
    if (!titleEl) return;
    const user = settings.get('username');
    if (!user) {
        titleEl.textContent = 'Agent Panel';
        titleEl.style.display = '';
        return;
    }

    const namePb = (userManager.profile.name || '').trim();
    const cliPb = (userManager.profile.cli || '').trim();
    const primary = namePb || cliPb || user;

    titleEl.replaceChildren();
    titleEl.style.display = 'flex';
    titleEl.style.flexDirection = 'column';
    titleEl.style.alignItems = 'flex-start';
    titleEl.style.gap = '2px';
    titleEl.style.margin = '0';
    titleEl.style.fontWeight = '600';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.lineHeight = '1.2';
    row.style.fontSize = '0.95rem';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-user-tie';
    icon.style.marginRight = '8px';
    icon.style.flexShrink = '0';
    row.append(icon, document.createTextNode(primary));

    titleEl.append(row);

    if (namePb || cliPb) {
        const bits = [];
        if (cliPb) bits.push(`CLI ${cliPb}`);
        bits.push(`Ext ${user}`);
        const sub = document.createElement('div');
        sub.style.fontSize = '0.72rem';
        sub.style.fontWeight = '400';
        sub.style.color = 'var(--text-muted)';
        sub.style.lineHeight = '1.2';
        sub.style.paddingLeft = 'calc(0.95rem + 8px)';
        sub.textContent = bits.join(' · ');
        titleEl.append(sub);
    }
}

window.app = {
    dashboard: dashboardManager,
    async callSpecial(num) {
        if (num == null || String(num).trim() === '') return;
        const dest = String(num).trim();
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            ui.dialString.value = dest;
            await phone.call(dest);
        } catch (e) {
            console.error(e);
            alert(e?.message || 'Call failed');
        }
    }
};

function populateDevices(selectEl, devices, selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="default">Default Device</option>';
    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.text = d.label || `Device ${d.deviceId.slice(0,5)}`;
        if (d.deviceId === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

/** Puts Hero domain / WSS into login advanced fields (use force on boot so they are never left blank). */
function syncLoginServerFields({ force = false } = {}) {
    const domainEl = document.getElementById('loginDomain');
    const wssEl = document.getElementById('loginWss');
    if (!domainEl || !wssEl) return;
    const d = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    const w = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;
    if (force || !domainEl.value.trim()) domainEl.value = d;
    if (force || !wssEl.value.trim()) wssEl.value = w;
}

function setupTabs() {
    document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            
            // 1. Remove active class from all buttons and add to the clicked one
            document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 2. Hide all tab contents and show the selected one
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                if (content.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

function attachEvents() {
    // Sign In: save server settings from advanced fields, then start SIP (this handler was missing, so login did nothing).
    document.getElementById('btnDoLogin').onclick = async () => {
        const user = ui.loginInputs.user.value.trim();
        const pass = ui.loginInputs.pass.value;
        const domain = (ui.loginInputs.domain.value || CONFIG.DEFAULT_DOMAIN).trim();
        const wss = (ui.loginInputs.wss.value || CONFIG.DEFAULT_WSS).trim();

        if (!user || !pass) {
            alert('Please enter extension and password');
            return;
        }

        settings.save({
            username: user,
            password: pass,
            domain,
            wssUrl: wss
        });

        ui.loginPage.classList.add('hidden');
        ui.mainApp.classList.remove('hidden');

        await userManager.initializeFromExtension(user);
        await refreshAgentIdentityFromApi();
        syncAgentPanelTitle();

        if (userManager.hasRole('supervisor')) {
            document.getElementById('supervisorDashboard').classList.remove('hidden');
            dashboardManager.start();
        }

        phone.connect();
    };

    ui.btnCall.onclick = async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            if (ui.dialString.value) phone.call(ui.dialString.value);
        } catch (e) { alert("Mic access denied."); }
    };
    document.getElementById('btnHangup').onclick = () => phone.hangup();
    document.getElementById('btnMute').onclick = function() { this.classList.toggle('active', phone.toggleMute()); };
    document.getElementById('btnHold').onclick = async function() { this.classList.toggle('active', await phone.toggleHold()); };

    const btnBlind = document.getElementById('btnTransferBlind');
    if (btnBlind) {
        btnBlind.onclick = () => {
            if (!phone.isCallActive()) {
                alert('No active call to transfer.');
                return;
            }
            const num = window.prompt('Blind transfer to extension or number:', '');
            if (num == null || String(num).trim() === '') return;
            if (!phone.blindTransfer(num.trim())) {
                alert('Transfer could not be started. Check console for details.');
            }
        };
    }
    const btnAtt = document.getElementById('btnTransferAttended');
    if (btnAtt) {
        btnAtt.onclick = () => {
            alert(
                'Attended transfer: place a consultation call to the third party from the dialpad, then complete the transfer from your desk phone or PBX feature codes if available. This Web client currently supports blind transfer (phone-arrow button) via SIP REFER.'
            );
        };
    }
    document.getElementById('btnShowConfig').onclick = () => {
        ui.inputs.user.value = settings.get('username');
        ui.inputs.pass.value = settings.get('password');
        ui.panels.config.classList.remove('hidden');
    };
    document.getElementById('btnCloseConfig').onclick = () => ui.panels.config.classList.add('hidden');
    document.getElementById('btnSaveConfig').onclick = () => {
        settings.save({ 
            username: ui.inputs.user.value, password: ui.inputs.pass.value,
            micId: ui.inputs.mic.value, speakerId: ui.inputs.speaker.value, ringerId: ui.inputs.ringer.value
        });
        void userManager.initializeFromExtension(ui.inputs.user.value.trim()).then(async () => {
            await refreshAgentIdentityFromApi();
            syncAgentPanelTitle();
        });
        ui.panels.config.classList.add('hidden');
        phone.connect();
    };
    document.querySelectorAll('.digit-btn').forEach(b => b.onclick = () => ui.dialString.value += b.dataset.digit);
    document.getElementById('btnToggleAdvanced').onclick = () => {
        const adv = document.getElementById('loginAdvanced');
        const opening = adv.classList.contains('hidden');
        adv.classList.toggle('hidden');
        if (opening) syncLoginServerFields();
    };
    
    // Attach the history button listener
    document.getElementById('btnShowHistory').onclick = () => {
        ui.panels.history.classList.remove('hidden');
        historyManager.render('historyList');
    };
    document.getElementById('btnCloseHistory').onclick = () => ui.panels.history.classList.add('hidden');
}

async function bootstrap() {
    attachEvents();
    setupTabs();

    // Module + imports can load after DOMContentLoaded; do not rely on that event alone.
    syncLoginServerFields({ force: true });

    const devs = await audio.init();
    populateDevices(ui.inputs.mic, devs.inputs, settings.get('micId'));
    populateDevices(ui.inputs.speaker, devs.outputs, settings.get('speakerId'));
    populateDevices(ui.inputs.ringer, devs.outputs, settings.get('ringerId'));

    if (settings.get('username') && settings.get('password')) {
        ui.loginPage.classList.add('hidden');
        ui.mainApp.classList.remove('hidden');
        await userManager.initializeFromExtension(settings.get('username'));
        await refreshAgentIdentityFromApi();
        syncAgentPanelTitle();
        if (userManager.hasRole('supervisor')) {
            document.getElementById('supervisorDashboard').classList.remove('hidden');
            dashboardManager.start();
        }
        phone.connect();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
    void bootstrap();
}

// Late pass: covers rare timing gaps; also helps once a newly fetched module runs after a cached HTML page.
window.addEventListener('load', () => syncLoginServerFields());

let timerInterval, timerSeconds = 0;
function startTimer() { 
    timerSeconds = 0; 
    timerInterval = setInterval(() => {
        timerSeconds++;
        const m = Math.floor(timerSeconds/60).toString().padStart(2,'0');
        const s = (timerSeconds%60).toString().padStart(2,'0');
        document.getElementById('callTimer').innerText = `${m}:${s}`;
    }, 1000); 
}
function stopTimer() { clearInterval(timerInterval); }