/**
 * js/phone.js
 * Simplified SIP/WebRTC Engine with RFC 5626 (Outbound) and ICE Fixes
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
    }

    async connect() {
        if (this.userAgent) await this.disconnect();

        const user = this.settings.get('username');
        const pass = this.settings.get('password');
        const domain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        
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

        const uri = SIP.UserAgent.makeURI(`sip:${user}@${domain}`);
        const uuid = getPersistentInstanceId();
        
        // [FIX]: Use the persistent anonymous string so the PBX knows you are the same device
        // across page reloads, stopping the ghost registrations and 401 split-brain errors.
        const anonymousContactName = getPersistentContactName();

        const options = {
            uri: uri,
            transportOptions: this.config.SIP_OPTIONS.transportOptions,
            authorizationUsername: user,
            authorizationPassword: pass,
            
            // Apply the stable anonymous string so Kamailio correctly routes the ACK
            contactName: anonymousContactName, 
            
            // Force inject the Outbound instance tags to ensure Kamailio overwrites
            // old connections instead of creating duplicate "ghost" connections.
            contactParams: { 
                transport: 'ws',
                '+sip.ice': undefined,
                'reg-id': 1,
                '+sip.instance': `"urn:uuid:${uuid}"`
            },
            hackIpInContact: false,
            
            // Explicitly tell Kamailio we support RFC 5626 Outbound routing
            sipExtensionExtraSupported: ['outbound'],

            sessionDescriptionHandlerFactoryOptions: {
                peerConnectionConfiguration: { iceServers: iceServers }
            },

            delegate: {
                onConnect: () => {
                    this.callbacks.onStatus('Connected');
                    this.register();
                },
                onInvite: (invitation) => this.handleIncomingCall(invitation),
                onDisconnect: () => {
                    this.callbacks.onStatus('Disconnected');
                    this.registerer = null;
                }
            },
            ...this.config.SIP_OPTIONS
        };

        this.userAgent = new SIP.UserAgent(options);
        await this.userAgent.start();
    }

    async disconnect() {
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
        
        const domain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        
        this.registerer = new SIP.Registerer(this.userAgent);
        
        this.registerer.stateChange.addListener((state) => {
            if (state === SIP.RegistererState.Registered) {
                this.callbacks.onStatus('Registered');
                console.log('Registration successful with domain:', domain);
            } else if (state === SIP.RegistererState.Unregistered) {
                this.callbacks.onStatus('Unregistered');
            }
        });
        
        await this.registerer.register();
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