const { ipcRenderer } = require('electron');

// --- CUSTOM ALERT & CONFIRM MODALS (PROMISE TABANLI ASENKRON SİSTEM) ---
function appAlert(msg, icon = 'info') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-alert-modal');
        document.getElementById('custom-alert-text').innerText = msg;
        document.getElementById('custom-alert-icon').innerText = icon;
        if(icon === 'error' || icon === 'warning') document.getElementById('custom-alert-icon').style.color = 'var(--danger)';
        else document.getElementById('custom-alert-icon').style.color = 'var(--accent)';
        
        overlay.classList.add('active');
        
        document.getElementById('btn-custom-alert-ok').onclick = () => {
            overlay.classList.remove('active');
            ipcRenderer.send('fix-bug'); // Kapanınca ekranı refreshle (Bug fix)
            resolve();
        };
    });
}

function appConfirm(msg) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-confirm-modal');
        document.getElementById('custom-confirm-text').innerText = msg;
        overlay.classList.add('active');
        
        document.getElementById('btn-custom-confirm-yes').onclick = () => {
            overlay.classList.remove('active');
            ipcRenderer.send('fix-bug');
            resolve(true);
        };
        document.getElementById('btn-custom-confirm-no').onclick = () => {
            overlay.classList.remove('active');
            ipcRenderer.send('fix-bug');
            resolve(false);
        };
    });
}

// --- WINDOW CONTROLS ---
document.getElementById('min-btn').onclick = () => ipcRenderer.send('minimize-window');
document.getElementById('close-btn').onclick = () => ipcRenderer.send('close-window');

document.getElementById('reload-btn').onclick = () => {
    if(peer) peer.destroy();
    window.location.reload();
};
window.addEventListener('beforeunload', () => {
    if(peer) peer.destroy();
});

function toggleAppFullscreen() {
    ipcRenderer.send('toggle-maximize');
    const btn = document.getElementById("fs-app-btn");
    if (btn.innerHTML.includes("fullscreen_exit")) {
        btn.innerHTML = '<span class="material-symbols-rounded">fullscreen</span>';
    } else {
        btn.innerHTML = '<span class="material-symbols-rounded">fullscreen_exit</span>';
    }
}

// --- LAYOUT LOGIC ---
let leftCollapsed = false; 
let rightCollapsed = false;

function toggleLeftPanel() {
    leftCollapsed = !leftCollapsed; 
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('btn-toggle-left').innerHTML = leftCollapsed ? 
        '<span class="material-symbols-rounded">keyboard_double_arrow_right</span>' : 
        '<span class="material-symbols-rounded">keyboard_double_arrow_left</span>';
}

function toggleRightPanel() {
    rightCollapsed = !rightCollapsed; 
    document.getElementById('right-panel').classList.toggle('collapsed');
    document.getElementById('btn-toggle-right').innerHTML = rightCollapsed ? 
        '<span class="material-symbols-rounded">keyboard_double_arrow_left</span>' : 
        '<span class="material-symbols-rounded">keyboard_double_arrow_right</span>';
}

async function leaveServer(force = false) { 
    if(force || await appConfirm("Protocol Termination: Are you sure you want to disconnect?")) { 
        if(peer) peer.destroy(); 
        sessionStorage.setItem('trigger_fix', 'true');
        
        const dz = document.getElementById('dynamic-drag');
        if(dz) dz.style.webkitAppRegion = 'no-drag';
        
        setTimeout(() => {
            window.location.replace('index.html'); 
        }, 100);
    } 
}

// --- RECENT SERVERS LOGIC ---
function saveToRecentServers(pass) {
    let recents = JSON.parse(localStorage.getItem('tp_recent_servers') || '[]');
    let token = btoa('cloud-node:::' + pass);
    recents = recents.filter(r => r.token !== token);
    let preview = pass.length > 3 ? pass.substring(0,3) + '***' : pass;
    recents.unshift({ token: token, passPreview: preview, time: Date.now() });
    if (recents.length > 5) recents.pop();
    localStorage.setItem('tp_recent_servers', JSON.stringify(recents));
}

// --- GLOBAL STATE ---
let ROOMS = {
    "General 1": { name: "General 1", isSecret: false, password: "", capacity: 0, isPermanent: true },
    "AFK Zone": { name: "AFK Zone", isSecret: false, password: "", capacity: 0, isPermanent: true }
};
let ROOM_ORDER = ["General 1", "AFK Zone"]; 

let myInfo = { 
    id: "", name: "", room: "General 1", isHost: false, 
    micMuted: false, deafened: false, isSpeaking: false, isScreenSharing: false,
    acceptsDMs: true, 
    permissions: {
        kick: false, ban: false, createRoom: false, deleteRoom: false, 
        renameRoom: false, reorderRooms: false, createSecretRoom: false, 
        bypassLimits: false, pullUsers: false
    }
};

let serverPassword = ""; 
let targetHostId = ""; 
let lastHostInteraction = Date.now();

let globalChatHistory = {}; 
let globalMusicState = {}; 
let privateMessages = {}; 
let activeDmPeer = null;  
let unreadDmCount = 0;    
let isDmViewOpen = false; 
let isNoiseGateOn = false; 

let isPTTEnabled = false;
let pttKey = '';
let muteKey = '';
let deafenKey = '';
let isPttKeyPressed = false;
let bannedUsers = new Set(); 
let myStreamViewers = new Set(); 

let userAudioCtx = null;
let userGains = {};
let userVolumes = {}; 

window.setUserVolume = function(id, val, e) {
    if(e) { e.stopPropagation(); e.preventDefault(); }
    let numVal = parseFloat(val) / 100;
    userVolumes[id] = numVal;
    if (userGains[id]) { userGains[id].gain.value = myInfo.deafened ? 0 : numVal; }
};

function initRoomsState() {
    ROOM_ORDER.forEach(r => { 
        if(!globalChatHistory[r]) globalChatHistory[r] = []; 
        if(!globalMusicState[r]) globalMusicState[r] = { 
            isPlaying: false, isPaused: false, pauseTime: 0, 
            currentVideo: null, queue: [], startTime: 0, mode: 'audio' 
        }; 
    });
}
initRoomsState();

let peer; 
let localStream; 
let myScreenStream = null;
let connectedPeers = {}; 
let mediaCalls = {}; 
let screenShareCalls = {}; 

let audioContext; 
let gateNode;
let ytPlayerObj; 
let isPlaying = false; 

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    setTimeout(() => {
        const dz = document.getElementById('dynamic-drag');
        if(dz) dz.style.webkitAppRegion = 'drag';
    }, 800);

    // AI VOICE GATE TOOLTIP ARTIK HER GİRİŞTE ÇIKAR!
    document.getElementById('noise-gate-tooltip').style.display = 'block';

    document.getElementById("chat-input").addEventListener("keypress", function(e) { if (e.key === "Enter") sendChatReq(); });
    document.getElementById("dm-input-field").addEventListener("keypress", function(e) { if (e.key === "Enter") sendDm(); });
    document.querySelectorAll('input').forEach(i => { i.addEventListener('mousedown', () => i.focus()); });
    
    setupKeybindListeners();

    const tp_name = sessionStorage.getItem('tp_name');
    const tp_pass = sessionStorage.getItem('tp_pass');
    const tp_mode = sessionStorage.getItem('tp_mode');

    if(!tp_name || !tp_mode || !tp_pass) { 
        const dz = document.getElementById('dynamic-drag');
        if(dz) dz.style.webkitAppRegion = 'no-drag';
        setTimeout(() => window.location.replace('index.html'), 50);
        return; 
    }

    myInfo.name = tp_name; 
    serverPassword = tp_pass;
    
    let rawEncoded = btoa(serverPassword).replace(/=/g, '');
    targetHostId = "thisport-global-net-" + rawEncoded;

    if (tp_mode === 'host') {
        myInfo.isHost = true; 
        document.getElementById('btn-create-room').style.display = 'block';
        document.getElementById('btn-host-dash').style.display = 'flex';
    } else {
        myInfo.isHost = false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        setupAudioProcessing(stream); 
        initPeerJS(); 
        generateInviteLink();
    } catch (err) { 
        await appAlert("Hardware Error: Microphone access is required for the protocol.", "error"); 
        const dz = document.getElementById('dynamic-drag');
        if(dz) dz.style.webkitAppRegion = 'no-drag';
        setTimeout(() => window.location.replace('index.html'), 50); 
    }
});

