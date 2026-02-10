import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';

const settings = new SettingsManager();
const audio = new AudioManager(settings);

const ui = {
    dialString: document.getElementById('dialString'),
    inputs: {
        user: document.getElementById('cfgUser'),
        pass: document.getElementById('cfgPass'),
        domain: document.getElementById('cfgDomain'),
        wss: document.getElementById('cfgWss'),
        mic: document.getElementById('cfgMic'),
        speaker: document.getElementById('cfgSpeaker'),
        ringer: document.getElementById('cfgRinging')
    },
    panels: {
        config: document.getElementById('configModal'),
        incoming: document.getElementById('incomingModal'),
        idle: document.getElementById('idleState'),
        active: document.getElementById('activeState'),
        controls: document.getElementById('controlsBar')
    },
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    btnLogin: document.getElementById('btnLogin'),
    remoteIdentity: document.getElementById('remoteIdentity'),
    timer: document.getElementById('callTimer'),
    btnMute: document.getElementById('btnMute'),
    btnHold: document.getElementById('btnHold')
};

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
        ui.panels.incoming.classList.add('hidden');
        ui.panels.idle.classList.add('hidden');
        ui.panels.active.classList.remove('hidden');
        
        // Reset button states
        ui.btnMute.classList.remove('active');
        ui.btnHold.classList.remove('active');

        setTimeout(() => {
            ui.panels.controls.classList.add('active');
        }, 50);

        ui.remoteIdentity.innerText = remoteUser || "Unknown";
        startTimer();
    },
    onCallEnd: () => {
        ui.panels.idle.classList.remove('hidden');
        ui.panels.active.classList.add('hidden');
        ui.panels.controls.classList.remove('active');
        ui.panels.incoming.classList.add('hidden'); 
        
        // Hide Consult controls if they were open
        document.getElementById('consultControls').classList.add('hidden');
        
        stopTimer();
    }
};

const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);

window.app = {
    callSpecial: (num) => {
        phone.call(num).catch(e => alert(e.message));
    }
};

// --- Event Listeners ---

window.addEventListener('DOMContentLoaded', async () => {
    ui.inputs.user.value = settings.get('username');
    ui.inputs.pass.value = settings.get('password');
    ui.inputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.inputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;

    const devices = await audio.init();
    populateDeviceSelect(ui.inputs.mic, devices.inputs, settings.get('micId'));
    populateDeviceSelect(ui.inputs.speaker, devices.outputs, settings.get('speakerId'));
    populateDeviceSelect(ui.inputs.ringer, devices.outputs, settings.get('ringerId'));

    if (settings.get('username') && settings.get('password')) {
        phone.connect();
    }
});

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
    phone.connect();
});

document.getElementById('btnCall').addEventListener('click', () => {
    const num = ui.dialString.value;
    if (num) {
        phone.call(num).catch(e => {
            console.error("Call Failed:", e);
            alert("Call Error: " + e.message);
        });
    }
});

// Dial Pad Logic
document.querySelectorAll('.digit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const digit = btn.getAttribute('data-digit');
        if (phone.isCallActive()) {
            phone.sendDTMF(digit);
        } else {
            ui.dialString.value += digit;
        }
    });
});

document.getElementById('btnHangup').addEventListener('click', () => {
    phone.hangup();
});

document.getElementById('btnMute').addEventListener('click', () => {
    const isMuted = phone.toggleMute();
    ui.btnMute.classList.toggle('active', isMuted);
});

// Hold Button Logic
document.getElementById('btnHold').addEventListener('click', async () => {
    const isHeld = await phone.toggleHold();
    ui.btnHold.classList.toggle('active', isHeld);
});

// --- Blind Transfer Logic ---
document.getElementById('btnTransfer').addEventListener('click', () => {
    const num = prompt("Enter extension to transfer to:");
    if (num) {
        phone.blindTransfer(num).then(success => {
            if(success) console.log("Transfer initiated...");
        });
    }
});

// --- Warm Transfer / Line Manager Logic ---
const consultControls = document.getElementById('consultControls');
const btnLine1 = document.getElementById('btnLine1');
const btnLine2 = document.getElementById('btnLine2');

document.getElementById('btnConsult').addEventListener('click', () => {
    const num = prompt("Enter number to consult:");
    if (num) {
        phone.startConsultation(num).then(() => {
            consultControls.classList.remove('hidden');
            updateLineUI(2); // Line 2 is active by default
        }).catch(err => alert("Consult failed: " + err));
    }
});

// Toggle to Line 1 (Original Caller)
btnLine1.addEventListener('click', () => {
    phone.swapToLine(1).then(() => updateLineUI(1));
});

// Toggle to Line 2 (Colleague)
btnLine2.addEventListener('click', () => {
    phone.swapToLine(2).then(() => updateLineUI(2));
});

// Complete the Transfer
document.getElementById('btnCompleteTransfer').addEventListener('click', () => {
    phone.completeConsultation().then(success => {
        if (success) {
            consultControls.classList.add('hidden');
        }
    });
});

// Cancel (Hangup Line 2, Return to Line 1)
document.getElementById('btnCancelConsult').addEventListener('click', () => {
    phone.cancelConsultation(); // This kills Line 2
    phone.toggleHold();         // Unhold Line 1 (Resume)
    consultControls.classList.add('hidden');
});

// Helper to visually toggle button styles
function updateLineUI(activeLine) {
    if (activeLine === 1) {
        btnLine1.className = "btn btn-success";
        btnLine1.innerHTML = '<i class="fa-solid fa-user"></i> Line 1 (Active)';
        
        btnLine2.className = "btn";
        btnLine2.style.background = "#334155";
        btnLine2.innerHTML = '<i class="fa-solid fa-user-doctor"></i> Line 2 (Held)';
    } else {
        btnLine1.className = "btn";
        btnLine1.style.background = "#334155";
        btnLine1.innerHTML = '<i class="fa-solid fa-user"></i> Line 1 (Held)';
        
        btnLine2.className = "btn btn-success";
        btnLine2.innerHTML = '<i class="fa-solid fa-user-doctor"></i> Line 2 (Active)';
    }
}

// --- General Helpers (Previously missing from your paste) ---

function populateDeviceSelect(selectEl, devices, selectedId) {
    selectEl.innerHTML = ''; 
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