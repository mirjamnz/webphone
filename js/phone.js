/**
 * js/phone.js
 * Simplified SIP/WebRTC Engine with RFC 5626 (Outbound) and ICE Fixes
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

// Helper to maintain a consistent endpoint ID across page reloads to prevent ghost registrations
function getPersistentInstanceId() {
    let instanceId = localStorage.getItem('sip_instance_id');
    if (!instanceId) {
        // Generate a standard UUID v4
        instanceId = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('sip_instance_id', instanceId);
    }
    return instanceId;
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

        const uri = SIP.UserAgent.makeURI(`sip:${user}@${domain}`);

        const options = {
            uri: uri,
            transportOptions: this.config.SIP_OPTIONS.transportOptions,
            authorizationUsername: user,
            authorizationPassword: pass,
            
            contactName: user,
            contactParams: { transport: 'ws' },
            hackIpInContact: false,
            
            // Natively set the Via header host to prevent random .invalid domains
            viaHost: domain,
            
            // Provide a persistent Instance ID to prevent multiple ghost registrations
            instanceId: getPersistentInstanceId(),

            // WebRTC Options: Force local ICE gathering, disable default Google STUN
            sessionDescriptionHandlerFactoryOptions: {
                peerConnectionConfiguration: {
                    iceServers: [] // Empty array means NO STUN. Add TURN servers here if needed later.
                }
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
        // Unregister first to clean up server-side registration
        if (this.registerer) {
            try {
                await this.registerer.unregister();
            } catch (e) {
                console.warn('Error unregistering:', e);
            }
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
        
        // Clean up any existing registerer first to prevent multiple registrations locally
        if (this.registerer) {
            try {
                await this.registerer.unregister();
            } catch (e) {
                // Ignore errors during cleanup
            }
            this.registerer = null;
        }
        
        const domain = this.settings.get('domain') || this.config.DEFAULT_DOMAIN;
        
        // Create Registerer
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
        
        // Start ringing sound for incoming call
        this.audio.startRinging();
        
        // Notify UI of incoming call first
        this.callbacks.onIncoming(remoteUser, 
            () => { // User clicked Answer
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
            () => { // User clicked Reject
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
            if (receiver.track) {
                remoteStream.addTrack(receiver.track);
            }
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

    // Functionality placeholders
    toggleMute() { return false; }
    async toggleHold() { return false; }
    isCallActive() { return this.session && this.session.state === SIP.SessionState.Established; }
    sendDTMF(tone) { if (this.session) this.session.dtmf(tone); }
}