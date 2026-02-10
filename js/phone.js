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
        
        // Conference Audio Context
        this.confCtx = null;
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
        
        // Cleanup Conference Context if exists
        if (this.confCtx) {
            this.confCtx.close();
            this.confCtx = null;
        }

        this.session = null;
        this.consultSession = null;
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

    sendDTMF(tone) {
        if (!this.isCallActive()) return false;
        console.log(`Attempting DTMF: ${tone}`);
        const pc = this.session.sessionDescriptionHandler.peerConnection;
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender && sender.dtmf) {
            sender.dtmf.insertDTMF(tone, 100, 70); 
            return true;
        }
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
    
    async toggleHold() {
        if (!this.isCallActive()) return false;
        const newHoldState = !this.isHeld;
        const micId = this.settings.get('micId');
        const constraints = { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
            video: false 
        };
        const options = {
            sessionDescriptionHandlerOptions: { constraints: constraints, hold: newHoldState }
        };
        try {
            await this.session.invite(options);
            this.isHeld = newHoldState;
            return this.isHeld;
        } catch (err) {
            console.error("Hold failed:", err);
            return this.isHeld; 
        }
    }

    async blindTransfer(targetNumber) {
        if (!this.isCallActive()) return false;
        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${this.settings.get('domain')}`);
        if (!target) return false;
        const options = {
            requestDelegate: {
                onAccept: () => { this.cleanupCall(); },
                onReject: (response) => { alert("Transfer Failed: " + response.reasonPhrase); }
            }
        };
        try {
            await this.session.refer(target, options);
            return true;
        } catch (e) {
            console.error("Transfer Exception", e);
            return false;
        }
    }

    async startConsultation(targetNumber) {
        if (!this.isCallActive()) return false;
        if (!this.isHeld) await this.toggleHold(); 

        const domain = this.settings.get('domain');
        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${domain}`);
        const micId = this.settings.get('micId');
        const constraints = { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
            video: false 
        };
        const inviter = new SIP.Inviter(this.userAgent, target, {
            sessionDescriptionHandlerOptions: { constraints }
        });
        this.consultSession = inviter; 
        this.consultSession.stateChange.addListener((state) => {
            if (state === SIP.SessionState.Established) this.setupRemoteMedia(this.consultSession);
            if (state === SIP.SessionState.Terminated) this.consultSession = null;
        });
        return inviter.invite();
    }

    async completeConsultation() {
        if (!this.session || !this.consultSession) return false;
        const target = this.consultSession.remoteIdentity.uri;
        try {
            await this.session.refer(target);
            this.consultSession.bye(); 
            this.cleanupCall(); 
            return true;
        } catch (e) {
            console.error("Warm Transfer Failed", e);
            return false;
        }
    }

    async cancelConsultation() {
        if (this.consultSession) {
            this.consultSession.state === SIP.SessionState.Established ? this.consultSession.bye() : this.consultSession.cancel();
            this.consultSession = null;
        }
        if (this.session && this.session.state === SIP.SessionState.Established) {
            this.setupRemoteMedia(this.session);
        }
    }

    async swapToLine(lineNumber) {
        if (!this.session || !this.consultSession) return;
        const micId = this.settings.get('micId');
        const constraints = { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true, 
            video: false 
        };
        if (lineNumber === 1) {
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: true } });
            await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            this.isHeld = false; 
        } 
        else if (lineNumber === 2) {
            await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: true } });
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            this.isHeld = true; 
        }
    }

    // --- REVISED: Web Audio API Mixing (The "Magic Bridge") ---
    async mergeCalls() {
        if (!this.session || !this.consultSession) return false;
        console.log("Merging calls: Setting up Digital Audio Bridge...");

        try {
            // 1. Unhold both lines via SIP (So Asterisk accepts audio)
            const micId = this.settings.get('micId');
            const constraints = { audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true, video: false };
            
            if (this.isHeld) await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });

            // 2. Setup Audio Context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.confCtx = new AudioContext();
            
            // 3. Get Peer Connections
            const pc1 = this.session.sessionDescriptionHandler.peerConnection;
            const pc2 = this.consultSession.sessionDescriptionHandler.peerConnection;

            // 4. Get Sources (Mic, Remote1, Remote2)
            
            // Mic Source (From PC1 sender)
            const sender1 = pc1.getSenders().find(s => s.track && s.track.kind === 'audio');
            const micStream = new MediaStream([sender1.track]);
            const micSource = this.confCtx.createMediaStreamSource(micStream);

            // Remote 1 Source (From PC1 receivers)
            const remoteStream1 = new MediaStream();
            pc1.getReceivers().forEach(r => r.track && remoteStream1.addTrack(r.track));
            const remoteSource1 = this.confCtx.createMediaStreamSource(remoteStream1);

            // Remote 2 Source (From PC2 receivers)
            const remoteStream2 = new MediaStream();
            pc2.getReceivers().forEach(r => r.track && remoteStream2.addTrack(r.track));
            const remoteSource2 = this.confCtx.createMediaStreamSource(remoteStream2);

            // 5. Create Mix Destinations
            // Mix for Line 1 (Needs Mic + Line 2)
            const destForLine1 = this.confCtx.createMediaStreamDestination();
            micSource.connect(destForLine1);
            remoteSource2.connect(destForLine1);

            // Mix for Line 2 (Needs Mic + Line 1)
            const destForLine2 = this.confCtx.createMediaStreamDestination();
            micSource.connect(destForLine2);
            remoteSource1.connect(destForLine2);

            // 6. Inject the Mix (Swap Tracks)
            // This is safer than addTrack because it doesn't change SDP structure
            const mixedTrack1 = destForLine1.stream.getAudioTracks()[0];
            const mixedTrack2 = destForLine2.stream.getAudioTracks()[0];

            await sender1.replaceTrack(mixedTrack1);
            const sender2 = pc2.getSenders().find(s => s.track && s.track.kind === 'audio');
            await sender2.replaceTrack(mixedTrack2);

            console.log("Audio Bridge Established: 3-Way Active");
            
            this.isConference = true;
            this.isHeld = false; 
            return true;

        } catch (err) {
            console.error("Merge failed:", err);
            return false;
        }
    }
}