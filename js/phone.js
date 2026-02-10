import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class PhoneEngine {
    constructor(config, settings, audioManager, callbacks) {
        this.config = config;         // Static config
        this.settings = settings;     // User settings
        this.audio = audioManager;    // Audio controller
        this.callbacks = callbacks;   // UI callbacks (onStatus, onCall, etc)
        
        this.userAgent = null;
        this.session = null;
        this.registerer = null;
    }

    async connect() {
        if (this.userAgent) await this.disconnect();

        const user = this.settings.get('username');
        const pass = this.settings.get('password');
        const domain = this.settings.get('domain');
        const wss = this.settings.get('wssUrl');

        if (!user || !pass || !domain || !wss) {
            this.callbacks.onStatus('Missing Config');
            return;
        }

        const uri = SIP.UserAgent.makeURI(`sip:${user}@${domain}`);
        
        const transportOptions = { 
            server: wss,
            traceSip: true
        };

        this.userAgent = new SIP.UserAgent({
            uri: uri,
            transportOptions: transportOptions,
            authorizationUsername: user,
            authorizationPassword: pass,
            delegate: {
                onInvite: (invitation) => this.handleIncoming(invitation),
                onDisconnect: (error) => {
                    this.callbacks.onStatus('Disconnected');
                    if(error) console.error("SIP Disconnect:", error);
                }
            }
        });

        await this.userAgent.start();
        
        // Setup Registration
        this.registerer = new SIP.Registerer(this.userAgent);
        this.registerer.stateChange.addListener((state) => {
            // SIP.js states: Initial, Registered, Unregistered, Terminated
            this.callbacks.onStatus(state);
        });
        
        await this.registerer.register();
    }

    async disconnect() {
        if (this.registerer) await this.registerer.unregister();
        if (this.userAgent) await this.userAgent.stop();
        this.userAgent = null;
        this.session = null;
    }

    // --- Call Handling ---

    async call(targetNumber) {
        if (!this.userAgent) throw new Error("Not Connected");
        
        const domain = this.settings.get('domain');
        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${domain}`);
        
        // Audio Constraints (Microphone Selection)
        const micId = this.settings.get('micId');
        const constraints = { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
            video: false 
        };

        const inviter = new SIP.Inviter(this.userAgent, target, {
            sessionDescriptionHandlerOptions: { constraints }
        });

        this.setupSession(inviter);
        return inviter.invite();
    }

    handleIncoming(invitation) {
        // If already in a call, reject busy
        if (this.session) {
            invitation.reject({ statusCode: 486 });
            return;
        }

        const callerName = invitation.remoteIdentity.uri.user;
        this.audio.startRinging();

        // Trigger UI Popup
        this.callbacks.onIncoming(callerName, 
            // Accept Action
            () => {
                this.audio.stopRinging();
                const micId = this.settings.get('micId');
                const constraints = { 
                    audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
                    video: false 
                };
                invitation.accept({ sessionDescriptionHandlerOptions: { constraints } });
                this.setupSession(invitation);
            },
            // Reject Action
            () => {
                this.audio.stopRinging();
                invitation.reject();
            }
        );
    }

    setupSession(session) {
        this.session = session;
        const remoteUser = session.remoteIdentity.uri.user;
        
        this.callbacks.onCallStart(remoteUser);

        session.stateChange.addListener((state) => {
            console.log("Session State:", state);
            if (state === SIP.SessionState.Terminated) {
                this.cleanupCall();
            }
            if (state === SIP.SessionState.Established) {
                this.setupRemoteMedia(session);
            }
        });
    }

    setupRemoteMedia(session) {
        const pc = session.sessionDescriptionHandler.peerConnection;
        const remoteStream = new MediaStream();
        
        pc.getReceivers().forEach((receiver) => {
            if (receiver.track) remoteStream.addTrack(receiver.track);
        });
        
        this.audio.setCallStream(remoteStream);
    }

    cleanupCall() {
        this.audio.stopRinging();
        this.session = null;
        this.callbacks.onCallEnd();
    }

    // --- Controls ---
    
    hangup() {
        if (!this.session) return;
        switch(this.session.state) {
            case SIP.SessionState.Initial:
            case SIP.SessionState.Establishing:
                if (this.session instanceof SIP.Inviter) this.session.cancel();
                else this.session.reject();
                break;
            case SIP.SessionState.Established:
                this.session.bye();
                break;
        }
    }

    sendDTMF(tone) {
        if (this.session && this.session.state === SIP.SessionState.Established) {
            this.session.dtmf(tone);
        }
    }

    toggleMute() {
        if (!this.session) return false;
        const pc = this.session.sessionDescriptionHandler.peerConnection;
        let isMuted = false;
        
        pc.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'audio') {
                sender.track.enabled = !sender.track.enabled;
                isMuted = !sender.track.enabled;
            }
        });
        return isMuted;
    }
    
    toggleHold() {
         // TODO: Implement SIP Re-invite for Hold in Phase 2
         console.warn("Hold not fully implemented in Phase 1");
    }
}