function closeNoiseGateTooltip() {
    document.getElementById('noise-gate-tooltip').style.display = 'none';
}

// --- SETTINGS & KEYBINDS LOGIC ---
function setupKeybindListeners() {
    const inputs = {
        'ptt-key-input': (key) => { pttKey = key; document.getElementById('ptt-key-input').value = key; },
        'mute-key-input': (key) => { muteKey = key; document.getElementById('mute-key-input').value = key; },
        'deafen-key-input': (key) => { deafenKey = key; document.getElementById('deafen-key-input').value = key; }
    };

    Object.keys(inputs).forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation(); 
            let key = e.key === ' ' ? 'Space' : e.key;
            inputs[id](key);
            el.blur();
        });
    });

    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        let key = e.key === ' ' ? 'Space' : e.key;
        if (!key) return;

        if (isPTTEnabled && pttKey && key.toLowerCase() === pttKey.toLowerCase() && !isPttKeyPressed) {
            isPttKeyPressed = true;
        } 
        else if (!isPTTEnabled && muteKey && key.toLowerCase() === muteKey.toLowerCase()) {
            toggleMic();
        } 
        else if (deafenKey && key.toLowerCase() === deafenKey.toLowerCase()) {
            toggleDeafen();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        let key = e.key === ' ' ? 'Space' : e.key;
        if (!key) return;

        if (isPTTEnabled && pttKey && key.toLowerCase() === pttKey.toLowerCase()) {
            isPttKeyPressed = false;
        }
    });
}

function toggleDMStatus(val) { myInfo.acceptsDMs = val; sendStatusUpdate(); }
function togglePTTMode(val) {
    isPTTEnabled = val;
    const micBtn = document.getElementById("btn-mic");
    if(isPTTEnabled) {
        myInfo.micMuted = false; 
        micBtn.classList.remove("active-red");
        micBtn.innerHTML = '<span class="material-symbols-rounded">mic</span>';
        micBtn.style.opacity = "0.3";
        micBtn.style.pointerEvents = "none";
        sendStatusUpdate();
    } else {
        micBtn.style.opacity = "1";
        micBtn.style.pointerEvents = "auto";
        myInfo.micMuted = false;
        micBtn.classList.remove("active-red");
        micBtn.innerHTML = '<span class="material-symbols-rounded">mic</span>';
        sendStatusUpdate();
    }
}

