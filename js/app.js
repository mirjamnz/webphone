import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm'; // Needed for Enums if used here

// --- Initialize Modules ---
const settings = new SettingsManager();
const audio = new AudioManager(settings);

// --- UI Elements ---
const ui = {
    // Inputs
    dialString: document.getElementById('dialString'),
    
    // Config
    inputs: {
        user: document.getElementById('cfgUser'),
        pass: document.getElementById('cfgPass'),
        domain: document.getElementById('cfgDomain'),
        wss: document.getElementById('cfgWss'),
        mic: document.getElementById('cfgMic'),
        speaker: document.getElementById('cfgSpeaker'),
        ringer: document.getElementById('cfgRinging')
    },
    
    // Panels
    panels: {
        config: document.getElementById('configModal'),
        incoming: document.getElementById('incomingModal'),
        idle: document.getElementById('idleState'),
        active: document.getElementById('activeState'),
        controls: document.getElementById('controlsBar')
    },

    // Status
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    btnLogin: document.getElementById('btnLogin'),
    
    // Active Call
    remoteIdentity: document.getElementById('remoteIdentity'),
    timer: document.getElementById('callTimer'),
    
    // Buttons
    btnMute: document.getElementById('btnMute')
};

// --- Phone Engine Callback Definition ---
const phoneCallbacks = {
    onStatus: (state) => {
        ui.statusText.innerText = state;
        if (state === 'Registered') {
            ui.statusDot.className = 'status-indicator connected';
            ui.btnLogin.innerHTML = '<i class="fa-solid fa-rotate"></i> Reconnect';
        } else {
            ui.statusDot.className = 'status-indicator';
        }
    },
    onIncoming: (caller, acceptCb, rejectCb) => {
        document.getElementById('incomingIdentity').innerText = caller;
        ui.panels.incoming.classList.remove('hidden');
        
        // Bind temporary click listeners
        const btnAnswer = document.getElementById('btnAnswer');
        const btnReject = document.getElementById('btnReject');

        btnAnswer.onclick = () => {
            ui.panels.incoming.classList.add('hidden');
            acceptCb();
        };
        btnReject.onclick = () => {
            ui.panels.incoming.classList.add('hidden');
            rejectCb();
        };
    },
    onCallStart: (remoteUser) => {
        ui.panels.idle.classList.add('hidden');
        ui.panels.active.classList.remove('hidden');
        ui.panels.controls.classList.add('active');
        ui.remoteIdentity.innerText = remoteUser;
        startTimer();
    },
    onCallEnd: () => {
        ui.panels.idle.classList.remove('hidden');
        ui.panels.active.classList.add('hidden');
        ui.panels.controls.classList.remove('active');
        ui.panels.incoming.classList.add('hidden'); // Safety
        stopTimer();
    }
};

const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);

// --- Global App Object (for HTML onclicks) ---
window.app = {
    callSpecial: (num) => {
        phone.call(num);
    }
};

// --- Event Listeners ---

// 1. Initialization
window.addEventListener('DOMContentLoaded', async () => {
    // Load Settings into Config UI
    ui.inputs.user.value = settings.get('username');
    ui.inputs.pass.value = settings.get('password');
    ui.inputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.inputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;

    // Load Audio Devices
    const devices = await audio.init();
    populateDeviceSelect(ui.inputs.mic, devices.inputs, settings.get('micId'));
    populateDeviceSelect(ui.inputs.speaker, devices.outputs, settings.get('speakerId'));
    populateDeviceSelect(ui.inputs.ringer, devices.outputs, settings.get('ringerId'));

    // Auto-connect if credentials exist
    if (settings.get('username') && settings.get('password')) {
        phone.connect();
    }
});

// 2. Login / Save Config
document.getElementById('btnSaveConfig').addEventListener('click', () => {
    settings.save({
        username: ui.inputs.user.value,
        password: ui.inputs.pass.value,
        domain: ui.inputs.domain.value,
        wssUrl: ui.inputs.wss.value,
        micId: ui.inputs.mic.value,
        speakerId: ui.inputs.speaker.value,
        ringerId: ui.inputs.ringer.value
    });
    
    document.getElementById('configModal').classList.add('hidden');
    phone.connect(); // Reconnect with new settings
});

// 3. Dialing
document.getElementById('btnCall').addEventListener('click', () => {
    const num = ui.dialString.value;
    if (num) phone.call(num);
});

// 4. Dial Pad Clicks
document.querySelectorAll('.digit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const digit = btn.getAttribute('data-digit');
        // If in call, send DTMF
        if (phone.session && phone.session.state === SIP.SessionState.Established) {
            phone.sendDTMF(digit);
        } else {
            ui.dialString.value += digit;
        }
    });
});

// 5. In-Call Controls
document.getElementById('btnHangup').addEventListener('click', () => phone.hangup());

document.getElementById('btnMute').addEventListener('click', () => {
    const isMuted = phone.toggleMute();
    ui.btnMute.classList.toggle('active', isMuted);
});

document.getElementById('btnHold').addEventListener('click', () => {
    phone.toggleHold();
    // Toggle visual state in Phase 2
});

// 6. UI Toggles
document.getElementById('btnShowConfig').addEventListener('click', () => ui.panels.config.classList.remove('hidden'));
document.getElementById('btnCloseConfig').addEventListener('click', () => ui.panels.config.classList.add('hidden'));
document.getElementById('btnLogin').addEventListener('click', () => phone.connect());

// --- Helpers ---

function populateDeviceSelect(selectEl, devices, selectedId) {
    selectEl.innerHTML = ''; // Clear
    
    // Add "Default" option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.text = 'Default Device';
    selectEl.appendChild(defaultOpt);

    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.text = d.label || `Device ${d.deviceId.slice(0,5)}...`;
        if (d.deviceId === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

let timerInterval;
let timerSeconds = 0;

function startTimer() {
    timerSeconds = 0;
    ui.timer.innerText = "00:00";
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timerSeconds++;
        const mins = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
        const secs = (timerSeconds % 60).toString().padStart(2, '0');
        ui.timer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}