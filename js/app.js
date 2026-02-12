import { HistoryManager } from './history.js';
import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';
import { BlfManager } from './blf.js';
import { UserManager } from './user.js';
import { QueueManager } from './queue.js';
import { RecordingsManager } from './recordings.js'; 

const settings = new SettingsManager();

// Initialize User Manager
const userManager = new UserManager(settings);

// Initialize History
const historyManager = new HistoryManager(settings, {
    onRedial: (number) => {
        ui.panels.history.classList.add('hidden'); // Close modal
        ui.dialString.value = number;              // Fill dialer
        // Optional: Call immediately
        // phone.call(number).catch(e => alert(e.message)); 
    }
});

const audio = new AudioManager(settings);

const ui = {
    dialString: document.getElementById('dialString'),
    loginPage: document.getElementById('loginPage'),
    mainApp: document.getElementById('mainApp'),
    loginInputs: {
        user: document.getElementById('loginUser'),
        pass: document.getElementById('loginPass'),
        domain: document.getElementById('loginDomain'),
        wss: document.getElementById('loginWss')
    },
    inputs: {
        user: document.getElementById('cfgUser'),
        pass: document.getElementById('cfgPass'),
        domain: document.getElementById('cfgDomain'),
        wss: document.getElementById('cfgWss'),
        mic: document.getElementById('cfgMic'),
        speaker: document.getElementById('cfgSpeaker'),
        ringer: document.getElementById('cfgRinging'),
        blfList: document.getElementById('cfgBlfList')
    },
    panels: {
        config: document.getElementById('configModal'),
        blfConfig: document.getElementById('blfModal'),
        incoming: document.getElementById('incomingModal'),
        idle: document.getElementById('idleState'),
        active: document.getElementById('activeState'),
        controls: document.getElementById('controlsBar'),
        history: document.getElementById('historyModal')
    },
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    btnLogin: document.getElementById('btnLogin'),
    remoteIdentity: document.getElementById('remoteIdentity'),
    timer: document.getElementById('callTimer'),
    btnMute: document.getElementById('btnMute'),
    btnHold: document.getElementById('btnHold'),
    consultControls: document.getElementById('consultControls'),
    btnLine1: document.getElementById('btnLine1'),
    btnLine2: document.getElementById('btnLine2'),
    btnCall: document.getElementById('btnCall'),
    dndToggle: document.getElementById('dndToggle')
};

let isConsulting = false; 
let line1Num = "Line 1"; 
let line2Num = "Line 2"; 
let blfManager = null; 

const phoneCallbacks = {
    onStatus: (state) => {
        ui.statusText.innerText = state;
        if (state === 'Registered') {
            ui.statusDot.className = 'status-indicator connected';
            ui.btnLogin.innerHTML = '<i class="fa-solid fa-rotate"></i> Reconnect';
            
            if (!blfManager) {
                blfManager = new BlfManager(phone, settings);
                blfManager.init();
            }
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
            if (!ui.panels.active.classList.contains('hidden')) {
                line2Num = caller; 
            } else {
                line1Num = caller;
            }
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
        setTimeout(() => { ui.panels.controls.classList.add('active'); }, 50);
        ui.remoteIdentity.innerText = remoteUser || "Unknown";
        startTimer();
    },
    onCallWaitingAccept: () => {
        ui.consultControls.classList.remove('hidden');
        updateLineUI(2);
        isConsulting = true;
        ui.btnHold.classList.add('active');
        document.getElementById('btnTransfer').classList.add('hidden');
        document.getElementById('btnConsult').classList.add('hidden');
    },
    onCallEnd: () => {
        ui.panels.idle.classList.remove('hidden');
        ui.panels.active.classList.add('hidden');
        ui.panels.controls.classList.remove('active');
        ui.panels.incoming.classList.add('hidden'); 
        ui.consultControls.classList.add('hidden');
        document.getElementById('btnTransfer').classList.remove('hidden');
        document.getElementById('btnConsult').classList.remove('hidden');
        isConsulting = false;
        line1Num = "Line 1"; 
        line2Num = "Line 2"; 
        resetCallButton();
        stopTimer();
    }
};

const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);

// Initialize Queue Manager
const queueManager = new QueueManager(phone, userManager, settings);

// Initialize Recordings Manager
const recordingsManager = new RecordingsManager(userManager);

window.app = {
    callSpecial: (num) => {
        phone.call(num).catch(e => alert(e.message));
    },
    user: userManager,
    queue: queueManager,
    recordings: recordingsManager
};

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