// --- PEERJS INIT ---
function initPeerJS() {
    peer = new Peer(myInfo.isHost ? targetHostId : undefined, {
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('open', (id) => {
        myInfo.id = id;
        document.getElementById("server-title").innerText = myInfo.isHost ? `GLOBAL NODE: ACTIVE` : "CONNECTED TO CLOUD";

        if (!myInfo.isHost) {
            const conn = peer.connect(targetHostId, { metadata: { name: myInfo.name, password: serverPassword }, reliable: true });
            conn.on('open', () => {
                connectedPeers[targetHostId] = { conn: conn, isServer: true };
                conn.send({ type: 'update-state', peerId: myInfo.id, data: myInfo });
                saveToRecentServers(serverPassword);
                
                lastHostInteraction = Date.now();
                
                setInterval(() => { 
                    if(conn.open) conn.send({type:'ping', peerId: myInfo.id}); 
                }, 3000);
                
                setInterval(() => {
                    if (Date.now() - lastHostInteraction > 15000) {
                        appAlert("Connection Lost: The host stopped responding or your network dropped.", "error").then(() => leaveServer(true));
                    }
                }, 5000);
            });
            conn.on('data', handleNetworkData);
            conn.on('close', () => { 
                appAlert("Signal Lost: Global connection closed by Host.", "error").then(() => leaveServer(true));
            });
        } else { 
            myInfo.room = "General 1"; renderRooms(); loadChatHistory(globalChatHistory["General 1"]); 
        }
    });

    peer.on('error', async (err) => { 
        if (err.type === 'unavailable-id') { 
            await appAlert("Connection Failed: The room is already hosted globally. Or if you are trying to Host, this password is taken by someone else.", "error"); 
        } else {
            await appAlert("Cloud Error: Cannot reach the global node. The Host might be offline.", "error"); 
        }
        leaveServer(true);
    });

    if(myInfo.isHost) {
        peer.on('connection', (conn) => {
            if(bannedUsers.has(conn.peer) || bannedUsers.has(conn.metadata?.name)) {
                conn.on('open', () => { conn.send({ type: 'banned-kick' }); setTimeout(()=>conn.close(), 500); });
                return;
            }

            conn.on('close', () => {
                removeUserCompletely(conn.peer);
                broadcastData({ type: 'sync-state', state: getGlobalState() });
                renderRooms();
            });

            conn.on('data', (data) => {
                if (data.type === 'ping') {
                    if(connectedPeers[data.peerId]) connectedPeers[data.peerId].lastPing = Date.now();
                    conn.send({ type: 'pong' });
                    return;
                }

                if (data.type === 'update-state') {
                    if(!connectedPeers[data.peerId]) connectedPeers[data.peerId] = { permissions: { kick:false, ban:false, createRoom:false, deleteRoom:false, renameRoom:false, reorderRooms:false, createSecretRoom:false, bypassLimits:false, pullUsers:false } };
                    
                    let oldRoom = connectedPeers[data.peerId].room; 
                    let newRoom = data.data.room;
                    
                    let currentPerms = connectedPeers[data.peerId].permissions;
                    Object.assign(connectedPeers[data.peerId], data.data, {conn: conn, lastPing: Date.now()});
                    connectedPeers[data.peerId].permissions = currentPerms;

                    if (oldRoom !== newRoom || !oldRoom) {
                        conn.send({ type: 'chat-history', room: newRoom, history: globalChatHistory[newRoom] });
                        if(globalMusicState[newRoom]) { conn.send({ type: 'sync-music', state: globalMusicState[newRoom] }); } 
                    }
                    broadcastData({ type: 'sync-state', state: getGlobalState() }); syncMediaConnections(getGlobalState()); renderRooms();
                }
                else if (data.type === 'chat-req') { processChatRequest(conn.peer, data.text); }
                else if (data.type === 'status-req') { 
                    if(connectedPeers[data.peerId]) { 
                        let currentPerms = connectedPeers[data.peerId].permissions;
                        Object.assign(connectedPeers[data.peerId], data.data); 
                        connectedPeers[data.peerId].permissions = currentPerms;
                        broadcastData({ type: 'sync-state', state: getGlobalState() }); renderRooms(); 
                    } 
                }
                else if (data.type === 'dm-send') {
                    if (data.to === myInfo.id) { receiveDm(data.from, data.fromName, data.text); }
                    else if (connectedPeers[data.to]?.conn && connectedPeers[data.to].acceptsDMs) { 
                        try { connectedPeers[data.to].conn.send(data); } catch(e) {} 
                    }
                } else {
                    processHostDataRequest(conn.peer, data);
                }
            });
        });

        setInterval(() => {
            let changed = false; let now = Date.now();
            for(let id in connectedPeers) {
                if (id !== myInfo.id && !connectedPeers[id].isServer) {
                    if (connectedPeers[id].lastPing && (now - connectedPeers[id].lastPing > 15000)) { 
                        removeUserCompletely(id); changed = true; 
                    }
                }
            }
            if(changed) { broadcastData({ type: 'sync-state', state: getGlobalState() }); syncMediaConnections(getGlobalState()); renderRooms(); }
        }, 5000);
    }

    peer.on('call', (call) => {
        if (call.metadata?.type === 'screenshare') {
            call.answer(); call.on('stream', (s) => addVideoElement(call.peer, s, call.metadata.name, false)); call.on('close', () => removeVideoElement(call.peer)); return;
        }
        call.answer(localStream); mediaCalls[call.peer] = call;
        call.on('stream', (stream) => { playIncomingAudio(stream, call.peer); });
        call.on('close', () => { delete mediaCalls[call.peer]; document.getElementById("audio-" + call.peer)?.remove(); });
    });
}

function sendRoomData(data) {
    data.sender = myInfo.id; 
    if (myInfo.isHost) {
        processHostDataRequest(myInfo.id, data);
    } else {
        connectedPeers[targetHostId]?.conn?.send(data);
    }
}

// --- HOST DASHBOARD & ADMIN ACTIONS ---
function openHostModal() {
    if (!myInfo.isHost && !myInfo.permissions.kick && !myInfo.permissions.ban) return;
    document.getElementById('host-modal').classList.add('active');
    renderHostUserList();
}

function renderHostUserList() {
    const list = document.getElementById('host-user-list');
    list.innerHTML = "";
    Object.keys(connectedPeers).forEach(id => {
        if(id === targetHostId) return;
        const u = connectedPeers[id];
        const row = document.createElement('div');
        row.className = "host-user-row";
        
        const canEditPerms = myInfo.isHost;
        const permsHtml = canEditPerms ? `
            <div class="perm-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px;">
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'kick', this.checked)" ${u.permissions.kick ? 'checked' : ''}> Kick</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'ban', this.checked)" ${u.permissions.ban ? 'checked' : ''}> Ban</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'pullUsers', this.checked)" ${u.permissions.pullUsers ? 'checked' : ''}> Pull Users</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'createRoom', this.checked)" ${u.permissions.createRoom ? 'checked' : ''}> Create Rm</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'deleteRoom', this.checked)" ${u.permissions.deleteRoom ? 'checked' : ''}> Delete Rm</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'renameRoom', this.checked)" ${u.permissions.renameRoom ? 'checked' : ''}> Rename Rm</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'reorderRooms', this.checked)" ${u.permissions.reorderRooms ? 'checked' : ''}> Reorder Rm</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'createSecretRoom', this.checked)" ${u.permissions.createSecretRoom ? 'checked' : ''}> Secret Rm</label>
                <label class="perm-cb-label"><input type="checkbox" onchange="toggleUserPerm('${id}', 'bypassLimits', this.checked)" ${u.permissions.bypassLimits ? 'checked' : ''}> Bypass Lmt</label>
            </div>
        ` : `<div style="flex:4; font-size:12px; color:var(--muted); text-align:center;">Permissions locked by Host</div>`;

        row.innerHTML = `
            <div class="host-user-info">
                <div class="host-user-avatar">${u.name.charAt(0).toUpperCase()}</div>
                <div>${u.name}</div>
            </div>
            ${permsHtml}
            <div class="host-actions">
                ${(myInfo.isHost || myInfo.permissions.kick) ? `<button class="btn-kick" onclick="executeKick('${id}')">KICK</button>` : ''}
                ${(myInfo.isHost || myInfo.permissions.ban) ? `<button class="btn-ban" onclick="executeBan('${id}')">BAN</button>` : ''}
            </div>
        `;
        list.appendChild(row);
    });
}

function toggleUserPerm(userId, perm, val) {
    if(!myInfo.isHost) return;
    if(connectedPeers[userId]) {
        connectedPeers[userId].permissions[perm] = val;
        connectedPeers[userId].conn?.send({ type: 'perm-update', perms: connectedPeers[userId].permissions });
        broadcastData({ type: 'sync-state', state: getGlobalState() });
        renderRooms();
    }
}

function executeKick(id) {
    if(myInfo.isHost) {
        connectedPeers[id]?.conn?.send({ type: 'kicked' });
        setTimeout(() => removeUserCompletely(id), 200);
        appAlert("System Broadcast: A user was kicked from the network.", "warning");
    } else {
        connectedPeers[targetHostId]?.conn?.send({ type: 'req-kick', target: id });
    }
}

function executeBan(id) {
    if(myInfo.isHost) {
        bannedUsers.add(id);
        if(connectedPeers[id]) bannedUsers.add(connectedPeers[id].name);
        connectedPeers[id]?.conn?.send({ type: 'banned-kick' });
        setTimeout(() => removeUserCompletely(id), 200);
        appAlert("System Broadcast: A user was permanently banned from the network.", "error");
    } else {
        connectedPeers[targetHostId]?.conn?.send({ type: 'req-ban', target: id });
    }
}

// --- ROOM LOGIC & ACTIONS ---
let pendingRoomJoin = null;

function sendRoomAction(payload) {
    payload.type = 'room-action';
    if (myInfo.isHost) {
        processHostDataRequest(myInfo.id, payload);
    } else {
        connectedPeers[targetHostId]?.conn?.send(payload);
    }
}

async function deleteRoomPrompt(rName, e) {
    e.stopPropagation();
    if(await appConfirm(`WARNING: Are you sure you want to delete "${rName}"? Users inside will be moved to AFK Zone.`)) {
        sendRoomAction({ action: 'delete', room: rName });
    }
}

function renameRoomPrompt(rName, e) {
    e.stopPropagation();
    document.getElementById('rename-old-name').value = rName;
    document.getElementById('rename-input').value = rName;
    document.getElementById('rename-modal').classList.add('active');
}

function confirmRenameRoom() {
    let oldName = document.getElementById('rename-old-name').value;
    let newName = document.getElementById('rename-input').value.trim();
    if(newName && newName !== oldName) {
        sendRoomAction({ action: 'rename', oldName: oldName, newName: newName });
    }
    document.getElementById('rename-modal').classList.remove('active');
}

function moveRoomOrder(rName, dir, e) {
    e.stopPropagation();
    sendRoomAction({ action: 'reorder', room: rName, dir: dir });
}

function joinRoom(roomName) {
    if (roomName === myInfo.room) return;
    
    if (myInfo.isHost || myInfo.permissions.bypassLimits) {
        completeRoomJoin(roomName);
    } else {
        connectedPeers[targetHostId]?.conn?.send({ type: 'room-join-req', room: roomName, password: "" });
    }
}

function handleRoomJoinRequest(senderId, data) {
    const r = ROOMS[data.room];
    if(!r) return;
    
    const sender = connectedPeers[senderId];
    if(!sender) return;

    let canJoin = true;
    let failReason = "";

    if (r.isSecret && r.password !== data.password && !sender.permissions.bypassLimits) {
        canJoin = false;
        failReason = "invalid-password";
    }
    
    if (canJoin && r.capacity > 0 && !sender.permissions.bypassLimits) {
        let currentUsers = Object.values(connectedPeers).filter(u => u.room === data.room).length;
        if (myInfo.room === data.room) currentUsers++;
        if (currentUsers >= r.capacity) {
            canJoin = false;
            failReason = "room-full";
        }
    }

    if (canJoin) {
        connectedPeers[senderId].conn?.send({ type: 'room-join-ack', room: data.room, success: true });
    } else {
        connectedPeers[senderId].conn?.send({ type: 'room-join-ack', room: data.room, success: false, reason: failReason });
    }
}

function completeRoomJoin(roomName) {
    if (myScreenStream) stopMyScreenShare();
    stopWatchingAll();
    
    myInfo.room = roomName; 
    document.getElementById("current-room-title").innerText = roomName; 
    stopMusicLocally(); 
    
    const micBtn = document.getElementById("btn-mic");
    if (roomName === "AFK Zone") { 
        if(!myInfo.micMuted && !isPTTEnabled) toggleMic(true); 
        micBtn.style.pointerEvents = "none"; 
        micBtn.style.opacity = "0.3";
    } else { 
        if(!isPTTEnabled) {
            micBtn.style.pointerEvents = "auto"; 
            micBtn.style.opacity = "1";
        }
    }

    if (myInfo.isHost) {
        loadChatHistory(globalChatHistory[roomName]); 
        broadcastData({ type: 'sync-state', state: getGlobalState() }); 
        syncMediaConnections(getGlobalState()); 
        renderRooms();
    } else {
        document.getElementById("messages").innerHTML = ""; 
        connectedPeers[targetHostId]?.conn?.send({ type: 'update-state', peerId: myInfo.id, data: myInfo }); 
        renderRooms();
    }
}

document.getElementById('btn-submit-room-pass').onclick = () => {
    let pass = document.getElementById('join-room-pass-input').value;
    if(pendingRoomJoin) {
        connectedPeers[targetHostId]?.conn?.send({ type: 'room-join-req', room: pendingRoomJoin, password: pass });
    }
    document.getElementById('password-modal').classList.remove('active');
    document.getElementById('join-room-pass-input').value = "";
};

function openRoomCreateModal() {
    if (myInfo.isHost || myInfo.permissions.createRoom || myInfo.permissions.createSecretRoom) {
        document.getElementById('room-modal').classList.add('active');
        if (!myInfo.isHost && !myInfo.permissions.createSecretRoom) {
            document.getElementById('room-secret-cb').parentElement.style.display = 'none';
        } else {
            document.getElementById('room-secret-cb').parentElement.style.display = 'flex';
        }
    } else {
        appAlert("Permission denied. You cannot create rooms.");
    }
}

function confirmNewRoom() {
    let rName = document.getElementById('new-room-input').value.trim();
    let isSecret = document.getElementById('room-secret-cb').checked;
    let rPass = document.getElementById('room-pass-input').value.trim();
    let rCap = parseInt(document.getElementById('room-capacity-input').value) || 0;

    if(!rName || ROOMS[rName]) return appAlert("Protocol Error: Invalid or duplicate room name.");
    
    if(!myInfo.isHost) {
        if(!myInfo.permissions.createRoom) return;
        if(isSecret && !myInfo.permissions.createSecretRoom) return appAlert("Permission denied for secret rooms.");
    }

    ROOMS[rName] = { name: rName, isSecret: isSecret, password: rPass, capacity: rCap, isPermanent: false };
    ROOM_ORDER.push(rName); 
    initRoomsState(); 
    
    if (myInfo.isHost) {
        broadcastData({ type: 'sync-state', state: getGlobalState() }); 
        renderRooms();
    } else {
        connectedPeers[targetHostId]?.conn?.send({ type: 'req-create-room', roomObj: ROOMS[rName] });
    }
    
    document.getElementById('new-room-input').value = ""; 
    document.getElementById('room-pass-input').value = ""; 
    document.getElementById('room-modal').classList.remove('active');
}

function renderRooms() {
    const cont = document.getElementById("room-container"); 
    const grid = document.getElementById("active-users-grid");
    cont.innerHTML = ""; grid.innerHTML = "";
    
    let all = Object.values(connectedPeers).filter(p => p.name); all.push(myInfo);
    
    document.getElementById('btn-create-room').style.display = (myInfo.isHost || myInfo.permissions.createRoom || myInfo.permissions.createSecretRoom) ? 'block' : 'none';
    document.getElementById('btn-host-dash').style.display = (myInfo.isHost || myInfo.permissions.kick || myInfo.permissions.ban) ? 'flex' : 'none';

    let canReorder = myInfo.isHost || myInfo.permissions.reorderRooms;
    let canRename = myInfo.isHost || myInfo.permissions.renameRoom;
    let canDelete = myInfo.isHost || myInfo.permissions.deleteRoom;

    ROOM_ORDER.forEach(r => {
        let rObj = ROOMS[r];
        if(!rObj) return;

        let users = all.filter(u => u.room === r); 
        
        const wrapper = document.createElement("div");
        wrapper.className = "room-wrapper";

        const div = document.createElement("div"); 
        div.className = `room-name ${myInfo.room === r ? 'active' : ''} ${rObj.isSecret ? 'secret' : ''}`;
        div.onclick = () => joinRoom(r);
        
        let capText = rObj.capacity > 0 ? `${users.length}/${rObj.capacity}` : `${users.length}`;
        
        let actionHTML = `<div class="room-actions">`;
        if (canReorder) {
            actionHTML += `<button class="r-action-btn" title="Move Up" onclick="moveRoomOrder('${r}', -1, event)"><span class="material-symbols-rounded" style="font-size:16px;">arrow_upward</span></button>`;
            actionHTML += `<button class="r-action-btn" title="Move Down" onclick="moveRoomOrder('${r}', 1, event)"><span class="material-symbols-rounded" style="font-size:16px;">arrow_downward</span></button>`;
        }
        if (canRename && !rObj.isPermanent) {
            actionHTML += `<button class="r-action-btn" title="Rename" onclick="renameRoomPrompt('${r}', event)"><span class="material-symbols-rounded" style="font-size:16px;">edit</span></button>`;
        }
        if (canRename && rObj.isPermanent && r !== "AFK Zone") {
             actionHTML += `<button class="r-action-btn" title="Rename" onclick="renameRoomPrompt('${r}', event)"><span class="material-symbols-rounded" style="font-size:16px;">edit</span></button>`;
        }
        if (canDelete && !rObj.isPermanent) {
            actionHTML += `<button class="r-action-btn del" title="Delete" onclick="deleteRoomPrompt('${r}', event)"><span class="material-symbols-rounded" style="font-size:16px;">delete</span></button>`;
        }
        actionHTML += `</div>`;

        div.innerHTML = `<span class="material-symbols-rounded" style="font-size:18px;">${rObj.isSecret ? 'lock' : 'tag'}</span> ${r} ${actionHTML} <span style="margin-left:auto; font-size:12px;">${capText}</span>`;
        wrapper.appendChild(div);
        cont.appendChild(wrapper);

        if (myInfo.room === r) {
            users.forEach(u => {
                const pill = document.createElement("div"); pill.className = `user-pill ${u.isSpeaking ? 'speaking' : ''}`;
                let statusIcons = `<span class="material-symbols-rounded status-icon ${u.micMuted ? 'muted' : ''}">${u.micMuted ? 'mic_off' : 'mic'}</span>`;
                if(u.isScreenSharing) statusIcons += `<span class="material-symbols-rounded" style="color:var(--success); margin-left:4px; font-size:16px;" title="Broadcasting Screen">screen_share</span>`;
                
                let badges = "";
                if(u.isHost) badges += '<span class="u-badge host" title="Network Host">H</span>';
                if(u.permissions?.kick || u.permissions?.ban) badges += '<span class="u-badge mod" title="Moderator">M</span>';
                
                let volumeControl = "";
                if (u.id !== myInfo.id) {
                    let currentVol = userVolumes[u.id] !== undefined ? Math.round(userVolumes[u.id] * 100) : 100;
                    volumeControl = `
                        <div class="vol-control-wrapper" title="Adjust User Volume" onclick="event.stopPropagation()">
                            <input type="range" class="user-vol-slider" min="0" max="200" value="${currentVol}" oninput="setUserVolume('${u.id}', this.value, event)">
                        </div>`;
                }

                pill.innerHTML = `${statusIcons}<span>${u.name}</span> ${volumeControl} <div class="user-badges">${badges}</div>`; 
                grid.appendChild(pill);
            });
        }
        if (users.length > 0) {
            const uList = document.createElement("div"); uList.className = "sidebar-users";
            users.forEach(u => {
                const uRow = document.createElement("div"); uRow.className = "s-user";
                let actionBtns = `<div style="display:flex; gap:4px;">`;
                
                if (u.id !== myInfo.id) {
                    if(u.acceptsDMs !== false) {
                        actionBtns += `<button class="s-u-pull" title="Send DM" onclick="openDmWith('${u.id}', event)"><span class="material-symbols-rounded" style="font-size:16px;">mail</span></button>`;
                    } else {
                        actionBtns += `<span class="material-symbols-rounded" style="font-size:16px; color:var(--danger); opacity:0.5; padding:4px;" title="DMs Disabled">no_encryption</span>`;
                    }
                }
                
                if ((myInfo.isHost || myInfo.permissions.pullUsers) && u.id !== myInfo.id && u.room !== myInfo.room) {
                    actionBtns += `<button class="s-u-pull" title="Pull User" onclick="pullUser('${u.id}', event)"><span class="material-symbols-rounded" style="font-size:16px;">pan_tool_alt</span></button>`;
                }
                actionBtns += `</div>`;
                
                let sBadge = u.isHost ? '<span style="color:var(--warning); font-size:10px;">[H]</span>' : '';
                uRow.innerHTML = `<span>${u.name} ${sBadge}</span> ${actionBtns}`; 
                uList.appendChild(uRow);
            }); cont.appendChild(uList);
        }
    });
}

function processHostDataRequest(senderId, data) {
    let u = connectedPeers[senderId];
    let p = senderId === myInfo.id ? myInfo.permissions : (u ? u.permissions : null);
    let isHost = senderId === myInfo.id;

    if (data.type.startsWith('yt-')) {
        processMusicRequest(senderId, data);
    } else if (data.type === 'watch-status') {
        if (data.target === myInfo.id) {
            handleWatchStatus(data.sender, data.status);
        } else {
            connectedPeers[data.target]?.conn?.send(data);
        }
    } else if (data.type === 'room-join-req') {
        handleRoomJoinRequest(senderId, data);
    } else if (data.type === 'req-kick') {
        if (p?.kick) executeKick(data.target);
    } else if (data.type === 'req-ban') {
        if (p?.ban) executeBan(data.target);
    } else if (data.type === 'room-action') {
        if (data.action === 'delete' && (isHost || p?.deleteRoom)) {
            if (ROOMS[data.room]?.isPermanent) return; 
            
            let moveList = Object.keys(connectedPeers).filter(k => connectedPeers[k].room === data.room);
            if (myInfo.room === data.room) completeRoomJoin("AFK Zone");
            moveList.forEach(k => connectedPeers[k].conn?.send({ type: 'force-move', room: "AFK Zone" }));
            
            delete ROOMS[data.room];
            ROOM_ORDER = ROOM_ORDER.filter(x => x !== data.room);
            broadcastData({ type: 'sync-state', state: getGlobalState() });
            renderRooms();
        }
        else if (data.action === 'rename' && (isHost || p?.renameRoom)) {
            if (data.oldName === "AFK Zone") return; 
            if (ROOMS[data.newName]) return; 
            
            ROOMS[data.newName] = ROOMS[data.oldName];
            ROOMS[data.newName].name = data.newName;
            delete ROOMS[data.oldName];
            
            let idx = ROOM_ORDER.indexOf(data.oldName);
            if(idx !== -1) ROOM_ORDER[idx] = data.newName;

            globalChatHistory[data.newName] = globalChatHistory[data.oldName] || [];
            delete globalChatHistory[data.oldName];
            
            globalMusicState[data.newName] = globalMusicState[data.oldName] || { isPlaying: false, queue: [] };
            delete globalMusicState[data.oldName];

            if (myInfo.room === data.oldName) {
                myInfo.room = data.newName;
                document.getElementById("current-room-title").innerText = data.newName;
            }
            Object.keys(connectedPeers).forEach(k => {
                if(connectedPeers[k].room === data.oldName) connectedPeers[k].room = data.newName;
            });
            
            broadcastData({ type: 'sync-state', state: getGlobalState() });
            renderRooms();
        }
        else if (data.action === 'reorder' && (isHost || p?.reorderRooms)) {
            let idx = ROOM_ORDER.indexOf(data.room);
            if (idx === -1) return;
            let targetIdx = idx + data.dir;
            if (targetIdx >= 0 && targetIdx < ROOM_ORDER.length) {
                let temp = ROOM_ORDER[idx];
                ROOM_ORDER[idx] = ROOM_ORDER[targetIdx];
                ROOM_ORDER[targetIdx] = temp;
                broadcastData({ type: 'sync-state', state: getGlobalState() });
                renderRooms();
            }
        }
    }
}

// YOUTUBE & MEDIA 
async function handleUnifiedYouTubeCommand(query) {
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = query.match(ytRegex);
    let videoId = null;

    if (match && match[1]) {
        videoId = match[1];
        sendRoomData({ type: 'yt-add', videoId: videoId, title: "Shared Media Stream", mode: 'video' });
    } else {
        appendMessage("System", `Searching: "${query}"...`);
        try {
            const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
            const html = await res.text();
            const searchMatch = html.match(/"videoId":"([^"]{11})"/);
            if (searchMatch && searchMatch[1]) {
                videoId = searchMatch[1];
                sendRoomData({ type: 'yt-add', videoId: videoId, title: `Youtube: ${query}`, mode: 'video' });
            } else {
                appAlert("Error: No suitable video found on YouTube.");
            }
        } catch (e) {
            appAlert("Connection Error: Search failed.");
        }
    }
}

function renderYtQueue(queue) {
    const list = document.getElementById('yt-queue-list');
    const container = document.getElementById('yt-queue-container');
    list.innerHTML = '';
    if (!queue || queue.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    queue.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.innerText = `${index + 1}. ${item.title}`;
        list.appendChild(div);
    });
}

