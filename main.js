import './style.css';
import Peer from 'peerjs';

// ============================================================
// 🚀 SCREEN SHARE + REMOTE CONTROL ENGINE
// ============================================================

// --- DOM ---
const shareBtn = document.getElementById('shareBtn');
const stopBtn = document.getElementById('stopBtn');
const controlBtn = document.getElementById('controlBtn');
const statusBadge = document.getElementById('statusBadge');
const roomInfo = document.getElementById('roomInfo');
const placeholder = document.getElementById('placeholder');
const screenVideo = document.getElementById('screenVideo');
const remoteOverlay = document.getElementById('remoteOverlay');
const cursorDot = document.getElementById('cursorDot');
const qrSection = document.getElementById('qrSection');
const qrImage = document.getElementById('qrImage');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const statusText = document.getElementById('statusText');
const deviceCount = document.getElementById('deviceCount');

// --- State ---
let peer = null;
let connections = [];
let screenStream = null;
let isSharing = false;
let isControlEnabled = false;
let roomId = '';
let isPhone = false;

// --- Detect if device is phone ---
if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    isPhone = true;
    document.querySelector('.header h1').textContent = '📱 Viewer + Controller';
}

// --- Initialize Peer ---
async function initPeer() {
    try {
        // Check if URL has room ID
        const params = new URLSearchParams(window.location.search);
        const existingRoom = params.get('room');

        if (existingRoom) {
            // Phone mode - join existing room
            roomId = existingRoom;
            await connectToRoom(roomId);
            return;
        }

        // Laptop mode - create new room
        roomId = 'screen-' + Math.random().toString(36).substring(2, 10);
        await createRoom(roomId);

    } catch (error) {
        console.error('Peer init error:', error);
        statusText.innerHTML = '<span class="disconnected">● Error: ' + error.message + '</span>';
    }
}

// --- Create Room (Laptop) ---
function createRoom(id) {
    return new Promise((resolve, reject) => {
        peer = new Peer(id, {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        peer.on('open', (peerId) => {
            console.log('✅ Room created:', peerId);
            updateUI('host');
            generateQR();
            resolve();
        });

        peer.on('connection', (conn) => {
            console.log('📱 Phone connected!');
            connections.push(conn);
            setupConnection(conn);
            updateDeviceCount();

            // Send screen stream if sharing
            if (isSharing && screenStream) {
                sendScreenStream(conn);
            }
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
            reject(err);
        });
    });
}

// --- Connect to Room (Phone) ---
function connectToRoom(id) {
    return new Promise((resolve, reject) => {
        peer = new Peer({
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        peer.on('open', () => {
            console.log('✅ Phone peer ready, connecting to:', id);
            const conn = peer.connect(id);
            conn.on('open', () => {
                connections.push(conn);
                setupConnection(conn);
                updateUI('phone');
                updateDeviceCount();
                resolve();
            });
        });

        peer.on('error', (err) => {
            console.error('Connection error:', err);
            reject(err);
        });
    });
}

// --- Setup Connection ---
function setupConnection(conn) {
    conn.on('data', (data) => {
        handleData(data, conn);
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        updateDeviceCount();
        console.log('🔌 Device disconnected');
    });
}

// --- Handle Data ---
function handleData(data, conn) {
    if (data.type === 'tap') {
        // Phone tapped - simulate click on laptop
        if (isControlEnabled && !isPhone) {
            simulateClick(data.x, data.y);
        }
    }

    if (data.type === 'screen-stream') {
        // Receiving screen stream from laptop
        if (isPhone) {
            const video = document.getElementById('screenVideo');
            video.srcObject = data.stream;
            video.style.display = 'block';
            placeholder.style.display = 'none';
            remoteOverlay.classList.add('active');
            document.querySelector('.tap-hint').textContent = '👆 Tap anywhere to control laptop';
        }
    }

    if (data.type === 'cursor-position') {
        // Show cursor on phone
        if (isPhone) {
            cursorDot.style.left = data.x + '%';
            cursorDot.style.top = data.y + '%';
            cursorDot.classList.add('show');
        }
    }
}

// --- Send Screen Stream ---
function sendScreenStream(conn) {
    // We can't send MediaStream directly over PeerJS data channel
    // Instead, we tell the phone to request it via WebRTC
    conn.send({
        type: 'request-stream'
    });
}

// Phone side answering logic for the media call
peer?.on('call', (call) => {
    call.answer();
    call.on('stream', (remoteStream) => {
        if (isPhone) {
            const video = document.getElementById('screenVideo');
            video.srcObject = remoteStream;
            video.style.display = 'block';
            placeholder.style.display = 'none';
            remoteOverlay.classList.add('active');
            document.querySelector('.tap-hint').textContent = '👆 Tap anywhere to control laptop';
        }
    });
});

// Fix: Add logic to actually call the phone when screenStream is ready
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'monitor',
                cursor: 'always'
            },
            audio: false
        });

        // Show video locally on host
        screenVideo.srcObject = screenStream;
        screenVideo.style.display = 'block';
        placeholder.style.display = 'none';

        isSharing = true;
        shareBtn.textContent = '🟢 Sharing...';
        shareBtn.classList.add('active');
        stopBtn.style.display = 'inline-block';
        updateUI('host');

        // Broadcast to connected devices via PeerJS media call
        connections.forEach(conn => {
            if (conn.open) {
                peer.call(conn.peer, screenStream);
            }
        });

        // Handle stop
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        statusText.innerHTML = '<span class="connected">● Screen sharing active</span>';

    } catch (error) {
        console.error('Screen share error:', error);
        alert('Failed to share screen. Please grant permission.');
    }
}


