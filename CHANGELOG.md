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
- **Warm Transfer UX:** Integrated 'Consult' mode into the main Dial Pad.
- **Line Manager:** UI to toggle between Original Caller (Line 1) and Colleague (Line 2).
- **Consultation Logic:** Automated Hold/Unhold when swapping lines.
### Added
- **3-Way Conferencing:** Added 'Merge' capability to bridge Line 1 and Line 2 into a single conference call.
- **Client-Side Audio Mixing:** Implemented Web Audio API bridging to mix audio streams locally. This allows the Agent to bridge two callers together without requiring a server-side conference room.
- **Dynamic Line Labels:** Line Manager buttons now display the specific phone numbers/extensions connected (e.g., "+6421..." instead of just "Line 1").
- **Contextual UI:** Standard control buttons (Transfer/Consult) now hide automatically when the Line 

### Fixed
- Fixed audio routing issue where held calls remained in `recvonly` mode during a merge.
- Fixed UI duplication bug in the Line Manager panel.

### Fixed
- Fixed critical bug where "Incoming" modal blocked the "Active Call" controls.
- Fixed CSS issue where Hangup button was not Red.
- Fixed DTMF issue by implementing direct RTP insertion instead of just SIP INFO.
- Fixed Hold failure by adding safety checks for call stability.

## [1.3.0] - 2026-02-11

### Added
- **Busy Lamp Field (BLF):** Real-time monitoring of colleague status (Available/Ringing/Busy) using SIP `dialog-info` (RFC 4235).
- **Do Not Disturb (DND):** Toggle switch to reject incoming calls immediately with "486 Busy Here".
- **Call Waiting:** Visual and audible notification for incoming calls while busy.
- **Call Waiting Tone:** Implemented non-intrusive digital beep using Web Audio API (440Hz oscillator) to alert agents without interrupting the audio stream.
- **Audio Bridge:** Implemented client-side audio mixing (Track Grafting) to enable 3-Way Conferencing without server-side bridges.

### Fixed
- **UI:** Resolved duplicate "Agent Panel" headers and DND toggles in the sidebar.
- **Context Logic:** Fixed context scope issues for BLF subscriptions (hints moved to shared context).