function playYouTubeVideo(vId, title, mode, queue, offset) {
    isPlaying = true; 
    document.getElementById("music-info").innerText = title; 
    document.getElementById("music-player-box").style.display = "flex";
    renderYtQueue(queue);

    const ytCont = document.getElementById("yt-player-container"); 
    ytCont.style.display = "block"; 
    
    watchingYt = false;
    document.getElementById('yt-overlay').style.display = 'flex';
    const ytPlayerElement = document.getElementById('yt-player');
    if (ytPlayerElement) { ytPlayerElement.style.opacity = '0'; ytPlayerElement.style.pointerEvents = 'none'; }
    document.getElementById('btn-stop-watch').style.display = 'none';

    checkMediaContainer();

    if (ytPlayerObj?.loadVideoById) { 
        ytPlayerObj.loadVideoById({ videoId: vId, startSeconds: offset || 0 }); 
    } else {
        ytPlayerObj = new YT.Player('yt-player', {
            host: 'https://www.youtube.com', height: '100%', width: '100%', videoId: vId, 
            playerVars: { 'autoplay': 1, 'controls': 0, 'origin': window.location.origin, 'enablejsapi': 1, 'rel': 0 },
            events: { 
                'onReady': (e) => { e.target.setVolume(document.getElementById("yt-volume").value); e.target.playVideo(); }, 
                'onStateChange': (e) => { if (e.data === 0 && myInfo.isHost) processMusicRequest(myInfo.id, { type: 'yt-ended' }); } 
            }
        });
    }
}

