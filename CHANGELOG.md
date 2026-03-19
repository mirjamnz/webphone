# Changelog

## [2.2.0] - 2026-03-19
### Added
- **Visual Waveforms:** Integrated `WaveSurfer.js` to replace the standard HTML5 audio player with a dynamic visual waveform for call recordings.
- **Searchable Archive:** Implemented a real-time search bar in the Recordings tab to filter call logs by caller or callee number.
- **Enhanced Modal Player:** Replaced the floating browser player with a centered, high-fidelity modal featuring play/pause toggles and blur-background effects.

### Fixed
- **Nginx Priority Routing:** Resolved 404 errors by adding `^~` priority modifiers to the Nginx configuration, ensuring `/api/recordings` correctly hits the Node.js bridge instead of PostgREST.
- **Modal Visibility:** Fixed a CSS conflict where the `.hidden` utility class was preventing the audio modal from displaying even when triggered.
- **Audio Cleanup:** Added logic to automatically pause and destroy the audio stream when the recording modal is closed to prevent overlapping playback.

### Technical
- Migrated recording data source from PostgREST (Port 3000) to Node.js Bridge (Port 3002) for better permission handling and schema caching.
- Optimized WaveSurfer initialization with a timeout to ensure reliable DOM attachment during dashboard boot.
## [2.1.0] - 2026-03-19
### Added
- **Hero Branding:** Rebranded UI from TVShop to Hero Internet including new logos and color schemes.
- **Recordings Dashboard:** Added a dedicated "Recordings" tab to the Supervisor Dashboard fetching from Postgres `call_logs`.
- **Backend Recordings API:** Implemented `/api/recordings` endpoint in `server.js` to serve historical call data with recording links.
- **Permission Safety:** Added explicit `getUserMedia` checks before outgoing calls to prevent browser-level permission denials.

### Fixed
- **Registration Logic:** Normalized SIP status strings to correctly display "Connected" status in the UI regardless of server case-sensitivity.
- **Device Population:** Restored the ability to select specific Microphone and Speaker hardware in the configuration modal.
- **Layout Integrity:** Fixed broken HTML tags causing UI chaos in the sidebar and dashboard.

### Technical
- Optimized `app.js` and `server.js` for modularity, reducing line counts while increasing functionality.
- Implemented automatic URL decoding for Hero recording links to ensure one-click playback from the dashboard.
