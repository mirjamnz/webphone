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
    btnHold: document.getElementById('btnHold'),
    // Line Manager UI
    consultControls: document.getElementById('consultControls'),
    btnLine1: document.getElementById('btnLine1'),
    btnLine2: document.getElementById('btnLine2'),
    // Main Call Button
    btnCall: document.getElementById('btnCall')
};

// --- State Variables ---
let isConsulting = false; 
let line1Num = "Line 1"; // Stores the number for the first call
let line2Num = "Line 2"; // Stores the number for the second call

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
            line1Num = caller; // Save incoming number
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
        
        ui.btnMute.classList.remove('active');
        ui.btnHold.classList.remove('active');
        isConsulting = false;
        resetCallButton();

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
        
        ui.consultControls.classList.add('hidden');
        
        // RESTORE Standard Buttons
        document.getElementById('btnTransfer').classList.remove('hidden');
        document.getElementById('btnConsult').classList.remove('hidden');

        isConsulting = false;
        line1Num = "Line 1"; // Reset
        line2Num = "Line 2"; // Reset
        resetCallButton();
        stopTimer();
    }
};

const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);

window.app = {
    callSpecial: (num) => {
        phone.call(num).catch(e => alert(e.message));
    }
};

// --- UI Helpers for Consult Mode ---
function setCallButtonToConsultMode() {
    ui.btnCall.classList.remove('btn-success');
    ui.btnCall.classList.add('btn-warning');
    ui.btnCall.innerHTML = '<i class="fa-solid fa-user-plus"></i> Dial 2nd Line';
    ui.dialString.placeholder = "Enter Colleague #";
    ui.dialString.value = "";
    ui.dialString.focus();
}

function resetCallButton() {
    ui.btnCall.classList.remove('btn-warning');
    ui.btnCall.classList.add('btn-success');
    ui.btnCall.innerHTML = '<i class="fa-solid fa-phone"></i> Call';
    ui.dialString.placeholder = "Enter Number...";
}

// --- UPDATED: UI Helper with Custom Names ---
function updateLineUI(activeLine) {
    // Reset base classes
    ui.btnLine1.className = "tab-btn";
    ui.btnLine2.className = "tab-btn";

    if (activeLine === 1) {
        // Line 1 Active
        ui.btnLine1.classList.add('active-line');
        ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Active)</span>`;
        
        // Line 2 Held
        ui.btnLine2.classList.add('held-line');
        ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Held)</span>`;
    } else {
        // Line 1 Held
        ui.btnLine1.classList.add('held-line');
        ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Held)</span>`;
        
        // Line 2 Active
        ui.btnLine2.classList.add('active-line');
        ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Active)</span>`;
    }
}

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

ui.btnCall.addEventListener('click', () => {
    const num = ui.dialString.value;
    if (!num) return;

    if (isConsulting) {
        console.log("Dialing 2nd line:", num);
        line2Num = num; // Save Line 2 Number
        phone.startConsultation(num).then(() => {
            ui.consultControls.classList.remove('hidden');
            updateLineUI(2);
            isConsulting = false;
            resetCallButton();
            ui.dialString.value = ""; 
        }).catch(err => alert("Consult failed: " + err));
    } else {
        line1Num = num; // Save Line 1 Number
        phone.call(num).catch(e => {
            console.error("Call Failed:", e);
            alert("Call Error: " + e.message);
        });
    }
});

document.querySelectorAll('.digit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const digit = btn.getAttribute('data-digit');
        if (phone.isCallActive() && !isConsulting) {
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

document.getElementById('btnHold').addEventListener('click', async () => {
    if (isConsulting) {
        isConsulting = false;
        resetCallButton();
    }
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

// --- UPDATED: Warm Transfer / Consult Trigger ---
document.getElementById('btnConsult').addEventListener('click', async () => {
    isConsulting = true;
    setCallButtonToConsultMode();

    if (!ui.btnHold.classList.contains('active')) {
        const isHeld = await phone.toggleHold();
        ui.btnHold.classList.toggle('active', isHeld);
    }
    
    document.getElementById('btnTransfer').classList.add('hidden');
    document.getElementById('btnConsult').classList.add('hidden');
});

ui.btnLine1.addEventListener('click', () => {
    phone.swapToLine(1).then(() => updateLineUI(1));
});

ui.btnLine2.addEventListener('click', () => {
    phone.swapToLine(2).then(() => updateLineUI(2));
});

// --- 3-Way Conference Logic ---
document.getElementById('btnMerge').addEventListener('click', () => {
    phone.mergeCalls().then(success => {
        if (success) {
            ui.btnLine1.classList.add('active-line');
            ui.btnLine1.classList.remove('held-line');
            ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Conf)</span>`;
            
            ui.btnLine2.classList.add('active-line');
            ui.btnLine2.classList.remove('held-line');
            ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Conf)</span>`;
        }
    });
});

document.getElementById('btnCompleteTransfer').addEventListener('click', () => {
    phone.completeConsultation().then(success => {
        if (success) {
            ui.consultControls.classList.add('hidden');
        }
    });
});

document.getElementById('btnCancelConsult').addEventListener('click', () => {
    phone.cancelConsultation(); 
    phone.toggleHold(); 
    ui.btnHold.classList.remove('active'); 
    
    ui.consultControls.classList.add('hidden');
    // Restore buttons
    document.getElementById('btnTransfer').classList.remove('hidden');
    document.getElementById('btnConsult').classList.remove('hidden');
});

// --- Helpers ---

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