const API_URL = 'https://bdl-pbx.itnetworld.co.nz/api/recordings';

async function fetchRecordings() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP status: ${response.status}`);
        const data = await response.json();
        render(data);
    } catch (error) {
        document.getElementById('loading').innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function render(recordings) {
    document.getElementById('loading').style.display = 'none';
    const container = document.getElementById('recordingsList');
    const validRecs = recordings.filter(r => r.recording_url);

    if (validRecs.length === 0) {
        container.innerHTML = '<div class="empty-state">No recordings found.</div>';
        return;
    }

    container.innerHTML = validRecs.map(r => {
        const dateStr = new Date(r.ended_at).toLocaleString();
        const title = `${r.caller_number} to ${r.callee_number}`;
        return `
        <div class="recording-item recording-card" style="display:flex; justify-content:space-between; align-items:center; padding:15px; margin-bottom:12px; background:rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius:12px; transition: transform 0.2s;">
            <div class="recording-info">
                <div style="font-weight:600; color:white; font-size:1.1rem; margin-bottom:4px;">
                    <i class="fa-solid fa-phone-volume" style="font-size:0.8rem; color:var(--primary); margin-right:8px;"></i>${title}
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted);">
                    <i class="fa-regular fa-calendar"></i> ${dateStr} &nbsp;•&nbsp; <i class="fa-solid fa-stopwatch"></i> ${r.duration}s
                </div>
            </div>
            <button class="btn btn-primary play-trigger" data-url="${decodeURIComponent(r.recording_url)}" data-title="${title}" data-date="${dateStr}">
                <i class="fa-solid fa-play"></i> Listen
            </button>
        </div>`;
    }).join('');

    setupModalListeners();
}

function setupModalListeners() {
    const modal = document.getElementById('audioModal');
    const player = document.getElementById('audioPlayer');
    const closeBtn = document.querySelector('.close-modal');

    document.querySelectorAll('.play-trigger').forEach(btn => {
        btn.onclick = () => {
            const url = btn.getAttribute('data-url');
            document.getElementById('modalTitle').innerText = btn.getAttribute('data-title');
            document.getElementById('modalSubtitle').innerText = btn.getAttribute('data-date');
            
            player.src = url;
            modal.style.display = 'block';
            player.play();
        };
    });

    closeBtn.onclick = () => {
        modal.style.display = 'none';
        player.pause();
        player.src = "";
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
            player.pause();
            player.src = "";
        }
    };
}

document.addEventListener('DOMContentLoaded', fetchRecordings);