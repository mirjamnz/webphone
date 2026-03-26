/**
 * js/phone.js
 * Fortified SIP/WebRTC Engine for strict Kamailio PBX environments.
 * Last modified: 2026-03-26 — Two-way transport patch: inbound sanitize + outbound Contact alias inject.
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

/**
 * Re-INVITE SDP tweak after hold (sendonly/inactive → sendrecv).
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

function parseSipContactBindings(contactValue) {
    const bindings = [];
    let i = 0;
    while (i < contactValue.length) {
        const lt = contactValue.indexOf('<sip:', i);
        if (lt === -1) break;
        const gt = contactValue.indexOf('>', lt);
        if (gt === -1) break;
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

function sanitizeKamailioRegister2xxContact(raw, contactUserName, instanceUuid) {
    if (typeof raw !== 'string' || raw.length < 12) return raw;
    if (!raw.startsWith('SIP/2.0')) return raw;
    const statusLine = raw.split(/\r?\n/, 1)[0];
    if (!/^SIP\/2\.0\s+2\d\d/.test(statusLine)) return raw;
    const cseq = raw.match(/^CSeq:\s*\d+\s+(\S+)/im);
    if (!cseq || String(cseq[1]).toUpperCase() !== 'REGISTER') return raw;

    const contactLines = raw.match(/^Contact:\s*([^\r\n]+)/igm);
    if (!contactLines) return raw;

    const allContacts = contactLines.map((line) => line.replace(/^Contact:\s*/i, '')).join(', ');
    const bindings = parseSipContactBindings(allContacts);
    if (!bindings.length) return raw;

    const chosen = pickRegisterContactBinding(bindings, contactUserName, instanceUuid);
    if (!chosen) return raw;

    const expHdr = raw.match(/^Expires:\s*(\d+)/im);
    const expires = chosen.expires > 0 ? String(chosen.expires) : expHdr ? expHdr[1] : '120';

    const aliasMatch = chosen.inner.match(/;(alias=[^;>]+)/i);
    const aliasStr = aliasMatch ? `;${aliasMatch[1]}` : '';

    let cleanRaw = raw.replace(/^Contact:[^\r\n]+\r?\n/igm, '');
    const replacement = `Contact: <sip:${chosen.userHost};transport=ws${aliasStr}>;expires=${expires}\r\n`;
    cleanRaw = cleanRaw.replace(/^(CSeq:[^\r\n]+\r?\n)/im, `$1${replacement}`);

    return cleanRaw;
}

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