function stopMusicLocally() { 
    isPlaying = false; 
    document.getElementById("music-player-box").style.display = "none"; 
    document.getElementById("yt-player-container").style.display = "none"; 
    renderYtQueue([]); ytPlayerObj?.stopVideo?.(); checkMediaContainer(); 
}

function triggerPausePlay() { sendRoomData({ type: 'yt-toggle' }); }
function triggerNext() { sendRoomData({ type: 'yt-next' }); }
function triggerStop() { sendRoomData({ type: 'yt-stop' }); }
function triggerSeek(val) { sendRoomData({ type: 'yt-seek', amount: val }); }

function processMusicRequest(senderId, data) {
    let sRoom = senderId === myInfo.id ? myInfo.room : connectedPeers[senderId]?.room;
    if(!sRoom) return; let rm = globalMusicState[sRoom];
    if(data.type === 'yt-add') {
        rm.queue.push({ videoId: data.videoId, title: data.title, mode: data.mode });
        if(!rm.isPlaying) { 
            let n = rm.queue.shift(); rm.currentVideo = n; rm.isPlaying = true; rm.startTime = Date.now(); 
            broadcastRoom(sRoom, { type: 'youtube-play', video: n, queue: rm.queue, mode: n.mode }); 
        } else { broadcastRoom(sRoom, { type: 'youtube-sync-queue', queue: rm.queue }); }
    } else if (data.type === 'yt-ended' || data.type === 'yt-next') {
        if(rm.queue.length > 0) { 
            let n = rm.queue.shift(); rm.currentVideo = n; rm.startTime = Date.now(); rm.isPaused = false; 
            broadcastRoom(sRoom, { type: 'youtube-play', video: n, queue: rm.queue, mode: n.mode }); 
        } else { rm.isPlaying = false; broadcastRoom(sRoom, { type: 'youtube-stop' }); }
    } else if (data.type === 'yt-stop') { 
        rm.isPlaying = false; rm.queue = []; rm.isPaused = false; broadcastRoom(sRoom, { type: 'youtube-stop' }); 
    } else if (data.type === 'yt-toggle') {
        if(rm.isPlaying && rm.currentVideo) {
            rm.isPaused = !rm.isPaused;
            if(rm.isPaused) rm.pauseTime = Date.now(); else rm.startTime += (Date.now() - rm.pauseTime);
            broadcastRoom(sRoom, { type: 'youtube-sync-pause', isPaused: rm.isPaused });
        }
    } else if (data.type === 'yt-seek') {
        if(rm.isPlaying && rm.currentVideo) {
            let elapsed = (Date.now() - rm.startTime) / 1000;
            if (rm.isPaused) elapsed = (rm.pauseTime - rm.startTime) / 1000;
            let newTime = elapsed + data.amount; if (newTime < 0) newTime = 0;
            rm.startTime -= data.amount * 1000; if (rm.isPaused) rm.pauseTime += data.amount * 1000;
            broadcastRoom(sRoom, { type: 'youtube-sync-seek', newTime: newTime });
        }
    }
}

