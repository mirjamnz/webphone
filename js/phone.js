import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class PhoneEngine {
    constructor(config, settings, audioManager, callbacks) {
        this.config = config;         
        this.settings = settings;     
        this.audio = audioManager;    
        this.callbacks = callbacks;   
        
        this.userAgent = null;
        this.session = null;
        this.registerer = null;
        this.isHeld = false; 
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
        
        this.registerer = new SIP.Registerer(this.userAgent);
        this.registerer.stateChange.addListener((state) => {
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
        
        // Audio Constraints
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
        if (this.session) {
            invitation.reject({ statusCode: 486 });
            return;
        }

        const callerName = invitation.remoteIdentity.uri.user;
        this.audio.startRinging();

        this.callbacks.onIncoming(callerName, 
            () => { // Accept
                this.audio.stopRinging();
                const micId = this.settings.get('micId');
                const constraints = { 
                    audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
                    video: false 
                };
                invitation.accept({ sessionDescriptionHandlerOptions: { constraints } });
                this.setupSession(invitation);
            },
            () => { // Reject
                this.audio.stopRinging();
                invitation.reject();
            }
        );
    }

    setupSession(session) {
        this.session = session;
        this.isHeld = false;
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
        this.isHeld = false;
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

    isCallActive() {
        return this.session && this.session.state === SIP.SessionState.Established;
    }

    // --- FIX 1: DTMF (Keypad) ---
    sendDTMF(tone) {
        if (!this.isCallActive()) return false;

        console.log(`Attempting DTMF: ${tone}`);

        // Method A: Insert into Audio Stream (RFC 4733/2833) - Preferred by Asterisk
        const pc = this.session.sessionDescriptionHandler.peerConnection;
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        
        if (sender && sender.dtmf) {
            console.log("Sending DTMF via RTP (Audio)");
            sender.dtmf.insertDTMF(tone, 100, 70); // Tone, Duration, Gap
            return true;
        }

        // Method B: SIP INFO (Fallback)
        console.log("Sending DTMF via SIP INFO");
        this.session.dtmf(tone);
        return true;
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
    
    // --- FIX 2: Hold / Resume ---
    async toggleHold() {
        if (!this.isCallActive()) {
            console.warn("Cannot hold: Call not active");
            return false;
        }

        const newHoldState = !this.isHeld;
        
        // We must preserve audio constraints or microphone might die on resume
        const micId = this.settings.get('micId');
        const constraints = { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
            video: false 
        };

        const options = {
            sessionDescriptionHandlerOptions: {
                constraints: constraints,
                hold: newHoldState // This adds a=sendonly or a=sendrecv
            }
        };

        try {
            console.log(`Sending Hold Re-Invite: ${newHoldState}`);
            await this.session.invite(options);
            this.isHeld = newHoldState;
            return this.isHeld;
        } catch (err) {
            console.error("Hold failed:", err);
            // If error, return the OLD state (nothing changed)
            return this.isHeld; 
        }
    }

// --- ADDED: Blind Transfer ---
async blindTransfer(targetNumber) {
    if (!this.isCallActive()) return false;

    console.log(`Attempting Blind Transfer to: ${targetNumber}`);
    const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${this.settings.get('domain')}`);

    if (!target) {
        console.error("Invalid Transfer Target");
        return false;
    }

    // SIP REFER method (Standard Blind Transfer)
    const options = {
        requestDelegate: {
            onAccept: () => {
                console.log("Transfer Accepted");
                this.cleanupCall(); // End our side of the call
            },
            onReject: (response) => {
                console.warn("Transfer Rejected", response);
                alert("Transfer Failed: " + response.reasonPhrase);
            }
        }
    };

    try {
        // "refer" sends the caller to the new target
        await this.session.refer(target, options);
        return true;
    } catch (e) {
        console.error("Transfer Exception", e);
        return false;
    }
}

}