// --- Simulate Click ---
function simulateClick(x, y) {
    // Calculate screen coordinates
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    const clickX = (x / 100) * window.screen.width;
    const clickY = (y / 100) * window.screen.height;

    console.log(`🖱️ Simulating click at (${clickX}, ${clickY})`);

    // Create and dispatch click event
    const event = new MouseEvent('click', {
        clientX: (x / 100) * window.innerWidth,
        clientY: (y / 100) * window.innerHeight,
        bubbles: true,
        cancelable: true
    });

    // Send cursor position to phone
    connections.forEach(conn => {
        if(conn.open) {
            conn.send({
                type: 'cursor-position',
                x: x,
                y: y
            });
        }
    });

    // Simulate click on the viewer
    document.getElementById('viewer').dispatchEvent(event);

    // Attempt to click the actual DOM element (works if sharing current tab)
    const element = document.elementFromPoint((x / 100) * window.innerWidth, (y / 100) * window.innerHeight);
    if(element && element !== document.getElementById('remoteOverlay')) {
        element.click();
    }

    // Show feedback
    const dot = document.getElementById('cursorDot');
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    dot.classList.add('show');
    setTimeout(() => dot.classList.remove('show'), 500);
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    screenVideo.srcObject = null;
    screenVideo.style.display = 'none';
    placeholder.style.display = 'flex';
    isSharing = false;
    shareBtn.textContent = '🖥️ Share Screen';
    shareBtn.classList.remove('active');
    stopBtn.style.display = 'none';
    statusText.innerHTML = '<span class="disconnected">● Not sharing</span>';
}

// --- Generate QR ---
function generateQR() {
    const url = window.location.origin + '?room=' + roomId;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=300x300`;
    qrImage.src = qrUrl;
    roomIdDisplay.textContent = '📡 Room ID: ' + roomId;
    qrSection.classList.add('show');
    roomInfo.textContent = '📡 Room: ' + roomId;
}

// --- Update UI ---
function updateUI(role) {
    if (role === 'host') {
        statusBadge.textContent = '● Host';
        statusBadge.className = 'status-badge active';
        statusText.innerHTML = '<span class="connected">● Ready to share</span>';
    } else if (role === 'phone') {
        statusBadge.textContent = '● Viewer';
        statusBadge.className = 'status-badge active';
        statusText.innerHTML = '<span class="connected">● Connected to laptop</span>';
        document.querySelector('.controls').style.display = 'none';
        document.querySelector('.qr-section').style.display = 'none';
    }
}

function updateDeviceCount() {
    const count = connections.length;
    deviceCount.textContent = count + ' device' + (count !== 1 ? 's' : '') + ' connected';
}

// --- Event Listeners ---
shareBtn.addEventListener('click', startScreenShare);

stopBtn.addEventListener('click', stopScreenShare);

controlBtn.addEventListener('click', () => {
    isControlEnabled = !isControlEnabled;
    controlBtn.classList.toggle('active');
    controlBtn.textContent = isControlEnabled ? '✅ Control Enabled' : '👆 Enable Phone Control';
    if (isControlEnabled) {
        remoteOverlay.classList.add('active');
        remoteOverlay.querySelector('.tap-hint').textContent = '👆 Tap anywhere to control laptop';
    } else {
        remoteOverlay.classList.remove('active');
    }
});

// --- Phone Tap to Control ---
if (isPhone) {
    document.getElementById('remoteOverlay').addEventListener('click', (e) => {
        if (!isControlEnabled) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        // Send tap to laptop
        connections.forEach(conn => {
            if(conn.open) {
                conn.send({
                    type: 'tap',
                    x: x,
                    y: y
                });
            }
        });

        // Show tap feedback locally on phone
        const dot = document.getElementById('cursorDot');
        dot.style.left = x + '%';
        dot.style.top = y + '%';
        dot.classList.add('show');
        setTimeout(() => dot.classList.remove('show'), 300);
    });

    // Auto-enable control on phone
    setTimeout(() => {
        controlBtn.click();
    }, 1000);
}

// --- Start ---
initPeer();

// --- Console Help ---
console.log('📺 Screen Share + Control Engine');
console.log('📡 Room ID:', roomId);
console.log('📱 Phone mode:', isPhone);
console.log('💡 Share screen to let phone see and control your laptop');

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
    if (e.key === 's' && !isSharing) shareBtn.click();
    if (e.key === 's' && isSharing) stopBtn.click();
    if (e.key === 'c') controlBtn.click();
});