function updateLineUI(activeLine) {
    ui.btnLine1.className = "tab-btn";
    ui.btnLine2.className = "tab-btn";
    if (activeLine === 1) {
        ui.btnLine1.classList.add('active-line');
        ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Active)</span>`;
        ui.btnLine2.classList.add('held-line');
        ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Held)</span>`;
    } else {
        ui.btnLine1.classList.add('held-line');
        ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Held)</span>`;
        ui.btnLine2.classList.add('active-line');
        ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Active)</span>`;
    }
}

// --- INIT ---
window.addEventListener('DOMContentLoaded', async () => {
    
    // 1. Setup Audio & Defaults
    const devices = await audio.init();
    populateDeviceSelect(ui.inputs.mic, devices.inputs, settings.get('micId'));
    populateDeviceSelect(ui.inputs.speaker, devices.outputs, settings.get('speakerId'));
    populateDeviceSelect(ui.inputs.ringer, devices.outputs, settings.get('ringerId'));
    
    // 2. Pre-fill Advanced Settings in Login
    ui.loginInputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.loginInputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;

    // 3. CHECK LOGIN STATUS
    const savedUser = settings.get('username');
    const savedPass = settings.get('password');

    if (savedUser && savedPass) {
        // Logged In -> Go straight to app
        ui.loginPage.classList.add('hidden');
        ui.mainApp.classList.remove('hidden');
        
    // Initialize user profile from extension
    await userManager.initializeFromExtension(savedUser);
    
    // Update UI based on role
    updateUIForRole(userManager.role);
    
    // Initialize supervisor features if applicable
    if (userManager.hasRole('supervisor')) {
        renderQueueList();
    }
    
    phone.connect();
    } else {
        // Not Logged In -> Show Splash
        ui.loginPage.classList.remove('hidden');
        ui.mainApp.classList.add('hidden');
    }
});

// --- LOGIN PAGE LOGIC ---
document.getElementById('btnToggleAdvanced').addEventListener('click', () => {
    document.getElementById('loginAdvanced').classList.toggle('hidden');
});

document.getElementById('btnDoLogin').addEventListener('click', async () => {
    const user = ui.loginInputs.user.value;
    const pass = ui.loginInputs.pass.value;
    const domain = ui.loginInputs.domain.value || CONFIG.DEFAULT_DOMAIN;
    const wss = ui.loginInputs.wss.value || CONFIG.DEFAULT_WSS;

    if (!user || !pass) {
        alert("Please enter extension and password");
        return;
    }

    // Save credentials
    settings.save({
        username: user,
        password: pass,
        domain: domain,
        wssUrl: wss
    });

    // Switch UI
    ui.loginPage.classList.add('hidden');
    ui.mainApp.classList.remove('hidden');
    
    // Initialize user profile from extension
    await userManager.initializeFromExtension(user);
    
    // Update UI based on role
    updateUIForRole(userManager.role);
    
    // Initialize supervisor features if applicable
    if (userManager.hasRole('supervisor')) {
        renderQueueList();
    }
    
    // Connect
    phone.connect();
});

ui.dndToggle.addEventListener('change', (e) => {
    phone.setDND(e.target.checked);
});

// --- CONFIG MODALS ---
document.getElementById('btnShowConfig').addEventListener('click', () => {
    ui.inputs.user.value = settings.get('username') || '';
    ui.inputs.pass.value = settings.get('password') || '';
    ui.inputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.inputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;
    ui.panels.config.classList.remove('hidden');
});

document.getElementById('btnCloseConfig').addEventListener('click', () => {
    ui.panels.config.classList.add('hidden');
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
    ui.panels.config.classList.add('hidden');
    phone.connect();
});

document.getElementById('btnBlfConfig').addEventListener('click', () => {
    ui.inputs.blfList.value = settings.get('blfList') || "3001, 3002, 3003, 3004";
    ui.panels.blfConfig.classList.remove('hidden');
});

document.getElementById('btnCloseBlf').addEventListener('click', () => {
    ui.panels.blfConfig.classList.add('hidden');
});

document.getElementById('btnSaveBlf').addEventListener('click', () => {
    settings.save({ blfList: ui.inputs.blfList.value });
    ui.panels.blfConfig.classList.add('hidden');
    window.location.reload();
});

// --- QUEUE MANAGEMENT EVENTS ---
document.getElementById('btnQueueConfig')?.addEventListener('click', async () => {
    const container = document.getElementById('queueConfigList');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading queues...</div>';
    
    const queues = await queueManager.getAvailableQueues();
    container.innerHTML = '';
    
    queues.forEach(queueName => {
        const isLoggedIn = queueManager.isLoggedIn(queueName);
        const item = document.createElement('div');
        item.className = 'config-group';
        item.innerHTML = `
            <label style="display: flex; justify-content: space-between; align-items: center;">
                <span>${queueName}</span>
                <label class="toggle-switch">
                    <input type="checkbox" data-queue="${queueName}" ${isLoggedIn ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </label>
        `;
        
        item.querySelector('input').addEventListener('change', async (e) => {
            const success = await queueManager.toggleQueue(queueName);
            if (!success) {
                e.target.checked = !e.target.checked; // Revert on failure
                alert(`Failed to ${e.target.checked ? 'login' : 'logout'} from queue ${queueName}`);
            } else {
                renderQueueList(); // Refresh queue list
            }
        });
        
        container.appendChild(item);
    });
    
    document.getElementById('queueModal').classList.remove('hidden');
});