// --- OPT-IN VIEWING SYSTEM ---
let watchingStreamId = null;
let watchingYt = false;

function watchStream(id) {
    watchingStreamId = id;
    document.getElementById(`overlay-${id}`).style.display = 'none';
    document.querySelector(`#vid-${id} video`).style.filter = 'none';
    document.getElementById(`controls-${id}`).style.display = 'flex';
    document.getElementById('btn-stop-watch').style.display = 'flex';
    sendRoomData({ type: 'watch-status', target: id, status: true });
}

function toggleYtVideoView() {
    watchingYt = true;
    document.getElementById('yt-overlay').style.display = 'none';
    const ytPlayer = document.getElementById('yt-player');
    ytPlayer.style.opacity = '1';
    document.getElementById('btn-stop-watch').style.display = 'flex';
}

function stopWatchingAll() {
    if (watchingStreamId) {
        const id = watchingStreamId;
        const overlay = document.getElementById(`overlay-${id}`);
        if(overlay) overlay.style.display = 'flex';
        const vidNode = document.querySelector(`#vid-${id} video`);
        if(vidNode) vidNode.style.filter = 'blur(20px)';
        const controls = document.getElementById(`controls-${id}`);
        if(controls) controls.style.display = 'none';
        sendRoomData({ type: 'watch-status', target: id, status: false });
        watchingStreamId = null;
    }
    if (watchingYt) {
        watchingYt = false;
        document.getElementById('yt-overlay').style.display = 'flex';
        const ytPlayer = document.getElementById('yt-player');
        if(ytPlayer) ytPlayer.style.opacity = '0';
    }
    document.getElementById('btn-stop-watch').style.display = 'none';
}

function handleWatchStatus(senderId, isWatching) {
    if (isWatching) myStreamViewers.add(senderId);
    else myStreamViewers.delete(senderId);
    const badge = document.getElementById(`badge-${myInfo.id}`);
    if(badge) badge.innerText = `${myStreamViewers.size} Viewers`;
}

// --- SCREEN SHARING ---
async function openScreenShareModal() {
    if(myScreenStream) { stopMyScreenShare(); return; }
    document.getElementById('screen-modal').classList.add('active'); loadScreenSources('screen', document.querySelector('.s-tab'));
}

async function loadScreenSources(type, tab) {
    document.querySelectorAll('.s-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active');
    const list = document.getElementById('screen-sources-list'); list.innerHTML = "Scanning signals...";
    const sources = await ipcRenderer.invoke('get-screen-sources', type); list.innerHTML = "";
    sources.forEach(s => {
        const d = document.createElement('div'); d.className = "source-item"; d.innerHTML = `<img src="${s.thumbnail}"><div>${s.name}</div>`;
        d.onclick = () => { selectedSourceId = s.id; document.querySelectorAll('.source-item').forEach(i => i.classList.remove('selected')); d.classList.add('selected'); }; list.appendChild(d);
    });
}

let selectedSourceId = null;
async function startScreenShareFromModal() {
    if(!selectedSourceId) return appAlert("Select a broadcast source.");
    const shareAudio = document.getElementById('share-audio-checkbox').checked;
    try {
        myScreenStream = await navigator.mediaDevices.getUserMedia({ 
            audio: shareAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false, 
            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: selectedSourceId } } 
        });
        document.getElementById('screen-modal').classList.remove('active');
        myInfo.isScreenSharing = true; 
        document.getElementById("btn-screen").classList.add("active-green"); 
        
        myStreamViewers.clear();
        addVideoElement(myInfo.id, myScreenStream, myInfo.name, true);
        sendStatusUpdate(); 

        for(let id in connectedPeers) { 
            if(connectedPeers[id].room === myInfo.room) { 
                screenShareCalls[id] = peer.call(id, myScreenStream, { metadata: { type: 'screenshare', name: myInfo.name } }); 
            } 
        }
    } catch(e) { appAlert("Stream Error: Failed to capture screen.", "error"); }
}

function stopMyScreenShare() { 
    myScreenStream?.getTracks().forEach(t => t.stop()); 
    myScreenStream = null; myInfo.isScreenSharing = false; 
    document.getElementById("btn-screen").classList.remove("active-green"); 
    sendStatusUpdate(); broadcastRoom(myInfo.room, { type: 'stop-screen', peerId: myInfo.id }); 
    removeVideoElement(myInfo.id); myStreamViewers.clear();
}

// --- CHAT ENGINE ---
function sendChatReq() {
    const input = document.getElementById("chat-input"); const msg = input.value.trim(); 
    if(!msg) return; input.value = ''; 
    if(msg.startsWith("/yt ")) { handleUnifiedYouTubeCommand(msg.substring(4)); return; }
    if(msg === "/next") { sendRoomData({ type: 'yt-next' }); return; }
    if(msg === "/stop") { sendRoomData({ type: 'yt-stop' }); return; }
    
    if (myInfo.isHost) processChatRequest(myInfo.id, msg); 
    else connectedPeers[targetHostId]?.conn?.send({ type: 'chat-req', text: msg });
}

function processChatRequest(sid, text) { let s = (sid === myInfo.id) ? myInfo : connectedPeers[sid]; if(!s) return; globalChatHistory[s.room].push({ name: s.name, text: text }); broadcastRoom(s.room, { type: 'chat', name: s.name, text: text }); }
function appendMessage(name, text) { const c = document.getElementById("messages"); const d = document.createElement("div"); d.className = `msg-wrapper ${name === myInfo.name ? 'me' : (name === 'System' || name === 'Bot' ? 'sys' : 'other')}`; d.innerHTML = `<div class="msg-bubble"><b>${name}:</b> ${text}</div>`; c.appendChild(d); c.scrollTop = c.scrollHeight; }
function loadChatHistory(history) { const c = document.getElementById("messages"); c.innerHTML = ""; appendMessage("System", `Protocol: Secure connection to ${myInfo.room} established.`); history?.forEach(m => appendMessage(m.name, m.text)); }

function openDmWith(id, e) { 
    e?.stopPropagation(); 
    if(!connectedPeers[id]?.acceptsDMs && id !== targetHostId && !myInfo.isHost) return appAlert("This user is not accepting direct messages.");
    activeDmPeer = id; if(!privateMessages[id]) privateMessages[id] = []; 
    if(!isDmViewOpen) toggleDmView(); renderDmUI(); 
}

function toggleDmView() { 
    isDmViewOpen = !isDmViewOpen; 
    document.getElementById("main-chat-view").style.display = isDmViewOpen ? "none" : "flex"; 
    document.getElementById("dm-view").style.display = isDmViewOpen ? "flex" : "none"; 
    if (isDmViewOpen) { unreadDmCount = 0; updateBadge(); if (!activeDmPeer && Object.keys(privateMessages).length > 0) { activeDmPeer = Object.keys(privateMessages)[0]; } renderDmUI(); } 
}

