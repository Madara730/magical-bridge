import './style.css';
import Peer from 'peerjs';
import QRCode from 'qrcode';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const goBtn = document.getElementById('goBtn');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const displayFrame = document.getElementById('displayFrame');
const remoteVideo = document.getElementById('remoteVideo');
const remoteControlOverlay = document.getElementById('remoteControlOverlay');
const clickContainer = document.getElementById('clickContainer');

const statusText = document.getElementById('statusText');
const statusIndicator = document.querySelector('.status-indicator');
const qrcodeContainer = document.getElementById('qrcode');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const historyList = document.getElementById('historyList');
const bookmarksList = document.getElementById('bookmarksList');

// State
let peer = null;
let connections = []; 
let isHost = false;
let hostId = null;
let localStream = null;

let history = JSON.parse(localStorage.getItem('bridge_history')) || [];
let bookmarks = JSON.parse(localStorage.getItem('bridge_bookmarks')) || [];

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
const connectTo = urlParams.get('room');

// Initialize State UI
renderHistory();
renderBookmarks();

function saveState() {
  localStorage.setItem('bridge_history', JSON.stringify(history));
  localStorage.setItem('bridge_bookmarks', JSON.stringify(bookmarks));
  renderHistory();
  renderBookmarks();
}

function addToHistory(url) {
  if (!url) return;
  history = history.filter(u => u !== url);
  history.unshift(url);
  if (history.length > 20) history.pop();
  saveState();
}

function toggleBookmark(url) {
  if (!url) return;
  if (bookmarks.includes(url)) {
    bookmarks = bookmarks.filter(u => u !== url);
  } else {
    bookmarks.push(url);
  }
  saveState();
}

function renderHistory() {
  historyList.innerHTML = '';
  history.forEach(url => {
    const li = document.createElement('li');
    li.textContent = url;
    li.onclick = () => loadUrl(url, true);
    historyList.appendChild(li);
  });
}

function renderBookmarks() {
  bookmarksList.innerHTML = '';
  bookmarks.forEach(url => {
    const li = document.createElement('li');
    
    const textSpan = document.createElement('span');
    textSpan.textContent = url;
    textSpan.style.flex = "1";
    textSpan.style.overflow = "hidden";
    textSpan.style.textOverflow = "ellipsis";
    textSpan.onclick = () => loadUrl(url, true);
    
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✖';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      toggleBookmark(url);
      broadcastState();
    };
    
    li.appendChild(textSpan);
    li.appendChild(delBtn);
    bookmarksList.appendChild(li);
  });
  
  if (bookmarks.includes(urlInput.value)) {
    bookmarkBtn.style.color = '#fbbf24';
  } else {
    bookmarkBtn.style.color = 'white';
  }
}

// PeerJS Logic
function initPeer() {
  peer = new Peer();

  peer.on('open', (id) => {
    console.log('My peer ID is: ' + id);
    if (connectTo) {
      isHost = false;
      hostId = connectTo;
      connectToHost(connectTo);
    } else {
      isHost = true;
      hostId = id;
      generateSyncQR(id);
      updateStatus(`Waiting... (Room: ${id.substring(0,4)})`, 'connected');
      
      const lastUrl = history[0];
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
      
      conn.on('open', () => {
        conn.send({ 
          type: 'full_sync', 
          url: urlInput.value,
          history: history,
          bookmarks: bookmarks
        });
        
        // If sharing screen, send the video stream to the newly connected phone immediately
        if (localStream) {
          peer.call(conn.peer, localStream);
        }
      });
    }
  });
  
  // Answer incoming video calls (runs on phone)
  peer.on('call', (call) => {
    call.answer(); // Automatically answer
    
    call.on('stream', (remoteStream) => {
      displayFrame.style.display = 'none';
      remoteVideo.style.display = 'block';
      remoteControlOverlay.style.display = 'block';
      remoteVideo.srcObject = remoteStream;
      updateStatus('Receiving Live Screen', 'connected');
    });
  });

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    updateStatus('Connection error', 'error');
  });
}

function connectToHost(hostId) {
  updateStatus('Connecting...', '');
  const conn = peer.connect(hostId);
  
  conn.on('open', () => {
    setupConnection(conn);
    connections = [conn];
    updateStatus('Connected to host', 'connected');
  });
}

function setupConnection(conn) {
  conn.on('data', (data) => {
    if (data.type === 'url_update') {
      loadUrl(data.url, false);
    } 
    else if (data.type === 'full_sync') {
      history = data.history;
      bookmarks = data.bookmarks;
      saveState();
      loadUrl(data.url, false);
    }
    else if (data.type === 'state_update') {
      history = data.history;
      bookmarks = data.bookmarks;
      saveState();
    }
    else if (data.type === 'remote_tap' && isHost) {
      simulateRemoteClick(data.x, data.y);
    }
    
    if (isHost && data.type !== 'full_sync' && data.type !== 'remote_tap') {
      connections.forEach(c => {
        if (c.peer !== conn.peer && c.open) c.send(data);
      });
    }
  });

  conn.on('close', () => {
    connections = connections.filter(c => c.peer !== conn.peer);
    if (isHost) {
      updateStatus(`Connected to ${connections.length} device(s)`, 'connected');
    } else {
      updateStatus('Disconnected', 'error');
    }
  });
}