document.getElementById('btnCloseQueue')?.addEventListener('click', () => {
    document.getElementById('queueModal').classList.add('hidden');
});

/**
 * Render the queue list in the sidebar
 */
async function renderQueueList() {
    const container = document.getElementById('queueList');
    if (!container) return;
    
    const queues = await queueManager.getAvailableQueues();
    container.innerHTML = '';
    
    queues.forEach(queueName => {
        const isLoggedIn = queueManager.isLoggedIn(queueName);
        const item = document.createElement('div');
        item.className = `queue-item ${isLoggedIn ? 'logged-in' : ''}`;
        item.innerHTML = `
            <div class="queue-info">
                <div class="queue-name">${queueName}</div>
                <div class="queue-status">${isLoggedIn ? 'Logged In' : 'Available'}</div>
            </div>
            <button class="queue-toggle ${isLoggedIn ? 'active' : ''}" data-queue="${queueName}">
                ${isLoggedIn ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-plus"></i>'}
            </button>
        `;
        
        item.querySelector('.queue-toggle').addEventListener('click', async () => {
            const success = await queueManager.toggleQueue(queueName);
            if (success) {
                renderQueueList(); // Refresh
            } else {
                alert(`Failed to toggle queue ${queueName}`);
            }
        });
        
        container.appendChild(item);
    });
}

// Initialize supervisor features when role is detected
// Note: This runs after DOMContentLoaded, so we check after user initialization

// --- STANDARD EVENTS ---
ui.btnCall.addEventListener('click', () => {
    const num = ui.dialString.value;
    if (!num) return;
    
    // Save to history
    historyManager.saveLastDialed(num);

    if (isConsulting) {
        line2Num = num; 
        phone.startConsultation(num).then(() => {
            ui.consultControls.classList.remove('hidden');
            updateLineUI(2);
            isConsulting = false;
            resetCallButton();
            ui.dialString.value = ""; 
        }).catch(err => alert("Consult failed: " + err));
    } else {
        line1Num = num; 
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

document.getElementById('btnTransfer').addEventListener('click', () => {
    const num = prompt("Enter extension to transfer to:");
    if (num) {
        phone.blindTransfer(num).then(success => {
            if(success) console.log("Transfer initiated...");
        });
    }
});

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
    document.getElementById('btnTransfer').classList.remove('hidden');
    document.getElementById('btnConsult').classList.remove('hidden');
});

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

/**
 * Update UI elements based on user role
 * Shows/hides features based on permissions
 * @param {string} role - User role ('agent' | 'supervisor' | 'admin')
 */
function updateUIForRole(role) {
    const isSupervisor = role === 'supervisor' || role === 'admin';
    
    // Show/hide supervisor features
    const supervisorElements = document.querySelectorAll('[data-role="supervisor"]');
    supervisorElements.forEach(el => {
        el.style.display = isSupervisor ? '' : 'none';
    });
    
    // Show/hide agent-only features
    const agentElements = document.querySelectorAll('[data-role="agent"]');
    agentElements.forEach(el => {
        el.style.display = isSupervisor ? 'none' : '';
    });
    
    // Update sidebar header with role badge
    const sidebarHeader = document.querySelector('.sidebar-header h3');
    if (sidebarHeader && role !== 'agent') {
        const badge = document.createElement('span');
        badge.className = 'role-badge';
        badge.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        badge.style.cssText = 'font-size: 0.7rem; padding: 2px 8px; background: var(--primary); border-radius: 12px; margin-left: 8px;';
        sidebarHeader.appendChild(badge);
    }
    
    console.log(`UI updated for role: ${role}`);
}

// --- HISTORY EVENTS ---
document.getElementById('btnShowHistory').addEventListener('click', () => {
    ui.panels.history.classList.remove('hidden');
    historyManager.render('historyList');
});

document.getElementById('btnCloseHistory').addEventListener('click', () => {
    ui.panels.history.classList.add('hidden');
});

document.getElementById('btnRedialLast').addEventListener('click', () => {
    const lastNum = historyManager.getLastDialed();
    if (lastNum) {
        ui.panels.history.classList.add('hidden');
        ui.dialString.value = lastNum;
        phone.call(lastNum).catch(e => alert(e.message));
    } else {
        alert("No last number found.");
    }
});