function sendDm() { 
    const input = document.getElementById("dm-input-field"); const text = input.value.trim(); 
    if(!text || !activeDmPeer) return; 
    const msg = { sender: 'me', text: text }; 
    if(!privateMessages[activeDmPeer]) privateMessages[activeDmPeer] = []; privateMessages[activeDmPeer].push(msg); 
    const data = { type: 'dm-send', from: myInfo.id, fromName: myInfo.name, to: activeDmPeer, text: text }; 
    if(myInfo.isHost) connectedPeers[activeDmPeer]?.conn?.send(data); else connectedPeers[targetHostId]?.conn?.send(data); 
    input.value = ""; renderDmUI(); 
}

function receiveDm(from, fromName, text) { 
    if(!myInfo.acceptsDMs && from !== targetHostId) return; 
    if(!privateMessages[from]) privateMessages[from] = []; 
    privateMessages[from].push({ sender: 'other', text: text }); 
    if(isDmViewOpen && activeDmPeer === from) renderDmUI(); else { unreadDmCount++; updateBadge(); } 
}

function renderDmUI() { 
    const list = document.getElementById("dm-list-container"); 
    const msgs = document.getElementById("dm-messages-container"); 
    const inputArea = document.getElementById("dm-input-area");
    
    list.innerHTML = ""; msgs.innerHTML = ""; 
    
    if (!activeDmPeer) {
        inputArea.style.display = "none";
        msgs.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--muted); font-size:12px; text-align:center;"><span class="material-symbols-rounded" style="font-size:48px; opacity:0.5; margin-bottom:10px;">forum</span> Select a user to start messaging.</div>`;
    } else {
        inputArea.style.display = "flex";
        Object.keys(privateMessages).forEach(id => { 
            const d = document.createElement("div"); d.className = `dm-user-item ${activeDmPeer === id ? 'active' : ''}`; 
            d.innerText = (connectedPeers[id]?.name || "U").charAt(0).toUpperCase(); 
            d.onclick = () => { activeDmPeer = id; renderDmUI(); }; list.appendChild(d); 
        }); 
        
        if (privateMessages[activeDmPeer]) { 
            privateMessages[activeDmPeer].forEach(m => { 
                const w = document.createElement("div"); w.className = `msg-wrapper ${m.sender === 'me' ? 'me' : 'other'}`; 
                w.innerHTML = `<div class="msg-bubble">${m.text}</div>`; msgs.appendChild(w); 
            }); msgs.scrollTop = msgs.scrollHeight; 
        }
    }
}

function updateBadge() { const b = document.getElementById("unread-badge"); b.style.display = unreadDmCount > 0 ? "flex" : "none"; b.innerText = unreadDmCount; }

async function generateInviteLink() {
    const display = document.getElementById("invite-link-display");
    const token = btoa('cloud-node:::' + serverPassword); 
    display.value = `thisport://portal/${token}`;
}
function copyInvite() { navigator.clipboard.writeText(document.getElementById("invite-link-display").value); appAlert("Invite Link: Copied to clipboard.", "content_copy"); }

// --- AUDIO & AI NOISE GATE (KEYBOARD FILTER) ---
function toggleNoiseGate() {
    closeNoiseGateTooltip();
    isNoiseGateOn = !isNoiseGateOn;
    document.getElementById("btn-noise-gate").classList.toggle("active-green", isNoiseGateOn);
}

let lastSpeechTime = 0; 

function setupAudioProcessing(stream) {
    audioContext = new AudioContext(); 
    const source = audioContext.createMediaStreamSource(stream); 
    gateNode = audioContext.createGain(); 
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 2048; 
    source.connect(analyser); 
    source.connect(gateNode);
    
    const dest = audioContext.createMediaStreamDestination(); 
    gateNode.connect(dest); 
    localStream = dest.stream; 
    
    const nyquist = audioContext.sampleRate / 2;
    const binSize = nyquist / analyser.frequencyBinCount;
    
    const minVoiceBin = Math.floor(300 / binSize);
    const maxVoiceBin = Math.floor(3000 / binSize);
    const maxHighBin = Math.floor(8000 / binSize);
    
    setInterval(() => {
        if (myInfo.deafened) { 
            gateNode.gain.value = 0; setSpeaking(false); return; 
        }
        
        if (isPTTEnabled) {
            if (isPttKeyPressed) {
                gateNode.gain.value = 1; setSpeaking(true);
            } else {
                gateNode.gain.value = 0; setSpeaking(false);
            }
            return;
        }

        if (myInfo.micMuted) {
            gateNode.gain.value = 0; setSpeaking(false); return; 
        }
        
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        
        let voiceEnergySum = 0; let highEnergySum = 0;
        
        for (let i = minVoiceBin; i <= maxVoiceBin; i++) voiceEnergySum += data[i];
        for (let i = maxVoiceBin; i <= maxHighBin; i++) highEnergySum += data[i];

        let voiceAvg = voiceEnergySum / (maxVoiceBin - minVoiceBin + 1);
        let highAvg = highEnergySum / (maxHighBin - maxVoiceBin + 1);

        if (isNoiseGateOn) {
            if (voiceAvg > 15 && voiceAvg > (highAvg * 1.5)) { 
                lastSpeechTime = Date.now();
                gateNode.gain.value = 1; setSpeaking(true);
            } else if (Date.now() - lastSpeechTime < 500) {
                gateNode.gain.value = 1; setSpeaking(true);
            } else {
                gateNode.gain.value = 0; setSpeaking(false);
            }
        } else {
            gateNode.gain.value = 1; setSpeaking(voiceAvg > 10);
        }
    }, 50);
}

function updateYtVolume() { if(ytPlayerObj && ytPlayerObj.setVolume) ytPlayerObj.setVolume(document.getElementById("yt-volume").value); }

function toggleMic(force = null) { 
    if (isPTTEnabled) return;
    myInfo.micMuted = force !== null ? force : !myInfo.micMuted; 
    const micBtn = document.getElementById("btn-mic");
    micBtn.classList.toggle("active-red", myInfo.micMuted); 
    micBtn.innerHTML = myInfo.micMuted ? '<span class="material-symbols-rounded">mic_off</span>' : '<span class="material-symbols-rounded">mic</span>';
    sendStatusUpdate(); 
}

function toggleDeafen() { 
    myInfo.deafened = !myInfo.deafened; 
    document.getElementById("btn-deafen").classList.toggle("active-red", myInfo.deafened); 
    if(myInfo.deafened && !myInfo.micMuted && !isPTTEnabled) toggleMic(true); 
    
    for(let id in userGains) {
        let vol = userVolumes[id] !== undefined ? userVolumes[id] : 1.0;
        userGains[id].gain.value = myInfo.deafened ? 0 : vol;
    }
    
    document.querySelectorAll('audio, video').forEach(media => { if(media.id !== `vid-${myInfo.id}`) media.muted = myInfo.deafened; }); 
    sendStatusUpdate(); 
}

function setSpeaking(s) { if(myInfo.isSpeaking !== s) { myInfo.isSpeaking = s; sendStatusUpdate(); } }

function sendStatusUpdate() { if (myInfo.isHost) { broadcastData({ type: 'sync-state', state: getGlobalState() }); renderRooms(); } else { connectedPeers[targetHostId]?.conn?.send({ type: 'status-req', peerId: myInfo.id, data: myInfo }); } }
function broadcastData(data) { for(let id in connectedPeers) { connectedPeers[id].conn?.send(data); } }
function broadcastRoom(room, data) { if(myInfo.room === room) handleNetworkData(data); for(let id in connectedPeers) { if(connectedPeers[id].room === room) connectedPeers[id].conn?.send(data); } }

function getGlobalState() { 
    let s = { rooms: ROOMS, roomOrder: ROOM_ORDER }; 
    s[myInfo.id] = { ...myInfo }; 
    for(let id in connectedPeers) { 
        if(connectedPeers[id].name) {
            s[id] = { ...connectedPeers[id] };
            delete s[id].conn; 
            delete s[id].lastPing;
        }
    } 
    return s; 
}