function getPersistentContactName() {
    let contactName = localStorage.getItem('sip_contact_name');
    if (!contactName) {
        contactName = Math.random().toString(36).substring(2, 10);
        localStorage.setItem('sip_contact_name', contactName);
    }
    return contactName;
}

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
        
        this.registererOptions = {
            expires: 120,
            refreshFrequency: 90
        };
        
        this.intentionalDisconnect = false;
        this.reconnectTimer = null;
        this.lastRegisterTime = Date.now();
        this.lastHeartbeat = Date.now();
        this.heartbeatInterval = null;
        this.maxHeartbeatDelay = 30000;
        this.heartbeatThreshold = 10000;
        this.lastKnownState = null;
        this.lastKnownDomain = null;
        this.localMuted = false;
        this.onHold = false;

        this._onVisibilityForHeartbeat = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                this.lastHeartbeat = Date.now();
            }
        };
    }

    async connect() {
        this.intentionalDisconnect = false;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.stopHeartbeat();

        if (this.userAgent) await this.disconnect();

        const user = this.settings.get('username');
        const pass = this.settings.get('password');
        this.lastKnownDomain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        
        if (!user || !pass) return;

        // Note: Update these credentials if you deploy to production
        const iceServers = [{
            urls: "turns:wss.hero.co.nz:5349",
            username: "801061400032",
            credential: "X2dyA5H4"
        }];

        const uri = SIP.UserAgent.makeURI(`sip:${user}@${this.lastKnownDomain}`);
        const uuid = getPersistentInstanceId();
        const anonymousContactName = getPersistentContactName();

        const options = {
            ...this.config.SIP_OPTIONS,
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
            hackIpInContact: false, // Must be false to use .invalid
            forceRport: true,
            sipExtensionExtraSupported: ['outbound'],

            // ENFORCE WEBSOCKET KEEP-ALIVES
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
        this._patchTransportKamailioRegisterContact(this.userAgent, anonymousContactName, uuid);
        await this.userAgent.start();
    }

    /**
     * Wrap transport to sanitize incoming Kamailio messages and inject alias into outbound Contact.
     */
    _patchTransportKamailioRegisterContact(ua, contactUserName, instanceUuid) {
        const transport = ua?.transport;
        if (!transport || transport._kamailioPatched) return;
        transport._kamailioPatched = true;

        let currentAlias = '';

        // 1. PATCH INCOMING MESSAGES
        const innerOnMessage = transport.onMessage;
        if (typeof innerOnMessage === 'function') {
            transport.onMessage = (msg) => {
                let cleanMsg = msg;

                if (typeof cleanMsg === 'string') {
                    // Fix REGISTER 2xx multi-Contact
                    cleanMsg = sanitizeKamailioRegister2xxContact(cleanMsg, contactUserName, instanceUuid);

                    // Extract the NAT alias Kamailio assigned to us
                    const cseqMatch = cleanMsg.match(/^CSeq:\s*\d+\s+REGISTER/im);
                    if (cseqMatch && cleanMsg.startsWith('SIP/2.0 200 OK')) {
                        const aliasMatch = cleanMsg.match(/;(alias=[^;>\s]+)/i);
                        if (aliasMatch) currentAlias = aliasMatch[1];
                    }

                    // Strip illegal quotes from incoming URIs
                    const parts = cleanMsg.split('\r\n\r\n');
                    if (parts.length > 0) {
                        let headers = parts[0];
                        headers = headers
                            .split('\n')
                            .map((line) => {
                                if (
                                    line.startsWith('INVITE sip:') ||
                                    line.startsWith('ACK sip:') ||
                                    line.startsWith('BYE sip:') ||
                                    line.startsWith('CANCEL sip:') ||
                                    line.startsWith('To:') ||
                                    line.startsWith('From:') ||
                                    line.startsWith('Contact:')
                                ) {
                                    return line.replace(/"(urn:uuid:[^"]+)"/g, '$1');
                                }
                                return line;
                            })
                            .join('\n');
                        parts[0] = headers;
                        cleanMsg = parts.join('\r\n\r\n');
                    }
                }
                innerOnMessage.call(transport, cleanMsg);
            };
        }

        // 2. PATCH OUTBOUND MESSAGES
        const innerSend = transport.send;
        if (typeof innerSend === 'function') {
            transport.send = (msg) => {
                let outMsg = msg;
                if (currentAlias && typeof outMsg === 'string') {
                    outMsg = outMsg.replace(/^(Contact:\s*<[^>]+)(>)/im, (match, p1, p2) => {
                        if (!p1.includes('alias=')) {
                            return `${p1};${currentAlias}${p2}`;
                        }
                        return match;
                    });
                }
                return innerSend.call(transport, outMsg);
            };
        }
    }

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
            if (typeof document !== 'undefined' && document.hidden) {
                this.lastHeartbeat = now;
                return;
            }
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
                
                if (!this.intentionalDisconnect) {
                    console.warn("⚠️ Registration dropped (408 Timeout). Forcing full TCP/WS teardown in 3s...");
                    if (this.userAgent) {
                        this.userAgent.stop().catch(()=>{});
                    }
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

        try {
            invitation.progress();
            console.log('📨 Sent 180 Ringing to Kamailio');
        } catch (e) {
            console.warn('Could not send early progress:', e);
        }

        this.audio.startRinging();
        this.setupSession(invitation);

        this.callbacks.onIncoming(
            remoteUser,
            async () => {
                this.audio.stopRinging();
                const options = {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                        iceGatheringTimeout: 100 // Force early-offer to accept immediately
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