/**
 * js/phone.js
 * Simplified SIP/WebRTC Engine with RFC 5626 (Outbound), ICE Fixes, and Heartbeat Watchdog
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

// Helper to maintain a consistent endpoint ID across page reloads
function getPersistentInstanceId() {
    let instanceId = localStorage.getItem('sip_instance_id');
    if (!instanceId) {
        instanceId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('sip_instance_id', instanceId);
    }
    return instanceId; 
}

// Helper to maintain a stable anonymous contact name across page reloads
function getPersistentContactName() {
    let contactName = localStorage.getItem('sip_contact_name');
    if (!contactName) {
        // Generate a random 8-character string once, then save it permanently
        contactName = Math.random().toString(36).substring(2, 10);
        localStorage.setItem('sip_contact_name', contactName);
    }
    return contactName;
}

// Helper to fetch dynamic TURN credentials from Hero's API
// (Keep this here for when you deploy to a production domain)
async function fetchTurnCredentials(username, domain) {
    try {
        console.log('Fetching TURN credentials...');
        const response = await fetch('https://portal.hero.co.nz/api/turn-cred.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ user: username, domain: domain })
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        console.log('TURN credentials received:', data);
        return data; 
    } catch (error) {
        console.error('Failed to fetch TURN credentials:', error);
        return null;
    }
}

export class PhoneEngine {
    constructor(config, settings, audioManager, callbacks) {
        this.config = config;
        this.settings = settings;
        this.audio = audioManager;
        this.callbacks = callbacks;
        this.userAgent = null;
        this.session = null;
        this.registerer = null;
        
        // --- Registration Tuning ---
        this.registererOptions = {
            expires: 120, // Lowered from 600 to 120 seconds (2 minutes)
            refreshFrequency: 90 // Refresh at 90% of expiry (every ~108 seconds)
        };
        
        // --- NEW: Watchdog Variables ---
        this.intentionalDisconnect = false;
        this.reconnectTimer = null;
        this.lastRegisterTime = Date.now();
        this.lastHeartbeat = Date.now();
        this.heartbeatInterval = null;
        this.maxHeartbeatDelay = 30000; // 30 seconds
        this.heartbeatThreshold = 10000; // 10 seconds
        this.lastKnownState = null;
        this.lastKnownDomain = null;
    }

    async connect() {
        this.intentionalDisconnect = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.stopHeartbeat(); // Clear any zombie intervals

        if (this.userAgent) await this.disconnect();

        const user = this.settings.get('username');
        const pass = this.settings.get('password');
        this.lastKnownDomain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        
        if (!user || !pass) return;

        // ======================================================================
        // ⚠️ TEMPORARY HARDCODE FOR LOCAL DEV (CORS BYPASS) ⚠️
        // KEEP THIS HERE WHILE TESTING ON LOCALHOST TO ENSURE AUDIO CONNECTS
        // ======================================================================
        const iceServers = [{
            urls: "turns:wss.hero.co.nz:5349",
            username: "801061400032",   // <--- PASTE YOUR FULL TURN USERNAME HERE
            credential: "X2dyA5H4" // <--- PASTE YOUR FULL TURN CREDENTIAL HERE
        }];
        // ======================================================================

        /* --- UNCOMMENT THIS BLOCK FOR PRODUCTION DEPLOYMENT ---
        const turnData = await fetchTurnCredentials(user, domain);
        const iceServers = [];
        if (turnData && turnData.urls) {
            iceServers.push({
                urls: turnData.urls,
                username: turnData.username,
                credential: turnData.credential
            });
        } else {
            console.warn("No TURN credentials loaded. Media may fail if behind strict NAT.");
        }
        ------------------------------------------------------ */

        const uri = SIP.UserAgent.makeURI(`sip:${user}@${this.lastKnownDomain}`);
        const uuid = getPersistentInstanceId();
        const anonymousContactName = getPersistentContactName();

        // Spread SIP defaults first, then override so saved wssUrl / TURN ICE are not clobbered by a trailing spread.
        const options = {
            ...this.config.SIP_OPTIONS,
            uri: uri,
            authorizationUsername: user,
            authorizationPassword: pass,
            contactName: anonymousContactName,
            contactParams: {
                transport: 'ws',
                '+sip.ice': undefined,
                'reg-id': 1,
                '+sip.instance': `"urn:uuid:${uuid}"`
            },
            hackAllowUnregisteredOptionTags: true,
            hackIpInContact: true,
            forceRport: true,
            sipExtensionExtraSupported: ['outbound'],
            transportOptions: {
                ...this.config.SIP_OPTIONS.transportOptions,
                server: this.settings.get('wssUrl') || this.config.SIP_OPTIONS.transportOptions.server
            },
            sessionDescriptionHandlerFactoryOptions: {
                peerConnectionConfiguration: { iceServers: iceServers }
            },
            delegate: {
                onConnect: () => {
                    console.log("🟢 WebSocket Connected");
                    this.callbacks.onStatus('Connected');
                    this.lastKnownState = 'Connected';
                    this.startHeartbeat();
                    this.register();
                },
                onInvite: (invitation) => this.handleIncomingCall(invitation),
                onDisconnect: (error) => {
                    console.warn("🔴 WebSocket Disconnected", error);
                    this.callbacks.onStatus('Disconnected');
                    this.lastKnownState = 'Disconnected';
                    this.registerer = null;
                    this.stopHeartbeat();

                    if (!this.intentionalDisconnect) {
                        console.log("⏱️ Attempting auto-reconnect in 5s...");
                        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
                    }
                }
            }
        };

        this.userAgent = new SIP.UserAgent(options);
        await this.userAgent.start();
    }

    // --- NEW: Custom Heartbeat Methods ---
    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.lastHeartbeat = Date.now();
        
        this.heartbeatInterval = setInterval(() => {
            if (this.intentionalDisconnect) return this.stopHeartbeat();

            const now = Date.now();
            // If the browser slept or the network froze, 'now' will jump far ahead
            if (now - this.lastHeartbeat > this.maxHeartbeatDelay) {
                console.error("💀 Heartbeat timeout! Network likely froze. Forcing reconnect...");
                this.connect(); 
            } else {
                this.lastHeartbeat = now; // All good, update the tick
            }
        }, this.heartbeatThreshold);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    async disconnect() {
        this.intentionalDisconnect = true;
        this.stopHeartbeat();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        if (this.registerer) {
            try { await this.registerer.unregister(); } catch (e) {}
            this.registerer = null;
        }
        if (this.userAgent) {
            await this.userAgent.stop();
            this.userAgent = null;
            this.session = null;
        }
    }

    async register() {
        if (!this.userAgent) return;
        
        if (this.registerer) {
            try { await this.registerer.unregister(); } catch (e) {}
            this.registerer = null;
        }
        
        this.registerer = new SIP.Registerer(this.userAgent, this.registererOptions);
        
        this.registerer.stateChange.addListener((state) => {
            if (state === SIP.RegistererState.Registered) {
                this.callbacks.onStatus('Registered');
                this.lastKnownState = 'Registered';
                this.lastRegisterTime = Date.now();
                console.log('✅ Registration successful!');
            } 
            else if (state === SIP.RegistererState.Unregistered || state === SIP.RegistererState.Terminated) {
                this.callbacks.onStatus('Unregistered');
                this.lastKnownState = 'Unregistered';
                
                // --- THE FIX: The Sledgehammer ---
                if (!this.intentionalDisconnect) {
                    console.warn("⚠️ Registration dropped (408 Timeout). Socket is likely poisoned. Forcing full TCP/WS teardown in 3s...");
                    
                    // Clear the old instance completely
                    if (this.userAgent) {
                        this.userAgent.stop().catch(()=>{});
                    }
                    
                    // Call connect() instead of register() to get a brand new WebSocket and Call-ID
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
                }
            }
        });
        
        try {
            await this.registerer.register();
        } catch (e) {
            console.error("Register attempt failed:", e);
        }
    }
    
    handleIncomingCall(invitation) {
        const remoteUser = invitation.remoteIdentity.uri.user;
        this.audio.startRinging();
        
        this.callbacks.onIncoming(remoteUser, 
            () => { // Answer
                this.audio.stopRinging();
                const options = {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false }
                    }
                };
                invitation.accept(options).then(() => {
                    this.setupSession(invitation);
                });
            },
            () => { // Reject
                this.audio.stopRinging();
                invitation.reject();
            }
        );
    }

    async call(destination) {
        if (!this.userAgent) throw new Error("Phone not connected");
        const target = SIP.UserAgent.makeURI(`sip:${destination}@${this.config.DEFAULT_DOMAIN}`);
        const session = new SIP.Inviter(this.userAgent, target);
        this.setupSession(session);
        return session.invite();
    }

    setupSession(session) {
        this.session = session;
        const remoteUser = session.remoteIdentity.uri.user;

        session.stateChange.addListener((state) => {
            console.log(`Session State: ${state}`);
            if (state === SIP.SessionState.Established) {
                this.callbacks.onCallStart(remoteUser);
                this.setupAudio(session);
            } else if (state === SIP.SessionState.Terminated) {
                this.cleanupCall();
            }
        });
    }

    setupAudio(session) {
        const remoteStream = new MediaStream();
        session.sessionDescriptionHandler.peerConnection.getReceivers().forEach((receiver) => {
            if (receiver.track) { remoteStream.addTrack(receiver.track); }
        });
        this.audio.setCallStream(remoteStream);
    }

    cleanupCall() {
        this.session = null;
        this.callbacks.onCallEnd();
    }

    hangup() {
        if (!this.session) return;
        if (this.session.state === SIP.SessionState.Established) {
            this.session.bye();
        } else if (this.session instanceof SIP.Inviter) {
            this.session.cancel();
        } else {
            this.session.reject();
        }
    }

    toggleMute() { return false; }
    async toggleHold() { return false; }
    isCallActive() { return this.session && this.session.state === SIP.SessionState.Established; }
    sendDTMF(tone) { if (this.session) this.session.dtmf(tone); }
}