function handleNetworkData(data) {
    lastHostInteraction = Date.now();
    if (data.type === 'pong') return;

    if (data.type === 'sync-state') { 
        ROOMS = data.state.rooms; 
        if(data.state.roomOrder) ROOM_ORDER = data.state.roomOrder;
        
        if(data.state[myInfo.id] && data.state[myInfo.id].permissions) {
            myInfo.permissions = data.state[myInfo.id].permissions;
        }

        for(let id in data.state) { 
            if(id !== myInfo.id && id !== 'rooms' && id !== 'roomOrder') { 
                let existingConn = connectedPeers[id]?.conn;
                let isServerFlag = connectedPeers[id]?.isServer;
                
                connectedPeers[id] = data.state[id]; 
                
                if(existingConn) connectedPeers[id].conn = existingConn;
                if(isServerFlag) connectedPeers[id].isServer = isServerFlag;
            } 
        } 
        syncMediaConnections(data.state); 
        renderRooms(); 
    }
    else if (data.type === 'chat') { appendMessage(data.name, data.text); } 
    else if (data.type === 'youtube-play') { playYouTubeVideo(data.video.videoId, data.video.title, data.mode, data.queue, 0); } 
    else if (data.type === 'youtube-stop') { stopMusicLocally(); }
    else if (data.type === 'youtube-sync-queue') { renderYtQueue(data.queue); }
    else if (data.type === 'youtube-sync-pause') { if(ytPlayerObj) data.isPaused ? ytPlayerObj.pauseVideo() : ytPlayerObj.playVideo(); document.getElementById("btn-pause-play").innerHTML = `<span class="material-symbols-rounded">${data.isPaused ? 'play_arrow' : 'pause'}</span>`; }
    else if (data.type === 'youtube-sync-seek') { if(ytPlayerObj && ytPlayerObj.seekTo) ytPlayerObj.seekTo(data.newTime, true); }
    else if (data.type === 'watch-status' && data.target === myInfo.id) { handleWatchStatus(data.sender, data.status); }
    else if (data.type === 'force-move') { completeRoomJoin(data.room); appendMessage("System", `You were moved to ${data.room} by an Admin.`); }
    else if (data.type === 'kicked') { appAlert("You have been kicked from the network.", "warning").then(() => leaveServer(true)); }
    else if (data.type === 'banned-kick') { appAlert("You are banned from this network.", "error").then(() => leaveServer(true)); }
    else if (data.type === 'perm-update') { myInfo.permissions = data.perms; appendMessage("System", "Your permissions were updated by the Host."); renderRooms(); }
    else if (data.type === 'req-create-room') { ROOMS[data.roomObj.name] = data.roomObj; ROOM_ORDER.push(data.roomObj.name); initRoomsState(); broadcastData({ type: 'sync-state', state: getGlobalState() }); renderRooms(); appendMessage("System", `Broadcast: Room "${data.roomObj.name}" created.`); }
    else if (data.type === 'room-join-ack') {
        if(data.success) completeRoomJoin(data.room);
        else if (data.reason === 'invalid-password') { pendingRoomJoin = data.room; document.getElementById('password-modal').classList.add('active'); }
        else if (data.reason === 'room-full') appAlert("Room is currently full.", "error");
    }
}

function syncMediaConnections(state) {
    let m = myInfo.room;
    for(let id in mediaCalls) { if(!state[id] || state[id].room !== m) { mediaCalls[id].close(); delete mediaCalls[id]; document.getElementById("audio-" + id)?.remove(); } }
    for(let id in screenShareCalls) { if(!state[id] || state[id].room !== m) { screenShareCalls[id].close(); delete screenShareCalls[id]; removeVideoElement(id); } }
    for(let id in state) {
        if(id !== myInfo.id && id !== 'rooms' && id !== 'roomOrder' && state[id].room === m) {
            if(!mediaCalls[id] && myInfo.id > id) { const call = peer.call(id, localStream); mediaCalls[id] = call; call.on('stream', (s) => playIncomingAudio(s, id)); }
            if(myScreenStream && !screenShareCalls[id]) { screenShareCalls[id] = peer.call(id, myScreenStream, { metadata: { type: 'screenshare', name: myInfo.name } }); }
        }
    } checkMediaContainer();
}

function checkMediaContainer() { 
    const grid = document.getElementById("media-grid"); 
    const ytContainer = document.getElementById("yt-player-container");
    const placeholder = document.getElementById("media-placeholder");
    
    let videoCount = 0;
    Array.from(grid.children).forEach(child => { if(child.id !== 'yt-player-container' && child.style.display !== 'none') videoCount++; });
    let ytVisible = (ytContainer.style.display === 'block');
    
    if (videoCount > 0 || ytVisible) { placeholder.style.display = "none"; grid.style.display = "flex"; } 
    else { placeholder.style.display = "flex"; grid.style.display = "none"; }
}

function addVideoElement(id, stream, name, isLocal = false) { 
    if(document.getElementById("vid-"+id)) return; 
    const grid = document.getElementById("media-grid"); 
    const wrap = document.createElement("div"); 
    wrap.id = "vid-"+id; wrap.className = "video-wrapper"; 
    
    const v = document.createElement("video"); 
    v.srcObject = stream; v.autoplay = true; 
    
    if (isLocal) {
        v.muted = true; 
        wrap.innerHTML = `<div class="viewer-badge" id="badge-${id}">0 Viewers</div><div class="video-label">Your Stream</div><button class="fs-btn" onclick="this.parentElement.requestFullscreen()"><span class="material-symbols-rounded">fullscreen</span></button>`;
        wrap.insertBefore(v, wrap.firstChild);
    } else {
        v.style.filter = "blur(20px)";
        wrap.innerHTML = `
            <div class="stream-overlay" id="overlay-${id}">
                <span class="material-symbols-rounded" style="font-size: 48px; color: white; margin-bottom: 10px;">live_tv</span>
                <p style="color: var(--muted); font-size: 13px; margin-bottom: 20px;">${name} is streaming.</p>
                <button class="btn-protocol" style="width: auto; padding: 10px 25px;" onclick="watchStream('${id}')">WATCH</button>
            </div>
            <div class="video-controls" style="display:none;" id="controls-${id}">
                <span class="material-symbols-rounded" style="font-size:18px;">volume_up</span>
                <input type="range" min="0" max="100" value="100" oninput="document.querySelector('#vid-${id} video').volume = this.value/100">
            </div>
            <div class="video-label">${name}</div>
            <button class="fs-btn" onclick="this.parentElement.requestFullscreen()"><span class="material-symbols-rounded">fullscreen</span></button>
        `;
        wrap.insertBefore(v, wrap.firstChild);
    }
    grid.appendChild(wrap); checkMediaContainer(); 
}

function removeVideoElement(id) { if (watchingStreamId === id) stopWatchingAll(); document.getElementById("vid-"+id)?.remove(); checkMediaContainer(); }

function playIncomingAudio(stream, id) { 
    if(document.getElementById("audio-"+id)) return; 
    
    const a = document.createElement("audio"); 
    a.id = "audio-"+id; 
    a.autoplay = true; 
    document.getElementById("audio-container").appendChild(a); 

    if (!userAudioCtx) userAudioCtx = new AudioContext();
    
    const source = userAudioCtx.createMediaStreamSource(stream);
    const gainNode = userAudioCtx.createGain();
    
    let vol = userVolumes[id] !== undefined ? userVolumes[id] : 1.0;
    gainNode.gain.value = myInfo.deafened ? 0 : vol;
    userGains[id] = gainNode;
    
    source.connect(gainNode);
    gainNode.connect(userAudioCtx.destination);
    
    a.srcObject = stream;
    a.muted = true;
}

function removeUserCompletely(id) { 
    mediaCalls[id]?.close(); 
    document.getElementById("audio-"+id)?.remove(); 
    removeVideoElement(id); 
    delete connectedPeers[id]; 
    if (userGains[id]) {
        userGains[id].disconnect();
        delete userGains[id];
    }
}