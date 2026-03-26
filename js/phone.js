/**
 * js/phone.js
 * Simplified SIP/WebRTC Engine with ICE fixes and REGISTER 2xx Contact sanitization
 * Last modified: 2026-03-24 — connect(): keepAliveInterval/keepAliveDebounce on UA + transportOptions.
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

/**
 * Re-INVITE SDP tweak after hold (sendonly/inactive → sendrecv).
 * @param {{ sdp?: string, type: string }} description
 */
function unholdModifier(description) {
    if (!description.sdp || !description.type) {
        throw new Error('Invalid SDP');
    }
    let sdp = description.sdp;
    sdp = sdp.replace(/a=sendonly\r?\n/g, 'a=sendrecv\r\n');
    sdp = sdp.replace(/a=inactive\r?\n/g, 'a=sendrecv\r\n');
    return Promise.resolve({ sdp, type: description.type });
}

/**
 * Parse each <sip:…> binding in a Contact header value (comma-separated list).
 * @param {string} contactValue
 * @returns {{ userHost: string, expires: number, inner: string }[]}
 */
function parseSipContactBindings(contactValue) {
    const bindings = [];
    let i = 0;
    while (i < contactValue.length) {
        const lt = contactValue.indexOf('<sip:', i);
        if (lt === -1) break;
        const gt = contactValue.indexOf('>', lt);
        if (gt === -1) break;
        // Bytes after "<sip:" up to ">" are the URI (user@host;params) without the "sip:" prefix.
        const inner = contactValue.slice(lt + 5, gt);
        const userHost = inner.split(';')[0].trim();
        const afterGt = contactValue.slice(gt + 1);
        let expMatch = afterGt.match(/^\s*;\s*expires\s*=\s*(\d+)/i);
        let expires = expMatch ? parseInt(expMatch[1], 10) : 0;
        if (!expires) {
            const inUri = inner.match(/;expires=(\d+)/i);
            if (inUri) expires = parseInt(inUri[1], 10);
        }
        if (userHost.includes('@')) {
            bindings.push({ userHost, expires, inner });
        }
        i = gt + 1;
    }
    return bindings;
}

/**
 * Pick the binding for *this* UA. Kamailio lists old + new contacts; first URI is often stale (wrong host).
 * SIP.js Registerer rejects 200 if Contact does not "point to us" (onAccept → "No Contact header pointing to us").
 * @param {{ userHost: string, expires: number, inner: string }[]} bindings
 * @param {string} contactUserName - anonymous Contact user (e.g. rs2g5mcz)
 * @param {string} instanceUuid - persistent +sip.instance uuid without urn prefix
 */
function pickRegisterContactBinding(bindings, contactUserName, instanceUuid) {
    if (!bindings.length) return null;
    if (instanceUuid) {
        const needle = instanceUuid.toLowerCase().replace(/-/g, '');
        const withInst = bindings.filter((b) => {
            const compact = b.inner.toLowerCase().replace(/-/g, '');
            return compact.includes(needle) || b.inner.includes(instanceUuid);
        });
        if (withInst.length === 1) return withInst[0];
        if (withInst.length > 1) {
            return withInst.reduce((a, b) => (b.expires > a.expires ? b : a));
        }
    }
    if (contactUserName) {
        const prefix = `${contactUserName}@`;
        const same = bindings.filter((b) => b.userHost.startsWith(prefix));
        if (same.length) {
            return same.reduce((a, b) => (b.expires > a.expires ? b : a));
        }
    }
    return bindings.reduce((a, b) => (b.expires > a.expires ? b : a));
}

/**
 * Kamailio REGISTER 2xx may send multiple Contact headers (multi-device). SIP.js 0.21 can choke or
 * match the wrong row. Use case: replace *all* Contact lines with one sanitized binding (+ alias=).
 * @param {string} raw
 * @param {string} contactUserName
 * @param {string} instanceUuid
 * @returns {string}
 */
