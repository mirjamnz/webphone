import { HistoryManager } from './history.js';
import { CONFIG } from './config.js';
import { SettingsManager } from './settings.js';
import { AudioManager } from './audio.js';
import { PhoneEngine } from './phone.js';
import { BlfManager } from './blf.js';
import { UserManager } from './user.js';
import { QueueManager } from './queue.js';
import { RecordingsManager } from './recordings.js';
import { SupervisorManager } from './supervisor.js'; 
import { DashboardManager } from './dashboard.js'; // [NEW] Import the Hero Dashboard Manager

/**
 * Main Application Logic
 * Integrates all modules (Phone, Audio, UI, Dashboard)
 */

// 1. Initialize Settings
const settings = new SettingsManager();

// 2. Initialize User Manager (Handles roles and permissions)
const userManager = new UserManager(settings);

// 3. Initialize Hero Dashboard Manager (Handles API polling for the right-hand panel)
const dashboardManager = new DashboardManager(settings);

// 4. Initialize History Manager
const historyManager = new HistoryManager(settings, {
    onRedial: (number) => {
        ui.panels.history.classList.add('hidden'); // Close modal
        ui.dialString.value = number;              // Fill dialer
        // Optional: Call immediately
        // phone.call(number).catch(e => alert(e.message)); 
    }
});

// 5. Initialize Audio Manager
const audio = new AudioManager(settings);

// 6. UI References (DOM Elements)
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
        ringtone: document.getElementById('cfgRingtone'),
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
    dndToggle: document.getElementById('dndToggle'),
    // Dashboard Stats elements
    statActiveCalls: document.getElementById('statActiveCalls'),
    statAgents: document.getElementById('statAgents'),
    statQueues: document.getElementById('statQueues')
};

// Application State
let isConsulting = false; 
let line1Num = "Line 1"; 
let line2Num = "Line 2"; 
let blfManager = null; 

// 7. Define Phone Event Callbacks
const phoneCallbacks = {
    onStatus: (state) => {
        ui.statusText.innerText = state;
        if (state === 'Registered') {
            ui.statusDot.className = 'status-indicator connected';
            ui.btnLogin.innerHTML = '<i class="fa-solid fa-rotate"></i> Reconnect';
            
            // Initialize BLF Manager if not already initialized
            if (!blfManager && phone.userAgent) {
                try {
                    blfManager = new BlfManager(phone, settings);
                    blfManager.init();
                    console.log("BLF Manager initialized");
                } catch (e) {
                    console.error("Error initializing BLF Manager:", e);
                }
            } else if (blfManager && !phone.userAgent) {
                // Phone disconnected, reset BLF manager
                blfManager = null;
            }
        } else {
            ui.statusDot.className = 'status-indicator';
            // Reset BLF manager on disconnect
            if (blfManager && state === 'Unregistered' || state === 'Disconnected') {
                blfManager = null;
            }
        }
    },
    onIncoming: (caller, acceptCb, rejectCb) => {
        document.getElementById('incomingIdentity').innerText = caller;
        ui.panels.incoming.classList.remove('hidden');
        
        const btnAnswer = document.getElementById('btnAnswer');
        const btnReject = document.getElementById('btnReject');

        btnAnswer.onclick = () => {
            ui.panels.incoming.classList.add('hidden');
            audio.stopRinging(); // Ensure ringing stops when answered
            if (!ui.panels.active.classList.contains('hidden')) {
                line2Num = caller; 
            } else {
                line1Num = caller;
            }
            acceptCb();
        };
        btnReject.onclick = () => {
            ui.panels.incoming.classList.add('hidden');
            audio.stopRinging(); // Ensure ringing stops when rejected
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

// 8. Initialize Core Engines
const phone = new PhoneEngine(CONFIG, settings, audio, phoneCallbacks);
const queueManager = new QueueManager(phone, userManager, settings);
const recordingsManager = new RecordingsManager(userManager);

// Initialize Old Supervisor Manager (Optional: Keep if you use it for barge/whisper commands via Asterisk directly)
const supervisorManager = new SupervisorManager(phone, userManager);

// 9. Expose global app object for debugging/buttons
window.app = {
    callSpecial: (num) => {
        phone.call(num).catch(e => alert(e.message));
    },
    user: userManager,
    queue: queueManager,
    recordings: recordingsManager,
    supervisor: supervisorManager, // Old supervisor logic
    dashboard: dashboardManager    // [NEW] Hero Dashboard logic
};

// --- Helper Functions ---

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

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    
    // 1. Attach call control listeners first
    attachCallControlListeners();
    
    // 2. Setup Audio & Defaults
    const devices = await audio.init();
    populateDeviceSelect(ui.inputs.mic, devices.inputs, settings.get('micId'));
    populateDeviceSelect(ui.inputs.speaker, devices.outputs, settings.get('speakerId'));
    populateDeviceSelect(ui.inputs.ringer, devices.outputs, settings.get('ringerId'));
    
    // 3. Pre-fill Advanced Settings in Login
    ui.loginInputs.domain.value = settings.get('domain') || CONFIG.DEFAULT_DOMAIN;
    ui.loginInputs.wss.value = settings.get('wssUrl') || CONFIG.DEFAULT_WSS;

    // 4. CHECK LOGIN STATUS
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
            
            // [NEW] Start the Real-time Hero Dashboard Polling
            dashboardManager.start();

            // [OLD] Disable old socket-based dashboard updates
            // supervisorManager.initialize(); 
            
            // Setup tab listeners only (UI switching)
            setupSupervisorTabs();
        }
        
        phone.connect();
    } else {
        // Not Logged In -> Show Splash
        ui.loginPage.classList.remove('hidden');
        ui.mainApp.classList.add('hidden');
    }
});

