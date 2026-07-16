import './style.css';
import Peer from 'peerjs';
import QRCode from 'qrcode';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const goBtn = document.getElementById('goBtn');
const displayFrame = document.getElementById('displayFrame');
const statusText = document.getElementById('statusText');
const statusIndicator = document.querySelector('.status-indicator');
const qrcodeContainer = document.getElementById('qrcode');
const copyLinkBtn = document.getElementById('copyLinkBtn');

let peer = null;
let connections = []; // Can be multiple if host
let isHost = false;
let hostId = null;

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
const connectTo = urlParams.get('room');

// Initialize PeerJS
function initPeer() {
  peer = new Peer();

  peer.on('open', (id) => {
    console.log('My peer ID is: ' + id);
    
    if (connectTo) {
      // We are a guest connecting to a host
      isHost = false;
      hostId = connectTo;
      connectToHost(connectTo);
    } else {
      // We are the host
      isHost = true;
      hostId = id;
      generateSyncQR(id);
      updateStatus(`Waiting for devices... (ID: ${id.substring(0,4)}...)`, 'connected');
      
      // Load last URL if available
      const lastUrl = localStorage.getItem('lastUrl');
      if (lastUrl) {
        urlInput.value = lastUrl;
        updateIframe(lastUrl);
      }
    }
  });

  peer.on('connection', (conn) => {
    if (isHost) {
      setupConnection(conn);
      connections.push(conn);
      updateStatus(`Connected to ${connections.length} device(s)`, 'connected');
      
      // Send current URL to new connection
      conn.on('open', () => {
        if (urlInput.value) {
          conn.send({ type: 'url_update', url: urlInput.value });
        }
      });
    }
  });

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    updateStatus('Connection error', 'error');
  });
}

function connectToHost(hostId) {
  updateStatus('Connecting to host...', '');
  const conn = peer.connect(hostId);
  
  conn.on('open', () => {
    setupConnection(conn);
    connections = [conn];
    updateStatus('Connected to host', 'connected');
    
    // We don't send URL automatically, we just wait for host to sync
  });
}

function setupConnection(conn) {
  conn.on('data', (data) => {
    console.log('Received:', data);
    if (data.type === 'url_update') {
      urlInput.value = data.url;
      updateIframe(data.url);
      
      // If we are host, broadcast to other connections
      if (isHost) {
        localStorage.setItem('lastUrl', data.url);
        broadcastURL(data.url, conn.peer); // Send to all except sender
      }
    }
  });

  conn.on('close', () => {
    connections = connections.filter(c => c.peer !== conn.peer);
    if (isHost) {
      updateStatus(`Connected to ${connections.length} device(s)`, 'connected');
    } else {
      updateStatus('Disconnected from host', 'error');
    }
  });
}

function broadcastURL(url, excludePeerId = null) {
  connections.forEach(conn => {
    if (conn.peer !== excludePeerId && conn.open) {
      conn.send({ type: 'url_update', url });
    }
  });
}

function updateIframe(url) {
  // Ensure protocol is present
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }
  displayFrame.src = url || 'about:blank';
}

function updateStatus(text, stateClass) {
  statusText.textContent = text;
  statusIndicator.className = `status-indicator ${stateClass}`;
}

async function generateSyncQR(id) {
  const syncUrl = new URL(window.location.href);
  syncUrl.searchParams.set('room', id);
  
  try {
    await QRCode.toCanvas(syncUrl.toString(), {
      width: 150,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }, function (err, canvas) {
      if (err) throw err;
      qrcodeContainer.innerHTML = '';
      qrcodeContainer.appendChild(canvas);
    });
    
    copyLinkBtn.onclick = () => {
      navigator.clipboard.writeText(syncUrl.toString());
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => copyLinkBtn.textContent = 'Copy Sync Link', 2000);
    };
  } catch (err) {
    console.error('QR Generate error', err);
  }
}

// Event Listeners
goBtn.addEventListener('click', () => {
  const url = urlInput.value;
  if (!url) return;
  
  updateIframe(url);
  broadcastURL(url);
  
  if (isHost) {
    localStorage.setItem('lastUrl', url);
  } else {
    // Guest updates the host
    if (connections.length > 0 && connections[0].open) {
      connections[0].send({ type: 'url_update', url });
    }
  }
});

urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    goBtn.click();
  }
});

// Initialize app
initPeer();