function sanitizeKamailioRegister2xxContact(raw, contactUserName, instanceUuid) {
    if (typeof raw !== 'string' || raw.length < 12) return raw;
    if (!raw.startsWith('SIP/2.0')) return raw;
    const statusLine = raw.split(/\r?\n/, 1)[0];
    if (!/^SIP\/2\.0\s+2\d\d/.test(statusLine)) return raw;
    const cseq = raw.match(/^CSeq:\s*\d+\s+(\S+)/im);
    if (!cseq || String(cseq[1]).toUpperCase() !== 'REGISTER') return raw;

    // Grab ALL contact headers (Kamailio often sends multiple if multiple devices are registered)
    const contactLines = raw.match(/^Contact:\s*([^\r\n]+)/igm);
    if (!contactLines) return raw;

    // Join them to parse bindings and find our specific device
    const allContacts = contactLines.map((line) => line.replace(/^Contact:\s*/i, '')).join(', ');
    const bindings = parseSipContactBindings(allContacts);
    if (!bindings.length) return raw;

    const chosen = pickRegisterContactBinding(bindings, contactUserName, instanceUuid);
    if (!chosen) return raw;

    const expHdr = raw.match(/^Expires:\s*(\d+)/im);
    const expires = chosen.expires > 0 ? String(chosen.expires) : expHdr ? expHdr[1] : '120';

    // Extract the alias parameter if Kamailio provided one
    const aliasMatch = chosen.inner.match(/;(alias=[^;>]+)/i);
    const aliasStr = aliasMatch ? `;${aliasMatch[1]}` : '';

    // THE FIX: Completely obliterate ALL existing Contact headers from the raw string
    let cleanRaw = raw.replace(/^Contact:[^\r\n]+\r?\n/igm, '');

    // Inject our single, perfectly formatted Contact header right after the CSeq line
    const replacement = `Contact: <sip:${chosen.userHost};transport=ws${aliasStr}>;expires=${expires}\r\n`;
    cleanRaw = cleanRaw.replace(/^(CSeq:[^\r\n]+\r?\n)/im, `$1${replacement}`);

    return cleanRaw;
}

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
        /** Local mic muted (outbound audio tracks disabled). */
        this.localMuted = false;
        /** SIP hold (re-INVITE sendonly) active. */
        this.onHold = false;

        // Page Visibility: embedded Chromium (Cursor Simple Browser) throttles setInterval while unfocused;
        // without this, lastHeartbeat stalls and we false-trigger reconnect → lost registration.
        this._onVisibilityForHeartbeat = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                this.lastHeartbeat = Date.now();
            }
        };
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
            // CONFIG may set register: true; we use an explicit Registerer below — avoid double REGISTER.
            register: false,
            uri: uri,
            authorizationUsername: user,
            authorizationPassword: pass,
            contactName: anonymousContactName,
            contactParams: {
                transport: 'ws',
                'reg-id': 1,
                '+sip.instance': `"urn:uuid:${uuid}"`
            },
            hackAllowUnregisteredOptionTags: true,
            hackIpInContact: false, // Standard Contact (.invalid), not local IP
            forceRport: true,
            sipExtensionExtraSupported: ['outbound'],

            // WebSocket keep-alives at UA root (seconds) — also set under transportOptions below
            keepAliveInterval: 15,
            keepAliveDebounce: 10,

            transportOptions: {
                ...this.config.SIP_OPTIONS.transportOptions,
                server: this.settings.get('wssUrl') || this.config.SIP_OPTIONS.transportOptions.server,
                keepAliveInterval: 15
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
        // Patch before start() so the first 401/200 REGISTER responses never hit an unpatched onMessage.
        this._patchTransportKamailioRegisterContact(this.userAgent, anonymousContactName, uuid);
        await this.userAgent.start();
    }

    /**
     * Wrap transport.onMessage: fix Kamailio REGISTER 2xx multi-Contact; strip ;+sip.instance="…" from
     * the Request-URI first line on all incoming requests (INVITE, ACK, BYE, CANCEL, …), not responses.
     * @param {*} ua - SIP.js UserAgent instance
     * @param {string} contactUserName
     * @param {string} instanceUuid
     */
    _patchTransportKamailioRegisterContact(ua, contactUserName, instanceUuid) {
        const transport = ua?.transport;
        if (!transport || transport._kamailioRegisterContactPatched) return;
        const inner = transport.onMessage;
        if (typeof inner !== 'function') return;
        transport._kamailioRegisterContactPatched = true;

        transport.onMessage = (msg) => {
            let cleanMsg = msg;

            // 1. REGISTER 2xx multi-Contact / Kamailio quirks
            cleanMsg = sanitizeKamailioRegister2xxContact(cleanMsg, contactUserName, instanceUuid);

            // 2. Incoming requests only: Request-URI may carry ;+sip.instance="…" (strict parsers choke)
            if (typeof cleanMsg === 'string') {
                const firstNewline = cleanMsg.indexOf('\n');
                if (firstNewline > -1) {
                    let firstLine = cleanMsg.substring(0, firstNewline);
                    if (!firstLine.startsWith('SIP/2.0')) {
                        const rest = cleanMsg.substring(firstNewline);
                        firstLine = firstLine.replace(/;\+sip\.instance="[^"]+"/gi, '');
                        cleanMsg = firstLine + rest;
                    }
                }
            }

            inner(cleanMsg);
        };
    }

    // --- NEW: Custom Heartbeat Methods ---
    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.lastHeartbeat = Date.now();

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibilityForHeartbeat);
            document.addEventListener('visibilitychange', this._onVisibilityForHeartbeat);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.intentionalDisconnect) return this.stopHeartbeat();

            const now = Date.now();
            // While hidden, timers are unreliable; do not treat a gap as network death.
            if (typeof document !== 'undefined' && document.hidden) {
                this.lastHeartbeat = now;
                return;
            }

            // If the browser slept or the network froze, 'now' will jump far ahead
            if (now - this.lastHeartbeat > this.maxHeartbeatDelay) {
                console.error("💀 Heartbeat timeout! Network likely froze. Forcing reconnect...");
                this.connect();
            } else {
                this.lastHeartbeat = now;
            }
        }, this.heartbeatThreshold);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._onVisibilityForHeartbeat);
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

        // Provisional 180 Ringing — keeps upstream (e.g. Kamailio/Hero) from timing out before the user answers
        try {
            invitation.progress(); // SIP 180 Ringing
            console.log('📨 Sent 180 Ringing to Kamailio');
        } catch (e) {
            console.warn('Could not send early progress:', e);
        }

        this.audio.startRinging();

        // Register state listener immediately so transitions are not missed before answer
        this.setupSession(invitation);

        this.callbacks.onIncoming(
            remoteUser,
            async () => {
                // Answer
                this.audio.stopRinging();

                const options = {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                        // Early-offer: do not block 200 OK on full ICE gathering
                        iceGatheringTimeout: 100
                    }
                };

                try {
                    await invitation.accept(options);
                    console.log('✅ Call accepted successfully.');
                } catch (e) {
                    console.error('❌ Failed to accept call:', e);
                }
            },
            () => {
                // Reject
                this.audio.stopRinging();
                invitation.reject();
            }
        );
    }

    async call(destination) {
        if (!this.userAgent) throw new Error("Phone not connected");
        const domain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        const target = SIP.UserAgent.makeURI(`sip:${destination}@${domain}`);
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
        this.localMuted = false;
        this.onHold = false;
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

    /**
     * Blind transfer (SIP REFER) — use case: send the connected party to another extension.
     * @param {string} destination - extension or user part (domain from settings)
     * @returns {boolean}
     */
    blindTransfer(destination) {
        if (!this.session || this.session.state !== SIP.SessionState.Established) {
            console.warn('blindTransfer: no established session');
            return false;
        }
        const dest = String(destination ?? '').trim();
        if (!dest) return false;
        const domain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        const target = SIP.UserAgent.makeURI(`sip:${dest}@${domain}`);
        if (!target) {
            console.warn('blindTransfer: invalid destination', destination);
            return false;
        }
        try {
            if (typeof this.session.refer !== 'function') {
                console.warn('blindTransfer: session.refer not available in this SIP.js build');
                return false;
            }
            this.session.refer(target);
            return true;
        } catch (e) {
            console.error('blindTransfer failed', e);
            return false;
        }
    }

    /**
     * Mute / unmute local microphone (WebRTC senders). Does not change SIP signaling.
     * @returns {boolean} true if mic is muted after toggle
     */
    toggleMute() {
        if (!this.session || this.session.state !== SIP.SessionState.Established) {
            return this.localMuted;
        }
        const pc = this.session.sessionDescriptionHandler?.peerConnection;
        if (!pc) return this.localMuted;

        this.localMuted = !this.localMuted;
        const enable = !this.localMuted;
        pc.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = enable;
            }
        });
        return this.localMuted;
    }

    /**
     * Hold / resume via re-INVITE (RFC 3264 sendonly vs negotiated sendrecv).
     * @returns {Promise<boolean>} true if call is on hold after toggle
     */
    async toggleHold() {
        if (!this.session || this.session.state !== SIP.SessionState.Established) {
            return this.onHold;
        }
        const WebApi = SIP.Web;
        if (!WebApi || typeof WebApi.holdModifier !== 'function') {
            console.warn('toggleHold: SIP.Web.holdModifier missing');
            return this.onHold;
        }

        const nextHold = !this.onHold;
        try {
            await this.session.invite({
                sessionDescriptionHandlerModifiers: nextHold ? [WebApi.holdModifier] : [unholdModifier]
            });
            this.onHold = nextHold;
            return this.onHold;
        } catch (e) {
            console.error('toggleHold re-INVITE failed', e);
            return this.onHold;
        }
    }
    isCallActive() { return this.session && this.session.state === SIP.SessionState.Established; }
    sendDTMF(tone) { if (this.session) this.session.dtmf(tone); }
}