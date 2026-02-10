# Changelog

All notable changes to the WebRTC Call Center project will be documented in this file.

## [Unreleased]
### Planned
- Blind Transfer functionality.
- Warm/Attended Transfer functionality.
- Conference Calling (3-Way).
- Busy Lamp Field (BLF) for agent status.
- DND (Do Not Disturb) toggle.

## [1.0.0] - 2026-02-11
### Added
- **Modular Architecture:** Split monolithic HTML into `app.js`, `phone.js`, `audio.js`, `settings.js`.
- **Persistent Settings:** User credentials, WSS server, and Audio Device selections are now saved in LocalStorage.
- **Audio Manager:** Dedicated class to handle Ringing (MP3), Microphone selection, and Speaker output routing.
- **Call Control:**
  - Outbound Calling with specific microphone constraints.
  - Incoming Call popup with Accept/Reject logic.
  - Hangup (Red Button).
  - Hold/Resume (SIP Re-Invite with `sendonly`/`sendrecv`).
  - DTMF Tone generation (RTP/RFC4733 support).
- **UI Improvements:**
  - "Dark Mode" dashboard design.
  - Dynamic "Active Call" vs "Idle" states.
  - Visual Feedback for Mute, Hold, and Connection Status.
  - Timer for active calls.
- **Blind Transfer:** Added UI button and SIP REFER logic to transfer calls immediately to another extension.
- **Blind Transfer:** Added UI button and to warm transfer calls to PSTN.

### Fixed
- Fixed critical bug where "Incoming" modal blocked the "Active Call" controls.
- Fixed CSS issue where Hangup button was not Red.
- Fixed DTMF issue by implementing direct RTP insertion instead of just SIP INFO.
- Fixed Hold failure by adding safety checks for call stability.