// Remote Click Handling
function simulateRemoteClick(xPercent, yPercent) {
  // Translate percentage back to exact pixel coordinates
  const targetX = window.innerWidth * xPercent;
  const targetY = window.innerHeight * yPercent;
  
  // 1. Visual Feedback: Render a pink ripple where the phone tapped
  const ripple = document.createElement('div');
  ripple.className = 'remote-click-ripple';
  ripple.style.left = `${targetX}px`;
  ripple.style.top = `${targetY}px`;
  clickContainer.appendChild(ripple);
  
  setTimeout(() => ripple.remove(), 500);
  
  // 2. DOM Click: Attempt to click the element natively
  // Note: This only works if the shared screen is EXACTLY the browser tab boundaries
  const element = document.elementFromPoint(targetX, targetY);
  if (element) {
    if (element.tagName === 'IFRAME') {
      console.warn("Browser security prevents clicking inside cross-origin iframes.");
    } else {
      element.click();
      if(element.focus) element.focus();
    }
  }
}

// Screen Sharing
screenShareBtn.addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });
    
    // Send stream to all existing connected phones
    connections.forEach(conn => {
      if (conn.open) peer.call(conn.peer, localStream);
    });
    
    screenShareBtn.textContent = '🟢 Sharing Screen Live';
    screenShareBtn.style.background = '#10b981';
    
    localStream.getVideoTracks()[0].onended = () => {
      localStream = null;
      screenShareBtn.textContent = '🖥️ Share Screen to Phone';
      screenShareBtn.style.background = '#8b5cf6';
    };
  } catch (err) {
    console.error("Screen share error: ", err);
    alert("Screen share cancelled or failed.");
  }
});

// Capture tap on phone video
remoteVideo.addEventListener('click', (e) => {
  const rect = remoteVideo.getBoundingClientRect();
  const videoRatio = remoteVideo.videoWidth / remoteVideo.videoHeight;
  const elementRatio = rect.width / rect.height;
  
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  
  // Handle object-fit: contain math to map exactly to the video pixels
  if (videoRatio > elementRatio) {
    drawHeight = rect.width / videoRatio;
    offsetY = (rect.height - drawHeight) / 2;
  } else {
    drawWidth = rect.height * videoRatio;
    offsetX = (rect.width - drawWidth) / 2;
  }
  
  const clickX = e.clientX - rect.left - offsetX;
  const clickY = e.clientY - rect.top - offsetY;
  
  if (clickX < 0 || clickX > drawWidth || clickY < 0 || clickY > drawHeight) {
    return; // Ignore clicks on the black letterboxing
  }
  
  const xPercent = clickX / drawWidth;
  const yPercent = clickY / drawHeight;
  
  if (connections.length > 0 && connections[0].open) {
    connections[0].send({ type: 'remote_tap', x: xPercent, y: yPercent });
    
    // Add local visual ripple on phone
    const ripple = document.createElement('div');
    ripple.className = 'remote-click-ripple';
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }
});

// Core Functions
function broadcastURL(url) {
  const msg = { type: 'url_update', url };
  connections.forEach(conn => {
    if (conn.open) conn.send(msg);
  });
}

function broadcastState() {
  const msg = { type: 'state_update', history, bookmarks };
  connections.forEach(conn => {
    if (conn.open) conn.send(msg);
  });
}

function loadUrl(url, shouldBroadcast = true) {
  if (!url) return;
  
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    alert("⚠️ WARNING: You pasted a 'localhost' URL!\n\nYour phone cannot load this via URL. Use the 'Share Screen' button instead!");
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  urlInput.value = url;
  displayFrame.style.display = 'block';
  remoteVideo.style.display = 'none';
  remoteControlOverlay.style.display = 'none';
  displayFrame.src = url;
  
  addToHistory(url);
  renderBookmarks();
  
  if (shouldBroadcast) {
    broadcastURL(url);
    broadcastState();
  }
}

function updateIframe(url) {
  displayFrame.style.display = 'block';
  remoteVideo.style.display = 'none';
  remoteControlOverlay.style.display = 'none';
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
      width: 150, margin: 1, color: { dark: '#0f172a', light: '#ffffff' }
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

// UI Event Listeners
goBtn.addEventListener('click', () => loadUrl(urlInput.value, true));
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') loadUrl(urlInput.value, true);
});
bookmarkBtn.addEventListener('click', () => {
  if (!urlInput.value) return;
  toggleBookmark(urlInput.value);
  broadcastState();
});
urlInput.addEventListener('input', () => {
  bookmarkBtn.style.color = bookmarks.includes(urlInput.value) ? '#fbbf24' : 'white';
});

// Initialize app
initPeer();
