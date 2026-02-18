export class AudioManager {
    constructor(settings) {
        this.settings = settings;
        
        // Ringtone (MP3) - will be loaded dynamically based on settings
        this.ringAudio = null;
        this.lastRingtoneFile = null;
        this.loadRingtone();

        // Remote Audio Element
        this.remoteElement = document.getElementById('remoteAudio');

        // AudioContext for Beeps
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Load ringtone file based on settings
    loadRingtone() {
        const ringtoneFile = this.settings.get('ringtoneFile') || 'ringing.mp3';
        const ringtonePath = `public/sounds/${ringtoneFile}`;
        
        // Create new audio element with the selected ringtone
        this.ringAudio = new Audio(ringtonePath);
        this.ringAudio.loop = true;
        this.lastRingtoneFile = ringtoneFile;
        
        // Handle loading errors gracefully
        this.ringAudio.addEventListener('error', (e) => {
            console.error('Error loading ringtone:', ringtonePath, e);
            // Fallback to default ringtone
            if (ringtoneFile !== 'ringing.mp3') {
                this.ringAudio = new Audio('public/sounds/ringing.mp3');
                this.ringAudio.loop = true;
                this.lastRingtoneFile = 'ringing.mp3';
            }
        });
    }

    async init() {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            return await this.enumerateDevices();
        } catch (err) {
            console.error("Audio Permission Denied:", err);
            return { inputs: [], outputs: [] };
        }
    }

    async enumerateDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return {
            inputs: devices.filter(d => d.kind === 'audioinput'),
            outputs: devices.filter(d => d.kind === 'audiooutput')
        };
    }

    async setSinkId(element, deviceId) {
        if (element.setSinkId) {
            try { await element.setSinkId(deviceId); } 
            catch (error) { console.warn(`SinkId Error:`, error); }
        }
    }

    // --- Ringing ---
    startRinging() {
        // Reload ringtone if it was changed (check by comparing filename)
        const currentRingtone = this.settings.get('ringtoneFile') || 'ringing.mp3';
        const lastRingtone = this.lastRingtoneFile || 'ringing.mp3';
        
        if (currentRingtone !== lastRingtone) {
            this.loadRingtone();
            this.lastRingtoneFile = currentRingtone;
        }
        
        const ringerId = this.settings.get('ringerId');
        this.setSinkId(this.ringAudio, ringerId);
        this.ringAudio.currentTime = 0;
        this.ringAudio.play().catch(e => console.log("Interaction needed"));
    }

    stopRinging() {
        this.ringAudio.pause();
        this.ringAudio.currentTime = 0;
    }

    // --- Call Waiting Tone (Beep) ---
    playCallWaitingTone() {
        // Simple oscillator beep so we don't need another MP3
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.value = 440; // A4 tone
        gain.gain.value = 0.1; // Low volume
        
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.5); // Beep for 0.5 sec
    }

    setCallStream(stream) {
        this.remoteElement.srcObject = stream;
        const speakerId = this.settings.get('speakerId');
        this.setSinkId(this.remoteElement, speakerId);
        this.remoteElement.play();
    }
}