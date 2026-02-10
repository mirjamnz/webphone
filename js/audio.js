export class AudioManager {
    constructor(settings) {
        this.settings = settings;
        
        // Setup Ringtone
        this.ringAudio = new Audio('sounds/ringing.mp3'); // Ensure this file exists!
        this.ringAudio.loop = true;

        // Remote Audio Element (defined in HTML)
        this.remoteElement = document.getElementById('remoteAudio');
    }

    // Initialize: Request permission and list devices
    async init() {
        try {
            // We must request permission to see device labels
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

    // Helper to set output device (Chrome/Edge only)
    async setSinkId(element, deviceId) {
        if (element.setSinkId) {
            try {
                await element.setSinkId(deviceId);
            } catch (error) {
                console.warn(`Failed to set SinkId to ${deviceId}`, error);
            }
        }
    }

    // --- Ringing Control ---
    startRinging() {
        const ringerId = this.settings.get('ringerId');
        this.setSinkId(this.ringAudio, ringerId);
        
        this.ringAudio.currentTime = 0;
        this.ringAudio.play().catch(e => console.log("User interaction needed to play audio"));
    }

    stopRinging() {
        this.ringAudio.pause();
        this.ringAudio.currentTime = 0;
    }

    // --- Call Audio Control ---
    setCallStream(stream) {
        this.remoteElement.srcObject = stream;
        const speakerId = this.settings.get('speakerId');
        this.setSinkId(this.remoteElement, speakerId);
        this.remoteElement.play();
    }
}