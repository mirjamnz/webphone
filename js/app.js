import { HistoryManager } from './history.js';
import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';
import { BlfManager } from './blf.js';
import { UserManager } from './user.js';
import { QueueManager } from './queue.js';
import { DashboardManager } from './dashboard.js';

const settings = new SettingsManager();
const userManager = new UserManager(settings);
const dashboardManager = new DashboardManager(settings);
window.app = { dashboard: dashboardManager };
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
        ui.panels.config.classList.add('hidden');
        phone.connect();
    };
    document.querySelectorAll('.digit-btn').forEach(b => b.onclick = () => ui.dialString.value += b.dataset.digit);
    document.getElementById('btnToggleAdvanced').onclick = () => document.getElementById('loginAdvanced').classList.toggle('hidden');
    
    // Attach the history button listener
    document.getElementById('btnShowHistory').onclick = () => {
        ui.panels.history.classList.remove('hidden');
        historyManager.render('historyList');
    };
    document.getElementById('btnCloseHistory').onclick = () => ui.panels.history.classList.add('hidden');
}

window.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    setupTabs(); // <-- Re-added the missing function call

    // Default Hero domain / WSS in advanced login fields (saved values or CONFIG).
    ui.loginInputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.loginInputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;
    
    const devs = await audio.init();
    populateDevices(ui.inputs.mic, devs.inputs, settings.get('micId'));
    populateDevices(ui.inputs.speaker, devs.outputs, settings.get('speakerId'));
    populateDevices(ui.inputs.ringer, devs.outputs, settings.get('ringerId'));

    if (settings.get('username') && settings.get('password')) {
        ui.loginPage.classList.add('hidden');
        ui.mainApp.classList.remove('hidden');
        await userManager.initializeFromExtension(settings.get('username'));
        if (userManager.hasRole('supervisor')) {
            document.getElementById('supervisorDashboard').classList.remove('hidden');
            dashboardManager.start();
        }
        phone.connect();
    }
});

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