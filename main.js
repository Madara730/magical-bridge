import './style.css';
import Peer from 'peerjs';
import QRCode from 'qrcode';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const goBtn = document.getElementById('goBtn');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const displayFrame = document.getElementById('displayFrame');
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
  // Remove if exists to push to top
  history = history.filter(u => u !== url);
  history.unshift(url);
  if (history.length > 20) history.pop(); // Keep last 20
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

// Render Lists
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
  
  // Update bookmark button status based on current input
  if (bookmarks.includes(urlInput.value)) {
    bookmarkBtn.style.color = '#fbbf24'; // yellow
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
      
      // Send FULL state to new connection
      conn.on('open', () => {
        conn.send({ 
          type: 'full_sync', 
          url: urlInput.value,
          history: history,
          bookmarks: bookmarks
        });
      });
    }
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
      loadUrl(data.url, false); // false = don't broadcast back
    } 
    else if (data.type === 'full_sync') {
      // Host sent us the authoritative state
      history = data.history;
      bookmarks = data.bookmarks;
      saveState();
      loadUrl(data.url, false);
    }
    else if (data.type === 'state_update') {
      // Someone updated history/bookmarks
      history = data.history;
      bookmarks = data.bookmarks;
      saveState();
    }
    
    // If we are host, broadcast any received changes to ALL other guests
    if (isHost && data.type !== 'full_sync') {
      connections.forEach(c => {
        if (c.peer !== conn.peer && c.open) {
          c.send(data);
        }
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
    alert("⚠️ WARNING: You pasted a 'localhost' URL!\n\nYour phone cannot load this. Please use a tunnel URL instead.");
  }
  
  // Format URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  urlInput.value = url;
  displayFrame.src = url;
  addToHistory(url);
  renderBookmarks(); // Update bookmark icon color
  
  if (shouldBroadcast) {
    broadcastURL(url);
    broadcastState(); // sync history changes
  }
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
      color: { dark: '#0f172a', light: '#ffffff' }
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
  loadUrl(urlInput.value, true);
});

urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loadUrl(urlInput.value, true);
  }
});

bookmarkBtn.addEventListener('click', () => {
  const url = urlInput.value;
  if (!url) return;
  toggleBookmark(url);
  broadcastState();
});

urlInput.addEventListener('input', () => {
  // Just update the bookmark star visually if typing matching URL
  if (bookmarks.includes(urlInput.value)) {
    bookmarkBtn.style.color = '#fbbf24';
  } else {
    bookmarkBtn.style.color = 'white';
  }
});

// Initialize app
initPeer();
