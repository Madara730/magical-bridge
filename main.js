import './style.css';
import Peer from 'peerjs';

// ============================================================
// 🚀 SCREEN SHARE + REMOTE CONTROL - FIXED VERSION
// ============================================================

// --- DOM Elements ---
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
let phoneCalls = [];

// --- Detect device ---
if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    isPhone = true;
    document.querySelector('.header h1').textContent = '📱 Viewer + Controller';
}

// --- Initialize Peer ---
async function initPeer() {
    try {
        const params = new URLSearchParams(window.location.search);
        const existingRoom = params.get('room');

        if (existingRoom) {
            roomId = existingRoom;
            await connectToRoom(roomId);
        } else {
            roomId = 'screen-' + Math.random().toString(36).substring(2, 10);
            await createRoom(roomId);
        }
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
            console.log('📱 Phone connected via data channel');
            connections.push(conn);
            setupDataConnection(conn);
            updateDeviceCount();
        });

        peer.on('call', (call) => {
            console.log('📞 Phone calling for video stream');
            phoneCalls.push(call);
            
            // If we're sharing, answer the call with the stream
            if (isSharing && screenStream) {
                call.answer(screenStream);
                console.log('✅ Answered call with screen stream');
            } else {
                // Store call for later
                console.log('⏳ No stream yet, will answer when sharing starts');
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
            
            // Create data connection first
            const conn = peer.connect(id);
            conn.on('open', () => {
                connections.push(conn);
                setupDataConnection(conn);
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

// --- Setup Data Connection ---
function setupDataConnection(conn) {
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
        if (isControlEnabled && !isPhone) {
            simulateClick(data.x, data.y);
        }
    }

    if (data.type === 'request-stream') {
        // Phone is requesting the screen stream
        if (isSharing && screenStream) {
            console.log('📤 Sending stream to phone');
            // Call the phone's peer ID directly
            const call = peer.call(conn.peer, screenStream);
            call.on('stream', (remoteStream) => {
                console.log('✅ Stream sent successfully');
            });
            call.on('error', (err) => {
                console.error('❌ Call error:', err);
            });
        }
    }

    if (data.type === 'cursor-position') {
        if (isPhone) {
            cursorDot.style.left = data.x + '%';
            cursorDot.style.top = data.y + '%';
            cursorDot.classList.add('show');
        }
    }
}

// --- Screen Sharing ---
async function startScreenShare() {
    try {
        console.log('🎥 Starting screen capture...');
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'monitor',
                cursor: 'always',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });

        console.log('✅ Screen captured');

        // Show video on laptop
        screenVideo.srcObject = screenStream;
        screenVideo.style.display = 'block';
        placeholder.style.display = 'none';

        isSharing = true;
        shareBtn.textContent = '🟢 Sharing...';
        shareBtn.classList.add('active');
        stopBtn.style.display = 'inline-block';
        statusText.innerHTML = '<span class="connected">● Screen sharing active</span>';

        // Send stream to all connected phones
        connections.forEach(conn => {
            console.log('📤 Sending stream to:', conn.peer);
            try {
                const call = peer.call(conn.peer, screenStream);
                call.on('stream', (remoteStream) => {
                    console.log('✅ Stream received by phone');
                });
                call.on('error', (err) => {
                    console.error('❌ Call error:', err);
                });
            } catch (err) {
                console.error('❌ Failed to call peer:', err);
            }
        });

        // Handle stop
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        // Also handle any pending calls
        phoneCalls.forEach(call => {
            try {
                call.answer(screenStream);
                console.log('✅ Answered pending call');
            } catch (err) {
                console.error('❌ Failed to answer pending call:', err);
            }
        });
        phoneCalls = [];

    } catch (error) {
        console.error('❌ Screen share error:', error);
        alert('Failed to share screen. Please grant permission.');
    }
}

// --- Stop Screen Sharing ---
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
    console.log('⏹️ Screen sharing stopped');
}

// --- Simulate Click ---
function simulateClick(x, y) {
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    
    // Calculate actual pixel position
    const clickX = rect.left + (x / 100) * rect.width;
    const clickY = rect.top + (y / 100) * rect.height;

    console.log(`🖱️ Simulating click at (${clickX}, ${clickY})`);

    // Create click event
    const clickEvent = new MouseEvent('click', {
        clientX: clickX,
        clientY: clickY,
        bubbles: true,
        cancelable: true
    });

    // Send cursor position to phone
    connections.forEach(conn => {
        conn.send({
            type: 'cursor-position',
            x: x,
            y: y
        });
    });

    // Simulate click
    const target = document.elementFromPoint(clickX, clickY);
    if (target) {
        target.dispatchEvent(clickEvent);
        console.log('✅ Click simulated on:', target.tagName);
    }

    // Show feedback
    const dot = document.getElementById('cursorDot');
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    dot.classList.add('show');
    setTimeout(() => dot.classList.remove('show'), 500);
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
        // Auto-send control status to phone
        connections.forEach(conn => {
            conn.send({ type: 'control-enabled', enabled: true });
        });
    } else {
        remoteOverlay.classList.remove('active');
        connections.forEach(conn => {
            conn.send({ type: 'control-enabled', enabled: false });
        });
    }
});

// --- Phone: Tap to Control ---
if (isPhone) {
    document.getElementById('viewer').addEventListener('click', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        connections.forEach(conn => {
            conn.send({
                type: 'tap',
                x: x,
                y: y
            });
        });

        const dot = document.getElementById('cursorDot');
        dot.style.left = x + '%';
        dot.style.top = y + '%';
        dot.classList.add('show');
        setTimeout(() => dot.classList.remove('show'), 300);
    });

    // Listen for incoming video call
    // FIX: Must define peer first, but this block is inside if(isPhone), so wait for initPeer
    // The correct place for peer.on('call') is inside connectToRoom or initPeer, but this is 
    // fine if we ensure it runs after peer is initialized.
    
    // In their code, they attached peer.on('call') dynamically, but peer is null here when script starts!
}

// --- Start ---
initPeer().then(() => {
    if (isPhone && peer) {
        peer.on('call', (call) => {
            console.log('📞 Receiving screen stream...');
            call.answer(); // Answer without stream
            call.on('stream', (stream) => {
                console.log('✅ Receiving screen stream');
                screenVideo.srcObject = stream;
                screenVideo.style.display = 'block';
                placeholder.style.display = 'none';
                remoteOverlay.classList.add('active');
                statusText.innerHTML = '<span class="connected">● Receiving screen</span>';
            });
            call.on('error', (err) => {
                console.error('❌ Call error:', err);
            });
        });
    }
});

// --- Console Help ---
console.log('📺 Screen Share + Control Engine (FIXED)');
console.log('📡 Room ID:', roomId);
console.log('📱 Phone mode:', isPhone);
console.log('💡 Share screen to let phone see and control your laptop');
console.log("🔧 If screen doesn't appear, check:");
console.log('  1. Both devices on same network?');
console.log('  2. Firewall allowing WebRTC?');
console.log('  3. Try using Chrome browser');