// --- LOGIN PAGE EVENTS ---
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
        
        // [NEW] Start the Real-time Hero Dashboard Polling
        dashboardManager.start();
        
        // Setup tab listeners only
        setupSupervisorTabs();
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
    ui.inputs.ringtone.value = settings.get('ringtoneFile') || 'ringing.mp3';
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
        ringerId: ui.inputs.ringer.value,
        ringtoneFile: ui.inputs.ringtone.value
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

// --- STANDARD CALL CONTROL EVENTS ---
// Attach event listeners after DOM is ready
function attachCallControlListeners() {
    console.log("Attaching call control event listeners...");
    
    // Verify buttons exist
    const btnHangup = document.getElementById('btnHangup');
    const btnMute = document.getElementById('btnMute');
    const btnConsult = document.getElementById('btnConsult');
    const btnHold = document.getElementById('btnHold');
    const btnTransfer = document.getElementById('btnTransfer');
    
    if (!btnHangup || !btnMute || !btnConsult || !btnHold || !btnTransfer) {
        console.error("Call control buttons not found in DOM!");
        return;
    }
    
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

    // Replace and re-attach listeners to ensure clean state
    btnHangup.replaceWith(btnHangup.cloneNode(true));
    document.getElementById('btnHangup').addEventListener('click', (e) => {
        e.preventDefault();
        try { phone.hangup(); } catch (error) { console.error("Hangup error:", error); }
    });

    btnMute.replaceWith(btnMute.cloneNode(true));
    const newBtnMute = document.getElementById('btnMute');
    newBtnMute.addEventListener('click', (e) => {
        e.preventDefault();
        try {
            const isMuted = phone.toggleMute();
            newBtnMute.classList.toggle('active', isMuted);
            ui.btnMute = newBtnMute;
        } catch (error) { console.error("Mute error:", error); }
    });

    btnHold.replaceWith(btnHold.cloneNode(true));
    const newBtnHold = document.getElementById('btnHold');
    newBtnHold.addEventListener('click', async () => {
        if (isConsulting) {
            isConsulting = false;
            resetCallButton();
        }
        const isHeld = await phone.toggleHold();
        newBtnHold.classList.toggle('active', isHeld);
        ui.btnHold = newBtnHold;
    });

    btnTransfer.replaceWith(btnTransfer.cloneNode(true));
    document.getElementById('btnTransfer').addEventListener('click', () => {
        const num = prompt("Enter extension to transfer to:");
        if (num) {
            phone.blindTransfer(num).then(success => {
                if(success) console.log("Transfer initiated...");
            });
        }
    });

    btnConsult.replaceWith(btnConsult.cloneNode(true));
    document.getElementById('btnConsult').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!phone.isCallActive()) {
            alert("No active call to consult");
            return;
        }
        try {
            const num = prompt("Enter extension to consult with:");
            if (!num || num.trim() === '') return;
            
            line2Num = num.trim();
            
            // Hold the current call if not already held
            const currentBtnHold = document.getElementById('btnHold');
            if (!currentBtnHold.classList.contains('active')) {
                const isHeld = await phone.toggleHold();
                currentBtnHold.classList.toggle('active', isHeld);
            }
            
            await phone.startConsultation(num.trim());
            
            // Show consult controls
            ui.consultControls.classList.remove('hidden');
            updateLineUI(2);
            isConsulting = false;
            resetCallButton();
            
            // Hide transfer and consult buttons
            document.getElementById('btnTransfer').classList.add('hidden');
            document.getElementById('btnConsult').classList.add('hidden');
        } catch (error) {
            console.error("Consult error:", error);
            alert("Consult failed: " + error.message);
        }
    });

    ui.btnLine1.addEventListener('click', () => {
        phone.swapToLine(1).then(() => updateLineUI(1));
    });

    ui.btnLine2.addEventListener('click', () => {
        phone.swapToLine(2).then(() => updateLineUI(2));
    });

    const btnMerge = document.getElementById('btnMerge');
    if (btnMerge) {
        btnMerge.addEventListener('click', () => {
            phone.mergeCalls().then(success => {
                if (success) {
                    ui.btnLine1.classList.add('active-line');
                    ui.btnLine1.innerHTML = `<i class="fa-solid fa-user"></i> <span>${line1Num} (Conf)</span>`;
                    ui.btnLine2.classList.add('active-line');
                    ui.btnLine2.innerHTML = `<i class="fa-solid fa-user-doctor"></i> <span>${line2Num} (Conf)</span>`;
                }
            });
        });
    }

    const btnCompleteTransfer = document.getElementById('btnCompleteTransfer');
    if (btnCompleteTransfer) {
        btnCompleteTransfer.addEventListener('click', () => {
            phone.completeConsultation().then(success => {
                if (success) {
                    ui.consultControls.classList.add('hidden');
                }
            });
        });
    }

    const btnCancelConsult = document.getElementById('btnCancelConsult');
    if (btnCancelConsult) {
        btnCancelConsult.addEventListener('click', () => {
            phone.cancelConsultation(); 
            phone.toggleHold(); 
            const currentBtnHold = document.getElementById('btnHold');
            if (currentBtnHold) currentBtnHold.classList.remove('active'); 
            ui.consultControls.classList.add('hidden');
            document.getElementById('btnTransfer').classList.remove('hidden');
            document.getElementById('btnConsult').classList.remove('hidden');
        });
    }
    
    console.log("Call control event listeners attached successfully");
}

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
    
    // Show supervisor dashboard instead of idle state
    const supervisorDashboard = document.getElementById('supervisorDashboard');
    const idleState = document.getElementById('idleState');
    if (isSupervisor && supervisorDashboard) {
        supervisorDashboard.classList.remove('hidden');
        if (idleState) idleState.classList.add('hidden');
    } else {
        if (supervisorDashboard) supervisorDashboard.classList.add('hidden');
        if (idleState) idleState.classList.remove('hidden');
    }
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

/**
 * Setup supervisor tabs (UI switching only)
 * The data rendering is now handled by dashboard.js
 */
function setupSupervisorTabs() {
    // We do NOT use supervisorManager.setOnActiveCallsUpdate() here anymore
    // because dashboard.js is now responsible for updating the UI.

    // Setup tab switching logic
    document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.dashboard-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    });
}

// [NOTE] The old render functions (renderActiveCalls, renderAgents, etc.) 
// have been removed/commented out because dashboard.js now handles the rendering.