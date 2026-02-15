import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class PhoneEngine {
    constructor(config, settings, audioManager, callbacks) {
        this.config = config;         
        this.settings = settings;     
        this.audio = audioManager;    
        this.callbacks = callbacks;   
        
        this.userAgent = null;
        this.session = null;        // Line 1
        this.consultSession = null; // Line 2
        this.registerer = null;
        this.isHeld = false;
        this.dnd = false;           // Do Not Disturb State
        this.confCtx = null;
        
        // Timer for Keep-Alive Pings
        this.keepAliveTimer = null; 
    }

    setDND(state) {
        this.dnd = state;
        console.log("DND set to:", this.dnd);
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
        
        this.userAgent = new SIP.UserAgent({
            uri: uri,
            transportOptions: { 
                server: wss,
                // Native SIP.js Keep-Alive (backup)
                keepAliveInterval: 30 
            },
            authorizationUsername: user,
            authorizationPassword: pass,
            delegate: {
                onInvite: (invitation) => this.handleIncoming(invitation),
                onDisconnect: (error) => {
                    this.stopKeepAlive(); // Stop manual pings
                    this.callbacks.onStatus('Disconnected');
                }
            }
        });

        await this.userAgent.start();
        this.registerer = new SIP.Registerer(this.userAgent);
        
        this.registerer.stateChange.addListener((state) => {
            this.callbacks.onStatus(state);
            if (state === 'Registered') {
                this.startKeepAlive(); // Start manual pings
            }
        });
        
        await this.registerer.register();
    }

    async disconnect() {
        this.stopKeepAlive();
        if (this.registerer) await this.registerer.unregister();
        if (this.userAgent) await this.userAgent.stop();
        this.userAgent = null;
        this.session = null;
    }

    // --- Keep Alive Logic (Prevents NAT Timeout) ---
    startKeepAlive() {
        this.stopKeepAlive(); // Clear existing to be safe
        console.log("Starting Keep-Alive Pings...");
        
        // Ping every 30 seconds
        this.keepAliveTimer = setInterval(() => {
            if (this.userAgent && this.userAgent.transport.isConnected()) {
                // Sending a lightweight OPTIONS request to the server
                // This forces traffic over the socket, keeping the router port open.
                const registrarURI = SIP.UserAgent.makeURI(`sip:${this.settings.get('domain')}`);
                // Fire and forget message to generate traffic
                const pinger = new SIP.Messager(this.userAgent, registrarURI, "Ping", "text/plain");
                pinger.message(); 
            }
        }, 30000);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
            console.log("Stopped Keep-Alive Pings.");
        }
    }

    // --- Incoming Logic (DND & Call Waiting) ---
    handleIncoming(invitation) {
        const callerName = invitation.remoteIdentity.uri.user;

        // 1. DND Check
        if (this.dnd) {
            console.log("DND Active: Rejecting call from", callerName);
            invitation.reject({ statusCode: 486 }); // Busy Here
            return;
        }

        // 2. Busy Check (If BOTH lines are full)
        if (this.session && this.consultSession) {
            console.log("All lines busy: Rejecting call from", callerName);
            invitation.reject({ statusCode: 486 });
            return;
        }

        // 3. Call Waiting Check (Line 1 busy, Line 2 free)
        if (this.session && !this.consultSession) {
            console.log("Call Waiting: Incoming call from", callerName);
            this.audio.playCallWaitingTone(); // Beep only
            
            this.callbacks.onIncoming(callerName, 
                // ACCEPT (Call Waiting)
                async () => {
                    // Auto-Hold Line 1
                    if (!this.isHeld) await this.toggleHold();
                    
                    // Answer Line 2
                    this.acceptCallWaiting(invitation);
                },
                // REJECT
                () => {
                    invitation.reject();
                }
            );
            return;
        }

        // 4. Standard Incoming (Line 1 free)
        this.audio.startRinging();
        this.callbacks.onIncoming(callerName, 
            () => { 
                this.audio.stopRinging();
                this.acceptStandardCall(invitation);
            },
            () => { 
                this.audio.stopRinging();
                invitation.reject();
            }
        );
    }

    // Accept logic for Line 1
    acceptStandardCall(invitation) {
        const constraints = this.getAudioConstraints();
        invitation.accept({ sessionDescriptionHandlerOptions: { constraints } });
        this.setupSession(invitation);
    }

    // Accept logic for Line 2 (Call Waiting)
    acceptCallWaiting(invitation) {
        const constraints = this.getAudioConstraints();
        invitation.accept({ sessionDescriptionHandlerOptions: { constraints } });
        
        // Assign to consultSession (Line 2)
        this.consultSession = invitation;
        
        this.consultSession.stateChange.addListener((state) => {
            if (state === SIP.SessionState.Established) {
                this.setupRemoteMedia(this.consultSession);
            }
            if (state === SIP.SessionState.Terminated) {
                this.consultSession = null;
            }
        });

        // Trigger UI callback to switch view to Line 2
        this.callbacks.onCallWaitingAccept();
    }

    getAudioConstraints() {
        const micId = this.settings.get('micId');
        return { 
            audio: micId && micId !== 'default' ? { deviceId: { exact: micId } } : true,
            video: false 
        };
    }

    // --- Standard Methods (Call, Hold, etc) ---
    async call(targetNumber) {
        if (!this.userAgent) throw new Error("Not Connected");
        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${this.settings.get('domain')}`);
        const inviter = new SIP.Inviter(this.userAgent, target, {
            sessionDescriptionHandlerOptions: { constraints: this.getAudioConstraints() }
        });
        this.setupSession(inviter);
        return inviter.invite();
    }

    setupSession(session) {
        this.session = session;
        this.isHeld = false;
        const remoteUser = session.remoteIdentity.uri.user;
        this.callbacks.onCallStart(remoteUser);

        session.stateChange.addListener((state) => {
            if (state === SIP.SessionState.Terminated) this.cleanupCall();
            if (state === SIP.SessionState.Established) this.setupRemoteMedia(session);
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
        console.log("cleanupCall() called. Session:", this.session?.state, "Consult:", this.consultSession?.state);
        
        this.audio.stopRinging();
        
        // Clean up conference context
        if (this.confCtx) {
            try {
                this.confCtx.close();
            } catch (e) {
                console.error("Error closing conference context:", e);
            }
            this.confCtx = null;
        }
        
        // Check main session (Line 1)
        if (this.session) {
            const sessionState = this.session.state;
            if (sessionState === SIP.SessionState.Terminated) {
                this.session = null;
                this.isHeld = false;
            }
        }
        
        // Check consultation session (Line 2)
        if (this.consultSession) {
            const consultState = this.consultSession.state;
            if (consultState === SIP.SessionState.Terminated) {
                this.consultSession = null;
            }
        }
        
        // If NO active sessions exist, trigger call end
        const hasActiveSession = this.session && 
            (this.session.state === SIP.SessionState.Established || 
             this.session.state === SIP.SessionState.Establishing ||
             this.session.state === SIP.SessionState.Ringing);
        
        const hasActiveConsult = this.consultSession && 
            (this.consultSession.state === SIP.SessionState.Established || 
             this.consultSession.state === SIP.SessionState.Establishing ||
             this.consultSession.state === SIP.SessionState.Ringing);
        
        if (!hasActiveSession && !hasActiveConsult) {
            // Both sessions ended or don't exist
            this.session = null;
            this.consultSession = null;
            this.isHeld = false;
            this.isConference = false;
            this.callbacks.onCallEnd();
        } else if (!hasActiveSession && hasActiveConsult) {
            // Main session ended but consult session still active - return to consult
            this.session = null;
            this.setupRemoteMedia(this.consultSession);
        }
    }

    hangup() {
        console.log("Hangup called. Session state:", this.session?.state);
        
        // Hang up main session (Line 1)
        if (this.session) {
            try {
                // Check if session is in a state that can be hung up
                const state = this.session.state;
                if (state === SIP.SessionState.Established || 
                    state === SIP.SessionState.Establishing ||
                    state === SIP.SessionState.Initial ||
                    state === SIP.SessionState.Ringing) {
                    this.session.bye();
                } else if (state === SIP.SessionState.InviteSent) {
                    this.session.cancel();
                } else {
                    // Force cleanup if session exists but in unexpected state
                    console.warn("Session in unexpected state, forcing cleanup:", state);
                    this.session = null;
                    this.cleanupCall();
                }
            } catch (e) {
                console.error("Error hanging up main session:", e);
                // Force cleanup on error
                this.session = null;
                this.cleanupCall();
            }
        } else {
            // No session, but might have consult session
            if (this.consultSession) {
                console.log("No main session, but consult session exists");
            } else {
                console.log("No active sessions to hang up");
            }
        }
        
        // Hang up consultation session (Line 2) if exists
        if (this.consultSession) {
            try {
                const state = this.consultSession.state;
                if (state === SIP.SessionState.Established || 
                    state === SIP.SessionState.Establishing ||
                    state === SIP.SessionState.Initial ||
                    state === SIP.SessionState.Ringing) {
                    this.consultSession.bye();
                } else if (state === SIP.SessionState.InviteSent) {
                    this.consultSession.cancel();
                }
                this.consultSession = null;
            } catch (e) {
                console.error("Error hanging up consultation session:", e);
                this.consultSession = null;
            }
        }
        
        // Clean up conference context if exists
        if (this.confCtx) {
            try {
                this.confCtx.close();
                this.confCtx = null;
            } catch (e) {
                console.error("Error closing conference context:", e);
            }
        }
        
        // Reset state
        this.isHeld = false;
        this.isConference = false;
        
        // If no sessions exist, trigger cleanup immediately
        if (!this.session && !this.consultSession) {
            this.cleanupCall();
        }
    }

    isCallActive() {
        return this.session && this.session.state === SIP.SessionState.Established;
    }

    sendDTMF(tone) {
        if (!this.isCallActive()) return false;
        const pc = this.session.sessionDescriptionHandler.peerConnection;
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender && sender.dtmf) { sender.dtmf.insertDTMF(tone, 100, 70); return true; }
        this.session.dtmf(tone); return true;
    }

    toggleMute() {
        console.log("toggleMute() called. Session:", this.session?.state);
        if (!this.session) {
            console.warn("No session for mute");
            return false;
        }
        
        try {
            const pc = this.session.sessionDescriptionHandler?.peerConnection;
            if (!pc) {
                console.error("No peer connection for mute");
                return false;
            }
            
            let isMuted = false;
            let hasTrack = false;
            pc.getSenders().forEach(s => { 
                if(s.track) { 
                    hasTrack = true;
                    s.track.enabled = !s.track.enabled; 
                    isMuted = !s.track.enabled; 
                }
            });
            
            if (!hasTrack) {
                console.warn("No audio track found for mute");
                return false;
            }
            
            console.log("Mute toggled, new state:", isMuted);
            return isMuted;
        } catch (error) {
            console.error("Error in toggleMute:", error);
            return false;
        }
    }
    
    async toggleHold() {
        if (!this.isCallActive()) return false;
        const newHoldState = !this.isHeld;
        const options = { sessionDescriptionHandlerOptions: { constraints: this.getAudioConstraints(), hold: newHoldState } };
        try { await this.session.invite(options); this.isHeld = newHoldState; return this.isHeld; } 
        catch (err) { return this.isHeld; }
    }

    async blindTransfer(targetNumber) {
        if (!this.isCallActive()) return false;
        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${this.settings.get('domain')}`);
        try { await this.session.refer(target); return true; } catch (e) { return false; }
    }

    async startConsultation(targetNumber) {
        if (!this.isCallActive()) return false;
        if (!this.isHeld) await this.toggleHold(); 

        const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${this.settings.get('domain')}`);
        const inviter = new SIP.Inviter(this.userAgent, target, { sessionDescriptionHandlerOptions: { constraints: this.getAudioConstraints() } });
        
        this.consultSession = inviter; 
        this.consultSession.stateChange.addListener((state) => {
            if (state === SIP.SessionState.Established) this.setupRemoteMedia(this.consultSession);
            if (state === SIP.SessionState.Terminated) {
                this.consultSession = null;
                // If main session still exists, return to it
                if (this.session && this.session.state === SIP.SessionState.Established) {
                    this.setupRemoteMedia(this.session);
                } else {
                    // Both sessions ended
                    this.cleanupCall();
                }
            }
        });
        return inviter.invite();
    }

    async completeConsultation() {
        if (!this.session || !this.consultSession) return false;
        try {
            await this.session.refer(this.consultSession.remoteIdentity.uri);
            this.consultSession.bye(); 
            this.cleanupCall(); 
            return true;
        } catch (e) { return false; }
    }

    async cancelConsultation() {
        if (this.consultSession) {
            this.consultSession.state === SIP.SessionState.Established ? this.consultSession.bye() : this.consultSession.cancel();
            this.consultSession = null;
        }
        if (this.session && this.session.state === SIP.SessionState.Established) this.setupRemoteMedia(this.session);
    }

    async swapToLine(lineNumber) {
        if (!this.session || !this.consultSession) return;
        const constraints = this.getAudioConstraints();
        if (lineNumber === 1) {
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: true } });
            await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            this.isHeld = false; 
        } else {
            await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: true } });
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            this.isHeld = true; 
        }
    }

    async mergeCalls() {
        if (!this.session || !this.consultSession) return false;
        try {
            const constraints = this.getAudioConstraints();
            if (this.isHeld) await this.session.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });
            await this.consultSession.invite({ sessionDescriptionHandlerOptions: { constraints, hold: false } });

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.confCtx = new AudioContext();
            
            const pc1 = this.session.sessionDescriptionHandler.peerConnection;
            const pc2 = this.consultSession.sessionDescriptionHandler.peerConnection;

            const sender1 = pc1.getSenders().find(s => s.track && s.track.kind === 'audio');
            const micStream = new MediaStream([sender1.track]);
            const micSource = this.confCtx.createMediaStreamSource(micStream);

            const remoteStream1 = new MediaStream();
            pc1.getReceivers().forEach(r => r.track && remoteStream1.addTrack(r.track));
            const remoteSource1 = this.confCtx.createMediaStreamSource(remoteStream1);

            const remoteStream2 = new MediaStream();
            pc2.getReceivers().forEach(r => r.track && remoteStream2.addTrack(r.track));
            const remoteSource2 = this.confCtx.createMediaStreamSource(remoteStream2);

            const destForLine1 = this.confCtx.createMediaStreamDestination();
            micSource.connect(destForLine1);
            remoteSource2.connect(destForLine1);

            const destForLine2 = this.confCtx.createMediaStreamDestination();
            micSource.connect(destForLine2);
            remoteSource1.connect(destForLine2);

            await sender1.replaceTrack(destForLine1.stream.getAudioTracks()[0]);
            const sender2 = pc2.getSenders().find(s => s.track && s.track.kind === 'audio');
            await sender2.replaceTrack(destForLine2.stream.getAudioTracks()[0]);
            
            this.isConference = true;
            this.isHeld = false; 
            return true;
        } catch (err) { return false; }
    }
}