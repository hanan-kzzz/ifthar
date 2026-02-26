'use strict';
// ─── Config ───────────────────────────────────────────────────────────────────
const IFTAR_TIME = '18:00';
const MAX_USERS = 8;

// World-space seat positions for other users (hands rest on table at these XZ coords)
const TABLE_SEATS = [
    { x: 0.00, z: -0.52, ry: 0.00 },
    { x: -0.50, z: -0.55, ry: 0.30 },
    { x: 0.50, z: -0.55, ry: -0.30 },
    { x: -0.85, z: -0.08, ry: 0.90 },
    { x: 0.85, z: -0.08, ry: -0.90 },
    { x: -0.72, z: 0.36, ry: 1.40 },
    { x: 0.72, z: 0.36, ry: -1.40 },
];

// ─── Avatar Styles - Anime Full-Body Characters ────────────────────────────
const avatarStyles = [
    { name: 'Sakura', skin: '#FFDBB4', hair: '#FF69B4', bodyTop: '#E8B4D9', bodyBottom: '#FFD1DC', hairStyle: 'long', eyeStyle: 'large-sparkle', expression: 'smile', pose: 'casual', accessories: ['ribbon'] },
    { name: 'Akira', skin: '#F5CBA7', hair: '#1a1a2e', bodyTop: '#667eea', bodyBottom: '#333366', hairStyle: 'spiky', eyeStyle: 'sharp', expression: 'determined', pose: 'confident', accessories: ['necklace'] },
    { name: 'Yuki', skin: '#D4956A', hair: '#4A7BA7', bodyTop: '#87CEEB', bodyBottom: '#4682B4', hairStyle: 'twintails', eyeStyle: 'large-sparkle', expression: 'cheerful', pose: 'playful', accessories: ['bow'] },
    { name: 'Kaito', skin: '#C68642', hair: '#2C1810', bodyTop: '#2980b9', bodyBottom: '#1a1a2e', hairStyle: 'short-neat', eyeStyle: 'cool', expression: 'calm', pose: 'relaxed', accessories: ['watch'] },
    { name: 'Aiko', skin: '#FDDBB4', hair: '#C8A96E', bodyTop: '#9b59b6', bodyBottom: '#8B4789', hairStyle: 'wavy', eyeStyle: 'gentle', expression: 'sweet', pose: 'graceful', accessories: ['flower'] },
    { name: 'Taro', skin: '#FFE0BD', hair: '#8B4513', bodyTop: '#DC143C', bodyBottom: '#8B0000', hairStyle: 'medium-tousled', eyeStyle: 'confident', expression: 'energetic', pose: 'action', accessories: ['scar'] },
    { name: 'Hana', skin: '#8D5524', hair: '#3D2B1F', bodyTop: '#f39c12', bodyBottom: '#FF8C00', hairStyle: 'bun', eyeStyle: 'wise', expression: 'thoughtful', pose: 'serene', accessories: ['headband'] },
    { name: 'Riku', skin: '#FDDBB4', hair: '#4A3728', bodyTop: '#FF6347', bodyBottom: '#FF4500', hairStyle: 'spikey-wild', eyeStyle: 'fierce', expression: 'intense', pose: 'powerful', accessories: ['battle-scars'] },
];

// ─── DOM ──────────────────────────────────────────────────────────────────────
const joinScreen = document.getElementById('joinScreen');
const tableScreen = document.getElementById('tableScreen');
const usernameInput = document.getElementById('username');
const avatarSel = document.getElementById('avatarSelection');
const joinButton = document.getElementById('joinButton');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const timerElement = document.getElementById('timer');
const iftharActions = document.getElementById('iftharActions');
const eatDateButton = document.getElementById('eatDate');
const drinkWaterBtn = document.getElementById('drinkWater');
const avatarUpload = document.getElementById('avatarUpload');
const hintBar = document.getElementById('hintBar');

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let users = [];
let selectedAvatar = null;
let iftharStarted = false;
let socket = null;

// Chat state & helpers
let chatHistory = [];                // array of message objects
let typingUsers = new Set();         // names currently typing
let typingTimeout = null;            // debounce timer for stop-typing
let replyToMessageId = null;         // for threading/replies
let searchFilter = '';               // current search term
// sound played when new message arrives while chat is hidden/minimized
const newMessageSound = (() => {
    // simple 220Hz beep for 150ms
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 220;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0;
        osc.start();
        return { play: () => {
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        } };
    } catch (e) {
        return { play: () => {} };
    }
})();

// Three.js objects
let scene, camera, renderer, clock;
let playerL, playerR;           // player hand meshes (camera-local)
let otherMeshes = {};           // userId -> {lh, rh, head, sprite}
let candleLight, lanternLight, ambientLight;
let candleFlame;                // flame mesh for animation
let handAnim = { eating: false, drinking: false, t: 0, lerpDir: 1 };

// ─── Voice Chat State ─────────────────────────────────────────────────────────
let audioCtx, analyserNode, micStream;
let isMicOn = false;
let isSpeaking = false;
let speakRing;                  // green torus ring on player hands when speaking
let vadTimer;                   // setInterval for voice-activity detection
let voiceChat = null;           // VoiceChat instance for WebRTC
let userVoiceStatus = {};       // userId -> { isMicOn, isSpeaking }

// ─── View Mode State ──────────────────────────────────────────────────────────
const VIEW_MODES = [
    { label: '👁 Normal', fov: 68, name: 'Normal' },
    { label: '🔭 Wide', fov: 110, name: 'Wide' },
    { label: '🌐 180°', fov: 150, name: 'Panoramic' },
];
let viewModeIdx = 2;  // Start with 180° panoramic view
let fovTarget = 150;   // Initial FOV for panoramic view

// View rotation tracking
let targetRotX = 0;
let targetRotY = 0;
let currRotX = 0;
let currRotY = 0;
const ROT_SENSITIVITY = 0.4;
const ROT_LIMIT_X = 0.3; // Approx 17 degrees up/down
const ROT_LIMIT_Y = 0.6; // Approx 34 degrees left/right

// ─── Touch & Mobile Gesture State ─────────────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;
let touchStartDist = 0;
let touchDragThreshold = 10; // px
let isMultiTouch = false;
let isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let isPortrait = window.innerHeight > window.innerWidth;

// ─── App Init ─────────────────────────────────────────────────────────────────
function init() {
    // Polyfill ctx.roundRect for older browsers
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
            this.beginPath();
            this.moveTo(x + r, y);
            this.lineTo(x + w - r, y);
            this.quadraticCurveTo(x + w, y, x + w, y + r);
            this.lineTo(x + w, y + h - r);
            this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            this.lineTo(x + r, y + h);
            this.quadraticCurveTo(x, y + h, x, y + h - r);
            this.lineTo(x, y + r);
            this.quadraticCurveTo(x, y, x + r, y);
            this.closePath();
        };
    }

    socket = io();
    setupSocketListeners();
    
    // Initialize Voice Chat
    voiceChat = new VoiceChat(socket);
    voiceChat.currentUserId = currentUser?.id; // Will be set properly after join
    setupVoiceChatListeners();

    // Load persisted data
    const savedName = localStorage.getItem('ifthar_name');
    const savedAvatar = localStorage.getItem('ifthar_avatar');
    if (savedName) usernameInput.value = savedName;
    if (savedAvatar) selectedAvatar = JSON.parse(savedAvatar);

    generateAvatarOptions();
    setupEventListeners();
    initializeViewButton();
    startCountdown();
}

// ─── Avatar Picker - Anime Full-Body Characters ──────────────────────────────
function generateAvatarOptions() {
    avatarSel.innerHTML = '';
    avatarStyles.forEach((style, i) => {
        const el = document.createElement('div');
        el.className = 'avatar-option anime' + (selectedAvatar === i ? ' selected' : '');
        el.innerHTML = buildAnimeHTML(style);
        el.addEventListener('click', () => selectAvatar(i, el));
        avatarSel.appendChild(el);
    });
    const up = document.createElement('div');
    const isCustom = typeof selectedAvatar === 'string' && selectedAvatar.startsWith('data:');
    up.className = 'avatar-option upload-option' + (isCustom ? ' selected' : '');
    if (isCustom) {
        up.style.backgroundImage = `url(${selectedAvatar})`;
        up.style.backgroundSize = 'cover';
        up.textContent = '';
    } else {
        up.textContent = '📸';
    }
    up.addEventListener('click', () => avatarUpload.click());
    avatarSel.appendChild(up);
    checkJoin();
}

function buildAnimeHTML(s) {
    // Hair styling
    let hairHtml = '';
    if (s.hairStyle === 'long') {
        hairHtml = `<div class="anime-hair anime-hair-long" style="background:${s.hair}"></div><div class="anime-hair-side anime-hair-side-l" style="background:${s.hair}"></div><div class="anime-hair-side anime-hair-side-r" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'twintails') {
        hairHtml = `<div class="anime-hair anime-hair-twintails" style="background:${s.hair}"></div><div class="anime-twintail anime-twintail-l" style="background:${s.hair}"></div><div class="anime-twintail anime-twintail-r" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'spiky') {
        hairHtml = `<div class="anime-hair anime-hair-spiky" style="background:${s.hair}"></div><div class="anime-hair-spike anime-spike-l" style="background:${s.hair}"></div><div class="anime-hair-spike anime-spike-r" style="background:${s.hair}"></div><div class="anime-hair-spike anime-spike-c" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'wavy') {
        hairHtml = `<div class="anime-hair anime-hair-wavy" style="background:${s.hair}"></div><div class="anime-hair-wave" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'short-neat') {
        hairHtml = `<div class="anime-hair anime-hair-short-neat" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'medium-tousled') {
        hairHtml = `<div class="anime-hair anime-hair-tousled" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'bun') {
        hairHtml = `<div class="anime-hair anime-hair-bun" style="background:${s.hair}"></div><div class="anime-hair-bun-top" style="background:${s.hair}"></div>`;
    } else if (s.hairStyle === 'spikey-wild') {
        hairHtml = `<div class="anime-hair anime-hair-wild" style="background:${s.hair}"></div><div class="anime-hair-wildspike" style="background:${s.hair}"></div>`;
    }

    // Eyes based on style
    let eyeClass = 'anime-eye';
    if (s.eyeStyle === 'large-sparkle') eyeClass += ' anime-eye-sparkle';
    else if (s.eyeStyle === 'sharp') eyeClass += ' anime-eye-sharp';
    else if (s.eyeStyle === 'cool') eyeClass += ' anime-eye-cool';
    else if (s.eyeStyle === 'gentle') eyeClass += ' anime-eye-gentle';
    else if (s.eyeStyle === 'confident') eyeClass += ' anime-eye-confident';
    else if (s.eyeStyle === 'wise') eyeClass += ' anime-eye-wise';
    else if (s.eyeStyle === 'fierce') eyeClass += ' anime-eye-fierce';

    // Mouth/expression
    let expressionClass = 'anime-mouth';
    if (s.expression === 'smile') expressionClass += ' anime-smile';
    else if (s.expression === 'determined') expressionClass += ' anime-determined';
    else if (s.expression === 'cheerful') expressionClass += ' anime-cheerful';
    else if (s.expression === 'calm') expressionClass += ' anime-calm';
    else if (s.expression === 'sweet') expressionClass += ' anime-sweet';
    else if (s.expression === 'energetic') expressionClass += ' anime-energetic';
    else if (s.expression === 'thoughtful') expressionClass += ' anime-thoughtful';
    else if (s.expression === 'intense') expressionClass += ' anime-intense';

    // Accessories
    let accessoriesHtml = '';
    if (s.accessories && s.accessories.length > 0) {
        if (s.accessories.includes('ribbon')) accessoriesHtml += `<div class="anime-accessory anime-ribbon" style="background:${s.hair}"></div>`;
        if (s.accessories.includes('bow')) accessoriesHtml += `<div class="anime-accessory anime-bow" style="background:${s.hair}"></div>`;
        if (s.accessories.includes('headband')) accessoriesHtml += `<div class="anime-accessory anime-headband" style="background:${s.bodyTop}"></div>`;
        if (s.accessories.includes('necklace')) accessoriesHtml += `<div class="anime-necklace"></div>`;
        if (s.accessories.includes('flower')) accessoriesHtml += `<div class="anime-accessory anime-flower"></div>`;
        if (s.accessories.includes('watch')) accessoriesHtml += `<div class="anime-watch"></div>`;
        if (s.accessories.includes('scar')) accessoriesHtml += `<div class="anime-scar"></div>`;
        if (s.accessories.includes('battle-scars')) accessoriesHtml += `<div class="anime-battle-scar"></div>`;
    }

    return `<div class="anime-character anime-pose-${s.pose}"><div class="anime-head-container">${hairHtml}<div class="anime-head" style="background:${s.skin}"><div class="anime-face"><div class="anime-eyes"><div class="${eyeClass}"><div class="anime-eye-white"></div><div class="anime-pupil"></div><div class="anime-eye-highlight"></div></div><div class="${eyeClass}"><div class="anime-eye-white"></div><div class="anime-pupil"></div><div class="anime-eye-highlight"></div></div></div><div class="${expressionClass}"></div><div class="anime-blush"><div class="anime-blush-l"></div><div class="anime-blush-r"></div></div></div></div>${accessoriesHtml}</div><div class="anime-neck"></div><div class="anime-body"><div class="anime-chest" style="background:${s.bodyTop}"><div class="anime-chest-shine"></div></div><div class="anime-waist"></div><div class="anime-legs"><div class="anime-leg anime-leg-l" style="background:${s.bodyBottom}"></div><div class="anime-leg anime-leg-r" style="background:${s.bodyBottom}"></div></div></div></div>`;
}

function selectAvatar(i, el) {
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    selectedAvatar = i;
    localStorage.setItem('ifthar_avatar', JSON.stringify(i));
    checkJoin();
}

function checkJoin() {
    const name = usernameInput.value.trim();
    joinButton.disabled = !name || selectedAvatar === null;
    if (name) {
        localStorage.setItem('ifthar_name', name);
        const errorEl = document.getElementById('joinError');
        if (errorEl) errorEl.classList.add('hidden');
    }
}

const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatPopup = document.getElementById('chatPopup');
const chatCloseBtn = document.getElementById('chatCloseBtn');

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
    usernameInput.addEventListener('input', checkJoin);
    joinButton.addEventListener('click', joinTable);
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
    messageInput.addEventListener('input', () => {
        // typing indicator
        if (!currentUser) return;
        socket.emit('typing', { userId: currentUser.id, name: currentUser.name });
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop-typing', { userId: currentUser.id, name: currentUser.name });
        }, 800);
    });
    const chatSearch = document.getElementById('chatSearch');
    if (chatSearch) {
        chatSearch.addEventListener('input', e => searchMessages(e.target.value));
    }
    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            chatFileInput.click();
        });
    }

    eatDateButton.addEventListener('click', eatFood);
    drinkWaterBtn.addEventListener('click', drinkWater);

    // Chat Toggle
    chatToggleBtn.addEventListener('click', toggleChat);
    chatCloseBtn.addEventListener('click', toggleChat);

    // Voice & View controls (added after join so elements exist)
    document.addEventListener('click', e => {
        if (e.target.id === 'profileBtn') handleNameChange();
        if (e.target.id === 'micBtn') toggleMic();
        if (e.target.id === 'viewBtn') cycleView();
    });

    // Viewport following cursor/touch
    window.addEventListener('mousemove', e => {
        if (currentUser && !isMultiTouch) {
            targetRotY = -(e.clientX / window.innerWidth - 0.5) * 2 * ROT_LIMIT_Y;
            targetRotX = -(e.clientY / window.innerHeight - 0.5) * 2 * ROT_LIMIT_X;
        }
    });

    // Enhanced touch controls for mobile
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Handle orientation change
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
}

// Initialize view button with correct label for default 180° view
function initializeViewButton() {
    const btn = document.getElementById('viewBtn');
    if (btn) {
        // Show the NEXT view mode as preview
        const nextIdx = (viewModeIdx + 1) % VIEW_MODES.length;
        btn.textContent = VIEW_MODES[nextIdx].label;
        const currentMode = VIEW_MODES[viewModeIdx];
        console.log(`Camera initialized to ${currentMode.name} view (${currentMode.fov}°)`);
    }
}

// ─── Touch & Gesture Handlers (Mobile Optimization) ────────────────────────────
function handleTouchStart(e) {
    if (!currentUser || !e.touches.length) return;
    
    isMultiTouch = e.touches.length > 1;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    
    // Calculate distance between two fingers for pinch zoom
    if (isMultiTouch && e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
    }
}

function handleTouchMove(e) {
    if (!currentUser || !e.touches.length) return;
    
    e.preventDefault(); // Prevent default scrolling
    
    const touch = e.touches[0];
    
    // Pinch zoom (two-finger gesture)
    if (isMultiTouch && e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.sqrt(dx * dx + dy * dy);
        const zoomDelta = currentDist - touchStartDist;
        
        // Zoom out with pinch (decrease FOV)
        if (zoomDelta < -10) {
            fovTarget = Math.max(50, fovTarget - 5);
            touchStartDist = currentDist;
        }
        // Zoom in (increase FOV)
        else if (zoomDelta > 10) {
            fovTarget = Math.min(160, fovTarget + 5);
            touchStartDist = currentDist;
        }
    } 
    // Single touch - pan camera
    else if (e.touches.length === 1) {
        const touchDragX = touch.clientX - touchStartX;
        const touchDragY = touch.clientY - touchStartY;
        
        // Apply rotation smoothly from touch movement
        targetRotY = -(touch.clientX / window.innerWidth - 0.5) * 2 * ROT_LIMIT_Y;
        targetRotX = -(touch.clientY / window.innerHeight - 0.5) * 2 * ROT_LIMIT_X;
    }
}

function handleTouchEnd(e) {
    isMultiTouch = false;
    touchStartX = 0;
    touchStartY = 0;
    touchStartDist = 0;
}

// Handle device orientation changes
function handleOrientationChange() {
    const wasPortrait = isPortrait;
    isPortrait = window.innerHeight > window.innerWidth;
    
    // Update camera aspect ratio
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    // Reposition UI elements if needed (handled by CSS media queries)
    console.log(`Orientation changed: ${isPortrait ? 'Portrait' : 'Landscape'}`);
}

function toggleChat() {
    const opening = chatPopup.classList.contains('hidden');
    chatPopup.classList.toggle('hidden');
    chatToggleBtn.classList.toggle('hidden');

    if (opening) {
        renderChat();
        updateTypingIndicator();
        // focus input
        setTimeout(() => messageInput.focus(), 100);
    }
}

avatarUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        selectedAvatar = ev.target.result; // data URL string
        document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
        const up = document.querySelector('.upload-option');
        up.classList.add('selected');
        up.style.backgroundImage = `url(${ev.target.result})`;
        up.style.backgroundSize = 'cover';
        up.textContent = '';
        localStorage.setItem('ifthar_avatar', JSON.stringify(selectedAvatar));
        checkJoin();
    };
    reader.readAsDataURL(file);
});

// ─── Join ─────────────────────────────────────────────────────────────────────
function joinTable() {
    const name = usernameInput.value.trim();
    if (!name || selectedAvatar === null) { alert('Enter name & pick avatar'); return; }

    const id = localStorage.getItem('ifthar_uid') || uid();
    localStorage.setItem('ifthar_uid', id);

    currentUser = { id, name, avatar: selectedAvatar, plateEaten: false, glassDrank: false };

    // Set current user ID for voice chat
    if (voiceChat) {
        voiceChat.currentUserId = currentUser.id;
    }

    // In multiplayer, users array is managed via socket events
    // but we can add ourselves locally for immediate feedback
    // addUser(currentUser); 

    joinScreen.classList.add('hidden');
    tableScreen.classList.remove('hidden');

    initThreeJS();

    socket.emit('join', currentUser);
}

function handleNameChange() {
    const newName = prompt('Enter your new name:', currentUser.name);
    if (newName && newName.trim() && newName !== currentUser.name) {
        socket.emit('change-name', newName.trim());
    }
}


function uid() { return 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }

function setupSocketListeners() {
    socket.on('current-users', (serverUsers) => {
        serverUsers.forEach(u => {
            if (u.id !== currentUser?.id) {
                addUser(u);
            }
        });
    });

    socket.on('user-joined', (user) => {
        if (user.id !== currentUser?.id) {
            addUser(user);
            addMessage('System', `${user.name} joined the table 🌙`, false);
            
            // Establish voice connection to new user (even if mic is currently off)
            if (voiceChat) {
                voiceChat.createPeerConnection(user.id, true);
            }
        } else {
            // We joined successfully
            addMessage('System', `Welcome ${user.name} to the Virtual Ifthar Table! 🌙`, false);
            // Establish connections to all existing users
            if (voiceChat) {
                voiceChat.broadcastOffer();
            }
        }
    });

    socket.on('join-error', (error) => {
        const errorEl = document.getElementById('joinError');
        if (errorEl) {
            errorEl.textContent = error;
            errorEl.classList.remove('hidden');
        }
        // Return to join screen if we were partially in
        tableScreen.classList.add('hidden');
        joinScreen.classList.remove('hidden');
    });

    socket.on('name-error', (error) => {
        alert(error);
    });

    socket.on('name-updated', (data) => {
        if (data.userId === currentUser.id) {
            currentUser.name = data.newName;
            localStorage.setItem('ifthar_name', data.newName);
            usernameInput.value = data.newName;
            addMessage('System', `You changed your name to ${data.newName}`, false);
        } else {
            const user = users.find(u => u.id === data.userId);
            if (user) {
                user.name = data.newName;
                // Update name sprite in scene
                if (otherMeshes[user.id]) {
                    scene.remove(otherMeshes[user.id].ns);
                    otherMeshes[user.id].ns = makeNameSprite(data.newName);
                    const seatIdx = users.indexOf(user);
                    const seat = TABLE_SEATS[seatIdx];
                    if (seat) otherMeshes[user.id].ns.position.set(seat.x, 0.905 + 0.7, seat.z + 0.04);
                    scene.add(otherMeshes[user.id].ns);
                }
                addMessage('System', `${data.oldName} is now known as ${data.newName}`, false);
            }
        }
    });

    socket.on('user-left', (userId) => {
        removeUser(userId);
    });

    socket.on('chat-message', (data) => {
        // incoming chat message from another user or ourselves (synced)
        if (data.senderId !== currentUser?.id) {
            handleIncomingMessage(data);
        }
    });

    socket.on('user-action', (data) => {
        if (data.userId !== currentUser?.id) {
            const user = users.find(u => u.id === data.userId);
            if (user) {
                if (data.type === 'eat') {
                    user.plateEaten = true;
                    addMessage('System', `${user.name} ate a date 🌴`, false);
                } else if (data.type === 'drink') {
                    user.glassDrank = true;
                    addMessage('System', `${user.name} drank water 💧`, false);
                }
                // Optionally trigger visual animations for other users here
            }
        }
    });

    socket.on('user-voice-status', (data) => {
        userVoiceStatus[data.userId] = data.status;
        // Update visual indicators for remote users
        if (otherMeshes[data.userId]) {
            const isSpeaking = data.status?.isSpeaking || false;
            if (otherMeshes[data.userId].speakRing) {
                otherMeshes[data.userId].speakRing.visible = isSpeaking;
            }
        }
    });

    socket.on('typing', (data) => {
        if (data && data.name && data.userId !== currentUser?.id) {
            typingUsers.add(data.name);
            updateTypingIndicator();
        }
    });
    socket.on('stop-typing', (data) => {
        if (data && data.name) {
            typingUsers.delete(data.name);
            updateTypingIndicator();
        }
    });

    socket.on('message-deleted', (data) => {
        if (data && data.id) {
            chatHistory = chatHistory.filter(m => m.id !== data.id);
            const el = chatMessages.querySelector(`div[data-id="${data.id}"]`);
            if (el) el.remove();
        }
    });

    socket.on('reaction', (data) => {
        handleReaction(data);
    });
}

function setupVoiceChatListeners() {
    // Listen for local voice status changes
    window.addEventListener('voice-status-changed', (event) => {
        const { isMicOn, isSpeaking } = event.detail;
        updateMicBtn();
        updateVoiceConnectionStatus();
    });
}

function updateVoiceConnectionStatus() {
    if (!voiceChat) return;
    
    const statusEl = document.getElementById('voiceConnectionStatus');
    if (!statusEl) return;
    
    const connectedPeers = voiceChat.getConnectedPeers();
    const isSpeaking = voiceChat.isUserSpeaking();
    
    if (connectedPeers === 0) {
        statusEl.classList.add('hidden');
    } else {
        statusEl.classList.remove('hidden');
        statusEl.classList.toggle('speaking', isSpeaking);
        statusEl.classList.toggle('connected', !isSpeaking);
        
        const statusText = statusEl.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = isSpeaking ? 
                `🗣 Speaking (${connectedPeers} connected)` : 
                `✓ Voice Chat (${connectedPeers} connected)`;
        }
    }
}

function removeUser(userId) {
    users = users.filter(u => u.id !== userId);
    removeUserFromScene(userId);
    delete userVoiceStatus[userId];
    const msg = "Someone left the table"; // We could track names if needed
    // addMessage('System', msg, false);
}

// ─── Three.js Scene ───────────────────────────────────────────────────────────
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06021a);
    scene.fog = new THREE.FogExp2(0x06021a, 0.055);

    // Panoramic 180-degree camera for immersive virtual iftar experience
    camera = new THREE.PerspectiveCamera(150, innerWidth / innerHeight, 0.01, 60);
    camera.position.set(0, 1.48, 2.20);
    camera.lookAt(0, 0.88, 0);

    const canvas = document.getElementById('threeCanvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2 });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // Capped for mobile performance
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    clock = new THREE.Clock();

    buildLights();
    buildEnvironment();
    buildTable();
    buildFood();
    buildPlayerHands();
    buildSpeakRing();     // green speaking indicator ring

    // Add existing users to scene
    users.forEach(u => {
        if (u.id !== currentUser?.id) {
            const otherUsers = users.filter(usr => usr.id !== currentUser?.id);
            const seatIdx = otherUsers.indexOf(u);
            addUserToScene(u, seatIdx);
        }
    });

    window.addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });

    animate();
}

// ─── Lights ───────────────────────────────────────────────────────────────────
function buildLights() {
    ambientLight = new THREE.AmbientLight(0x1a0840, 0.5);
    scene.add(ambientLight);

    const moon = new THREE.DirectionalLight(0x8080cc, 0.35);
    moon.position.set(-3, 8, 4);
    moon.castShadow = true;
    scene.add(moon);

    candleLight = new THREE.PointLight(0xff7700, 2.0, 2.8);
    candleLight.position.set(-0.25, 1.04, 0.04);
    scene.add(candleLight);

    lanternLight = new THREE.PointLight(0xffcc44, 1.2, 3.0);
    lanternLight.position.set(0.45, 1.02, -0.12);
    scene.add(lanternLight);
}

// ─── Environment (stars, floor, moon) ─────────────────────────────────────────
function buildEnvironment() {
    // Enhanced Starfield with more stars for panoramic view
    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - .5) * 80;          // wider horizontal spread
        pos[i * 3 + 1] = Math.random() * 25 + 2;         // higher vertical range
        pos[i * 3 + 2] = (Math.random() - .5) * 60;      // deeper perspective
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const starMaterial = new THREE.PointsMaterial({ 
        color: 0xffffff, 
        size: 0.08, 
        sizeAttenuation: true
    });
    scene.add(new THREE.Points(sg, starMaterial));

    // Enhanced Floor with improved appearance
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshPhongMaterial({ 
            color: 0x0a0420,
            shininess: 5,
            flatShading: false
        })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Moon sphere - larger for panoramic view
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 24, 20),
        new THREE.MeshBasicMaterial({ color: 0xffe8b0 })
    );
    moonMesh.position.set(-8, 11, -18);
    scene.add(moonMesh);
    
    // Moon glow aura
    const mg = new THREE.Mesh(
        new THREE.SphereGeometry(2.0, 24, 20),
        new THREE.MeshBasicMaterial({ 
            color: 0xffe8b0, 
            transparent: true, 
            opacity: 0.08
        })
    );
    mg.position.copy(moonMesh.position);
    scene.add(mg);
    
    // Atmospheric haze layer for immersion
    const hazeGeometry = new THREE.SphereGeometry(50, 32, 32);
    const hazeMaterial = new THREE.MeshBasicMaterial({
        color: 0x1a0a3e,
        transparent: true,
        opacity: 0.15,
        side: THREE.BackSide
    });
    const hazeSphere = new THREE.Mesh(hazeGeometry, hazeMaterial);
    scene.add(hazeSphere);

    // Distant mosque silhouette
    buildMosqueSilhouette();
    
    // Additional distant buildings and environment
    buildDistantEnvironment();
}

function buildMosqueSilhouette() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0420 });
    
    // Main dome - larger and more prominent
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.0, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.set(-10, 2.0, -20);
    scene.add(dome);
    
    // Minaret left
    const min1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 6, 10), mat);
    min1.position.set(-12.2, 3.0, -20);
    scene.add(min1);
    const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.0, 10), mat);
    tip1.position.set(-12.2, 6.2, -20);
    scene.add(tip1);
    
    // Minaret center
    const minC = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 6.5, 10), mat);
    minC.position.set(-10, 3.25, -20);
    scene.add(minC);
    const tipC = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.1, 10), mat);
    tipC.position.set(-10, 6.8, -20);
    scene.add(tipC);
    
    // Minaret right
    const min2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 6, 10), mat);
    min2.position.set(-7.8, 3.0, -20);
    scene.add(min2);
    const tip2 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.0, 10), mat);
    tip2.position.set(-7.8, 6.2, -20);
    scene.add(tip2);
    
    // Mosque body
    const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.5, 1.2), mat);
    body.position.set(-10, 1.25, -20);
    scene.add(body);
    
    // Arched entrance
    const arch = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.5), mat);
    arch.position.set(-10, 1.8, -19.4);
    scene.add(arch);
}

// ─── Table ────────────────────────────────────────────────────────────────────
function buildTable() {
    const wood = new THREE.MeshPhongMaterial({ color: 0x5c3317, shininess: 25, specular: new THREE.Color(0x220e00) });
    const cloth = new THREE.MeshPhongMaterial({ color: 0x2a0b50, shininess: 8 });

    // Top
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 1.3), wood);
    top.position.set(0, 0.875, 0);
    top.castShadow = true; top.receiveShadow = true;
    scene.add(top);
    // Cloth
    const cl = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.005, 1.28), cloth);
    cl.position.set(0, 0.902, 0);
    scene.add(cl);
    // Legs
    [[-0.95, -0.52], [0.95, -0.52], [-0.95, 0.52], [0.95, 0.52]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.87, 0.07), wood);
        leg.position.set(x, 0.435, z);
        leg.castShadow = true;
        scene.add(leg);
    });
}

// ─── Food / Decorations ───────────────────────────────────────────────────────
function buildFood() {
    const Y = 0.905; // table surface Y

    // ── Dates bowl (centre) ──
    const plateMat = new THREE.MeshPhongMaterial({ color: 0x8b5e0f, shininess: 35 });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.045, 20), plateMat);
    plate.position.set(-0.05, Y + 0.022, -.14);
    scene.add(plate);
    const dateMat = new THREE.MeshPhongMaterial({ color: 0x5c2b06 });
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.032, 7, 6), dateMat);
        d.scale.set(1.1, 0.7, 1);
        d.position.set(-.05 + Math.cos(a) * 0.1, Y + 0.06, -.14 + Math.sin(a) * 0.1);
        scene.add(d);
    }

    // ── Water jug ──
    const jugMat = new THREE.MeshPhongMaterial({ color: 0x88ccee, transparent: true, opacity: 0.72, shininess: 90, specular: new THREE.Color(0xffffff) });
    const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.22, 14), jugMat);
    jug.position.set(-0.48, Y + 0.11, -0.22);
    scene.add(jug);
    const jugCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.065, 0.03, 12), jugMat);
    jugCap.position.set(-0.48, Y + 0.235, -0.22);
    scene.add(jugCap);

    // ── Bread loaf ──
    const breadMat = new THREE.MeshPhongMaterial({ color: 0xc8922a, shininess: 5 });
    const bread = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 7), breadMat);
    bread.scale.set(1.3, 0.6, 1.0);
    bread.position.set(0.28, Y + 0.06, 0.12);
    scene.add(bread);

    // ── Fruit bowl ──
    const fbMat = new THREE.MeshPhongMaterial({ color: 0xe0e0e0, shininess: 55 });
    const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.035, 18), fbMat);
    fb.position.set(0.38, Y + 0.017, -0.28);
    scene.add(fb);
    [{ c: 0xff6633, ox: 0.07, oz: 0 }, { c: 0xffd700, ox: -0.05, oz: 0.07 }, { c: 0xa8e063, ox: 0.02, oz: -0.09 }, { c: 0xff99cc, ox: -0.07, oz: -0.02 }].forEach(f => {
        const fr = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), new THREE.MeshPhongMaterial({ color: f.c }));
        fr.position.set(0.38 + f.ox, Y + 0.06, -0.28 + f.oz);
        scene.add(fr);
    });

    // ── Candle ──
    const candleMat = new THREE.MeshPhongMaterial({ color: 0xf5d87a, shininess: 18 });
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 10), candleMat);
    candle.position.set(-0.25, Y + 0.065, 0.05);
    scene.add(candle);
    // Flame
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    candleFlame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 6), flameMat);
    candleFlame.position.set(-0.25, Y + 0.145, 0.05);
    scene.add(candleFlame);

    // ── Lantern ──
    const lanMat = new THREE.MeshPhongMaterial({ color: 0xc8860a, shininess: 50 });
    const lan = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), lanMat);
    lan.position.set(0.46, Y + 0.08, -0.12);
    scene.add(lan);
    const lanCap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.024, 12), lanMat);
    lanCap.position.set(0.46, Y + 0.172, -0.12);
    scene.add(lanCap);

    // ── Rose water bottle ──
    const rwMat = new THREE.MeshPhongMaterial({ color: 0xf4a0c0, shininess: 60, transparent: true, opacity: 0.85 });
    const rw = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.14, 10), rwMat);
    rw.position.set(0.14, Y + 0.07, 0.25);
    scene.add(rw);

    // ── Table Decoration: Flower Pot ──
    const potMat = new THREE.MeshPhongMaterial({ color: 0x4d3227 });
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.08, 10), potMat);
    pot.position.set(-0.6, Y + 0.04, 0.2);
    scene.add(pot);
    const flowerMat = new THREE.MeshPhongMaterial({ color: 0xff4d4d });
    for (let i = 0; i < 3; i++) {
        const flower = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), flowerMat);
        flower.position.set(-0.6 + (Math.random() - 0.5) * 0.05, Y + 0.12, 0.2 + (Math.random() - 0.5) * 0.05);
        scene.add(flower);
    }
}

// ─── Full-Body Avatar & Chair Creation ────────────────────────────────────────

// Create a full-body seated avatar (torso, arms, legs, head)
function makeFullBody(styleIdx) {
    const s = avatarStyles[styleIdx] || avatarStyles[0];
    const group = new THREE.Group();
    
    const skinColor = new THREE.Color(s.skin);
    // Use anime-style body colors: bodyTop for upper, bodyBottom for lower
    const bodyTopColor = new THREE.Color(s.bodyTop || s.body || '#667eea');
    const bodyBottomColor = new THREE.Color(s.bodyBottom || s.body || '#667eea');
    
    const skinMat = new THREE.MeshPhongMaterial({ color: skinColor, shininess: 14 });
    const bodyTopMat = new THREE.MeshPhongMaterial({ color: bodyTopColor, shininess: 10 });
    const bodyBottomMat = new THREE.MeshPhongMaterial({ color: bodyBottomColor, shininess: 10 });

    // === HEAD (at top, using enhanced anime-style head geometry) ===
    const head = makeUserHead(styleIdx);
    head.position.set(0, 0.35, 0);
    group.add(head);

    // === TORSO (seated upper body) ===
    const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.14, 0.26, 8),
        bodyTopMat
    );
    torso.position.set(0, 0.05, 0);
    torso.castShadow = true;
    group.add(torso);

    // === ARMS (bent forward, typing position) ===
    const leftArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.024, 0.22, 6),
        skinMat
    );
    leftArm.position.set(-0.16, 0.12, 0.08);
    leftArm.rotation.z = 0.35;
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.024, 0.22, 6),
        skinMat
    );
    rightArm.position.set(0.16, 0.12, 0.08);
    rightArm.rotation.z = -0.35;
    rightArm.castShadow = true;
    group.add(rightArm);

    // === LEGS (bent, seated position) - using bodyBottom color ===
    const leftLeg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.28, 6),
        bodyBottomMat
    );
    leftLeg.position.set(-0.08, -0.18, 0.05);
    leftLeg.rotation.z = 0.25;
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.28, 6),
        bodyBottomMat
    );
    rightLeg.position.set(0.08, -0.18, 0.05);
    rightLeg.rotation.z = -0.25;
    rightLeg.castShadow = true;
    group.add(rightLeg);

    return group;
}

// Create a simple wooden chair
function makeChair() {
    const group = new THREE.Group();
    const woodColor = new THREE.Color(0x5c3317); // wood brown
    const woodMat = new THREE.MeshPhongMaterial({ color: woodColor, shininess: 8 });

    // === SEAT (main platform) ===
    const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.06, 0.24),
        woodMat
    );
    seat.position.set(0, 0, 0);
    seat.castShadow = true;
    group.add(seat);

    // === BACKREST (vertical support) ===
    const backrest = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.28, 0.08),
        woodMat
    );
    backrest.position.set(0, 0.18, -0.12);
    backrest.castShadow = true;
    group.add(backrest);

    // === CHAIR LEGS (four support posts) ===
    const legPositions = [
        [-0.11, -0.08, -0.11],
        [ 0.11, -0.08, -0.11],
        [-0.11, -0.08,  0.11],
        [ 0.11, -0.08,  0.11],
    ];

    legPositions.forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6),
            woodMat
        );
        leg.position.set(x, y, z);
        leg.castShadow = true;
        group.add(leg);
    });

    return group;
}

// ─── Player Hands (camera-local) ──────────────────────────────────────────────
function buildPlayerHands() {
    const styleIdx = typeof selectedAvatar === 'number' ? selectedAvatar : 0;

    // Create full-body avatar positioned at bottom of camera view
    const playerBody = makeFullBody(styleIdx);
    playerBody.position.set(0, -0.65, -0.7);
    playerBody.scale.set(0.85, 0.85, 0.85);
    playerBody.visible = false;  // Hide player's own body to keep view clear
    camera.add(playerBody);

    // Create chair beneath player
    const playerChair = makeChair();
    playerChair.position.set(0, -0.92, -0.65);
    playerChair.scale.set(1.2, 1.2, 1.2);
    playerChair.visible = false;  // Hide chair from first-person view
    camera.add(playerChair);

    // Keep old hand references for compatibility, but also keep hands visible
    playerL = makeHand(new THREE.Color(avatarStyles[styleIdx]?.skin || '#FFDBB4'), true);
    playerR = makeHand(new THREE.Color(avatarStyles[styleIdx]?.skin || '#FFDBB4'), false);

    // Position hands for table interaction at bottom
    playerL.position.set(-0.22, -0.42, -0.58);
    playerR.position.set(0.22, -0.42, -0.58);
    playerL.rotation.x = 0.28;
    playerR.rotation.x = 0.28;

    camera.add(playerL);
    camera.add(playerR);
    scene.add(camera);           // camera must be in scene for children to render
}

// Build a hand mesh group (palm + 4 fingers + thumb + wrist)
function makeHand(color, isLeft) {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 22, specular: new THREE.Color(0x221100) });

    // Palm
    g.add(obj(new THREE.BoxGeometry(0.1, 0.028, 0.11), mat, [0, 0, 0]));
    // Knuckle ridge
    g.add(obj(new THREE.BoxGeometry(0.1, 0.012, 0.018), mat, [0, 0.02, -0.057]));
    // Fingers
    [{ x: -.034, l: .064, w: .018 }, { x: -.011, l: .075, w: .019 }, { x: .013, l: .070, w: .018 }, { x: .036, l: .057, w: .016 }].forEach(f => {
        const fi = obj(new THREE.CylinderGeometry(f.w / 2, f.w / 2 * 1.08, f.l, 6), mat, [f.x, 0, -0.056 - f.l / 2]);
        fi.rotation.x = -0.14;
        g.add(fi);
    });
    // Thumb
    const ts = isLeft ? 0.052 : -0.052;
    const th = obj(new THREE.CylinderGeometry(0.012, 0.015, 0.054, 6), mat, [ts, 0.005, -0.022]);
    th.rotation.z = isLeft ? 0.58 : -0.58;
    th.rotation.x = 0.38;
    g.add(th);
    // Wrist arm stub
    g.add(obj(new THREE.BoxGeometry(0.108, 0.04, 0.09), mat, [0, 0, 0.085]));

    if (isLeft) g.scale.x = -1;
    return g;
}

function obj(geo, mat, [x, y, z]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
}

// ─── Other Users in 3D ────────────────────────────────────────────────────────
function addUserToScene(user, seatIdx) {
    const seat = TABLE_SEATS[seatIdx];
    if (!seat) return;

    const styleIdx = typeof user.avatar === 'number' ? user.avatar : 0;
    const Y = 0.88; // Slightly higher for seated avatar

    // Create chair at seating position
    const chair = makeChair();
    chair.position.set(seat.x, Y - 0.18, seat.z);
    chair.rotation.y = seat.ry;
    scene.add(chair);

    // Create full-body seated avatar
    const body = makeFullBody(styleIdx);
    body.position.set(seat.x, Y, seat.z + 0.08);
    body.rotation.y = seat.ry + Math.PI; // Face toward table center
    scene.add(body);

    // Name sprite positioned above player's head
    const ns = makeNameSprite(user.name);
    ns.position.set(seat.x, Y + 0.65, seat.z + 0.04);
    scene.add(ns);

    // Keep hands for compatibility with eat/drink animations
    const skinHex = avatarStyles[styleIdx]?.skin || '#F5CBA7';
    const skin = new THREE.Color(skinHex);
    const lh = makeHand(skin, true);
    const rh = makeHand(skin, false);

    lh.position.set(seat.x - 0.12, Y - 0.18, seat.z + 0.1);
    rh.position.set(seat.x + 0.12, Y - 0.18, seat.z + 0.1);
    lh.rotation.set(0.42, seat.ry, 0);
    rh.rotation.set(0.42, seat.ry, 0);
    scene.add(lh);
    scene.add(rh);

    // Store all mesh references
    otherMeshes[user.id] = { lh, rh, head: body, chair, ns };
}

function removeUserFromScene(userId) {
    const m = otherMeshes[userId];
    if (!m) return;
    [m.lh, m.rh, m.head, m.chair, m.ns].forEach(o => scene.remove(o));
    delete otherMeshes[userId];
}

// Small cartoon head made of Three.js geometry
function makeUserHead(styleIdx) {
    const s = avatarStyles[styleIdx] || avatarStyles[0];
    const g = new THREE.Group();
    const skinMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.skin), shininess: 14 });
    const hairMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.hair), shininess: 8 });
    // Use bodyTop for upper body, fallback to body or bodyTop for consistency
    const bodyMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.bodyTop || s.body || '#667eea'), shininess: 10 });

    // Head - larger sphere for 3D anime-style proportions
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), skinMat);
    head.castShadow = true;
    g.add(head);
    
    // Hair cap - enhanced for anime style
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.114, 14, 12, 0, Math.PI * 2, 0, Math.PI * .48), hairMat);
    hair.position.y = 0.02;
    hair.castShadow = true;
    g.add(hair);
    
    // Hair sides/back for more volume
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.108, 10, 8, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6), hairMat);
    hairBack.position.y = -0.01;
    hairBack.position.z = -0.04;
    hairBack.castShadow = true;
    g.add(hairBack);
    
    // Eyes - larger and more expressive for anime look
    [-0.042, 0.042].forEach(x => {
        const eyeWhite = obj(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), [x, 0.022, 0.105]);
        const pupil = obj(new THREE.SphereGeometry(0.01, 8, 8), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }), [x, 0.018, 0.107]);
        g.add(eyeWhite);
        g.add(pupil);
    });
    
    // Highlight for eyes (anime sparkle)
    [-0.042, 0.042].forEach(x => {
        const highlight = obj(new THREE.SphereGeometry(0.004, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), [x - 0.004, 0.032, 0.108]);
        g.add(highlight);
    });
    
    // Nose (subtle)
    const nose = obj(new THREE.ConeGeometry(0.008, 0.025, 6), new THREE.MeshPhongMaterial({ color: new THREE.Color(s.skin).multiplyScalar(0.85) }), [0, 0.008, 0.105]);
    nose.rotation.x = Math.PI / 2;
    g.add(nose);
    
    // Mouth
    const mouth = obj(new THREE.BoxGeometry(0.022, 0.008, 0.01), new THREE.MeshPhongMaterial({ color: 0xff6b9d }), [0, -0.008, 0.105]);
    g.add(mouth);
    
    // Body (torso extension for full-body proportions)
    const body = obj(new THREE.BoxGeometry(0.14, 0.16, 0.09), bodyMat, [0, -0.21, 0]);
    body.castShadow = true;
    g.add(body);

    return g;
}

// Distant environment buildings and palm trees
function buildDistantEnvironment() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a0f35 });
    
    // Distant buildings - varying heights
    const buildings = [
        { x: -25, z: -35, w: 3, h: 4 },
        { x: -18, z: -40, w: 2.5, h: 3.5 },
        { x: -8, z: -42, w: 3.2, h: 4.2 },
        { x: 8, z: -40, w: 2.8, h: 3.8 },
        { x: 22, z: -36, w: 3, h: 4 }
    ];
    
    buildings.forEach(b => {
        const building = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 1.5), mat);
        building.position.set(b.x, b.h / 2, b.z);
        scene.add(building);
    });
    
    // Palm trees - trunks and fronds
    const palmPositions = [
        { x: -32, z: -45 },
        { x: -2, z: -50 },
        { x: 20, z: -48 },
        { x: 35, z: -42 }
    ];
    
    palmPositions.forEach(p => {
        // Trunk
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 8, 8), mat);
        trunk.position.set(p.x, 4, p.z);
        scene.add(trunk);
        
        // Fronds - green canopy
        const frondMat = new THREE.MeshBasicMaterial({ color: 0x2d5016 });
        const fronds = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), frondMat);
        fronds.position.set(p.x, 9.2, p.z);
        scene.add(fronds);
    });
}

// Canvas-texture name sprite
function makeNameSprite(name) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1a0a2e';
    ctx.beginPath(); ctx.roundRect(3, 3, 250, 58, 28); ctx.fill();
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(3, 3, 250, 58, 28); ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 26px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name.substring(0, 16), 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(0.52, 0.13, 1);
    return sp;
}

// ─── Animation Loop ───────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Candle flame flicker
    if (candleFlame) {
        candleFlame.scale.y = 0.85 + Math.sin(t * 9.1) * 0.18;
        candleFlame.scale.x = 0.85 + Math.cos(t * 8.3) * 0.14;
        candleFlame.material.color.setHSL(0.08 + Math.sin(t * 7) * 0.03, 1, 0.6 + Math.sin(t * 11) * 0.08);
    }
    if (candleLight) candleLight.intensity = 2.0 + Math.sin(t * 10.5) * 0.5;
    if (lanternLight) lanternLight.intensity = 1.2 + Math.sin(t * 1.8) * 0.25;

    // Player hand idle float
    if (playerL && playerR) {
        const bob = Math.sin(t * 1.6) * 0.004;
        playerL.position.y = -0.42 + bob;
        playerR.position.y = -0.42 - bob;
    }

    // Eating animation
    if (handAnim.eating) {
        handAnim.t += 0.022;
        const ease = Math.sin(Math.min(handAnim.t, Math.PI));
        if (playerR) {
            playerR.position.y = -0.42 + ease * 0.28;
            playerR.position.z = -0.58 - ease * 0.08;
        }
        if (handAnim.t >= Math.PI) {
            handAnim.eating = false; handAnim.t = 0;
            if (playerR) { playerR.position.set(0.22, -0.42, -0.58); playerR.rotation.x = 0.28; }
        }
    }

    // Drinking animation
    if (handAnim.drinking) {
        handAnim.t += 0.018;
        const ease = Math.sin(Math.min(handAnim.t, Math.PI));
        if (playerR) {
            playerR.position.y = -0.42 + ease * 0.22;
            playerR.rotation.x = 0.28 - ease * 0.9;
        }
        if (handAnim.t >= Math.PI) {
            handAnim.drinking = false; handAnim.t = 0;
            if (playerR) { playerR.position.set(0.22, -0.42, -0.58); playerR.rotation.x = 0.28; }
        }
    }

    // Other users gentle idle
    let idx = 0;
    Object.values(otherMeshes).forEach(({ lh, rh }) => {
        const off = idx * 1.4;
        const bump = Math.sin(t * 1.3 + off) * 0.004;
        if (lh) lh.position.y = 0.905 + bump;
        if (rh) rh.position.y = 0.905 - bump;
        idx++;
    });

    // ── FOV smooth lerp (view mode) ──
    if (camera && Math.abs(camera.fov - fovTarget) > 0.1) {
        camera.fov += (fovTarget - camera.fov) * 0.06;
        camera.updateProjectionMatrix();
    }

    // ── Speaking ring pulse ──
    if (speakRing && speakRing.visible) {
        speakRing.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 12) * 0.08);
    }

    // ── Dynamic Sky (Sunset) ──
    const remainingSeconds = getRemainingSeconds();
    if (remainingSeconds < 120 && remainingSeconds > 0) { // Last 2 mins
        const t_sky = 1 - (remainingSeconds / 120);
        const skyColor = new THREE.Color(0x06021a).lerp(new THREE.Color(0x2a1040), t_sky * 0.5);
        scene.background = skyColor;
        scene.fog.color = skyColor;
        if (ambientLight) ambientLight.intensity = 0.5 + t_sky * 0.2;
    }

    // ── Viewport following lerp ──
    if (camera) {
        currRotX += (targetRotX - currRotX) * 0.1;
        currRotY += (targetRotY - currRotY) * 0.1;

        // Reset rotation then apply currRot
        camera.rotation.set(0, 0, 0);
        // Start with original lookAt tilt (approx -0.27 rad)
        camera.rotateX(-0.27 + currRotX);
        camera.rotateY(currRotY);
    }

    renderer.render(scene, camera);
}

// ─── Speaking Ring ────────────────────────────────────────────────────────────
function buildSpeakRing() {
    const geo = new THREE.TorusGeometry(0.14, 0.007, 8, 36);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85 });
    speakRing = new THREE.Mesh(geo, mat);
    speakRing.position.set(0, -0.39, -0.56);
    speakRing.rotation.x = Math.PI / 2;
    speakRing.visible = false;
    camera.add(speakRing);
}

// ─── Voice Chat ───────────────────────────────────────────────────────────────
async function toggleMic() {
    if (!voiceChat) return;
    
    if (voiceChat.isMicrophoneEnabled()) {
        await disableVoiceChat();
    } else {
        await enableVoiceChat();
    }
}

async function enableVoiceChat() {
    if (!voiceChat) return;
    
    if (!navigator.mediaDevices) {
        addMessage('System', '❌ Mic error: Use HTTPS or localhost for voice chat (Secure Context required).', false);
        return;
    }

    try {
        const success = await voiceChat.enableMicrophone();
        if (success) {
            addMessage('System', '🎤 Microphone ON — starting voice connections', false);
        } else {
            addMessage('System', '❌ Failed to enable microphone', false);
        }
    } catch (err) {
        addMessage('System', `❌ Mic error: ${err.message}`, false);
    }
}

async function disableVoiceChat() {
    if (!voiceChat) return;
    
    try {
        await voiceChat.disableMicrophone();
        addMessage('System', '🔇 Microphone OFF', false);
    } catch (err) {
        console.error('Error disabling voice chat:', err);
    }
}

function updateMicBtn() {
    if (!voiceChat) return;
    
    const btn = document.getElementById('micBtn');
    if (!btn) return;
    
    const isMicOn = voiceChat.isMicrophoneEnabled();
    const isSpeaking = voiceChat.isUserSpeaking();
    
    if (!isMicOn) {
        btn.textContent = '🎤 Mic Off';
        btn.classList.remove('mic-on', 'mic-speaking');
    } else if (isSpeaking) {
        btn.textContent = '🎙 Speaking…';
        btn.classList.add('mic-on', 'mic-speaking');
    } else {
        btn.textContent = '🎤 Mic On';
        btn.classList.add('mic-on');
        btn.classList.remove('mic-speaking');
    }
    
    // Update 3D visual indicator
    if (speakRing) {
        speakRing.visible = isSpeaking;
    }
}

function getRemainingSeconds() {
    const now = new Date();
    const [h, m] = IFTAR_TIME.split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    return Math.floor((target - now) / 1000);
}

// ─── View Mode ────────────────────────────────────────────────────────────────
function cycleView() {
    viewModeIdx = (viewModeIdx + 1) % VIEW_MODES.length;
    const mode = VIEW_MODES[viewModeIdx];
    fovTarget = mode.fov;
    const btn = document.getElementById('viewBtn');
    if (btn) btn.textContent = VIEW_MODES[(viewModeIdx + 1) % VIEW_MODES.length].label;
    addMessage('System', `📷 View: ${mode.name} (${mode.fov}°)`, false);
}
// ─── User Management ──────────────────────────────────────────────────────────
function addUser(user) {
    if (users.find(u => u.id === user.id)) return;
    users.push(user);
    if (scene) {
        const otherUsers = users.filter(u => u.id !== currentUser?.id);
        const seatIdx = otherUsers.indexOf(user);
        addUserToScene(user, seatIdx);
    }
}
// ─── Chat ─────────────────────────────────────────────────────────────────────
function generateMessageId() {
    return 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function sendMessage() {
    let msg = messageInput.value.trim();
    if (!msg && !pendingFile && !replyToMessageId) return; // allow sending file or reply if no text
    if (!currentUser) return;

    const message = {
        id: generateMessageId(),
        senderId: currentUser.id,
        sender: currentUser.name,
        text: msg || '',
        timestamp: Date.now(),
        type: pendingFile ? 'file' : 'text',
        fileData: pendingFile ? pendingFile.data : undefined,
        fileName: pendingFile ? pendingFile.name : undefined,
        parentId: replyToMessageId || null,
        reactions: {}
    };

    socket.emit('chat', message);
    handleIncomingMessage(message, true);

    messageInput.value = '';
    pendingFile = null;
    replyToMessageId = null;
}

// store pending file before send
let pendingFile = null;

function handleIncomingMessage(data, isLocal=false) {
    // ignore if already in history
    if (chatHistory.find(m => m.id === data.id)) return;
    chatHistory.push(data);
    if (searchFilter && !data.text.toLowerCase().includes(searchFilter.toLowerCase()) && !data.sender.toLowerCase().includes(searchFilter.toLowerCase())) {
        // message does not match current search - skip rendering
    } else {
        renderMessage(data);
    }
    if (!isLocal && chatPopup.classList.contains('hidden')) {
        newMessageSound.play();
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChat() {
    chatMessages.innerHTML = '';
    chatHistory.forEach(msg => {
        if (searchFilter) {
            const txt = msg.text || '';
            if (!txt.toLowerCase().includes(searchFilter.toLowerCase()) && !msg.sender.toLowerCase().includes(searchFilter.toLowerCase())) return;
        }
        renderMessage(msg);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderMessage(msg) {
    const el = document.createElement('div');
    el.dataset.id = msg.id;
    const own = msg.senderId === currentUser?.id;
    el.className = 'message ' + (own ? 'own' : 'other') + (msg.parentId ? ' reply' : '');

    // avatar
    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    let avatarUrl = '';
    const user = users.find(u => u.id === msg.senderId);
    if (user) {
        if (typeof user.avatar === 'string' && user.avatar.startsWith('data:')) avatarUrl = user.avatar;
        else if (typeof user.avatar === 'number') avatarUrl = ''; // our cartoon style; skip
    }
    if (avatarUrl) avatarEl.style.backgroundImage = `url(${avatarUrl})`;
    el.appendChild(avatarEl);

    const content = document.createElement('div');
    content.className = 'content';
    // header with name and timestamp
    const hdr = document.createElement('div');
    hdr.className = 'msg-header';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'sender';
    nameSpan.textContent = msg.sender;
    hdr.appendChild(nameSpan);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    hdr.appendChild(timeSpan);
    content.appendChild(hdr);

    // message body
    const body = document.createElement('div');
    body.className = 'text';
    let text = escapeHtml(msg.text || '');
    // mention highlighting
    text = text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    if (msg.type === 'file' && msg.fileData) {
        const link = document.createElement('a');
        link.href = msg.fileData;
        link.target = '_blank';
        link.textContent = msg.fileName || 'attachment';
        body.appendChild(link);
        if (text) {
            body.insertAdjacentHTML('beforeend', `<div>${text}</div>`);
        }
    } else {
        body.innerHTML = text;
    }
    content.appendChild(body);

    // controls (react / delete)
    const ctrl = document.createElement('div');
    ctrl.className = 'msg-controls';
    const reactBtn = document.createElement('button');
    reactBtn.className = 'react-btn';
    reactBtn.textContent = '😊';
    reactBtn.addEventListener('click', () => showEmojiPicker(msg.id));
    ctrl.appendChild(reactBtn);
    // reply button available to everyone
    const replyBtn = document.createElement('button');
    replyBtn.className = 'react-btn';
    replyBtn.textContent = '↩️';
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', () => {
        replyToMessageId = msg.id;
        messageInput.focus();
        messageInput.placeholder = `Replying to ${msg.sender}...`;
    });
    ctrl.appendChild(replyBtn);
    if (own) {
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', () => deleteMessage(msg.id));
        ctrl.appendChild(delBtn);
    }
    content.appendChild(ctrl);

    el.appendChild(content);

    // if message has reactions
    if (msg.reactions && Object.keys(msg.reactions).length) {
        const reactBar = document.createElement('div');
        reactBar.className = 'reaction-bar';
        for (const [emoji, usersObj] of Object.entries(msg.reactions)) {
            const span = document.createElement('span');
            span.className = 'reaction';
            span.textContent = `${emoji} ${Object.keys(usersObj).length}`;
            reactBar.appendChild(span);
        }
        el.appendChild(reactBar);
    }

    // clicking message copies text
    el.addEventListener('click', () => {
        if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {});
    });

    chatMessages.appendChild(el);
}

function deleteMessage(id) {
    // remove locally and notify server
    chatHistory = chatHistory.filter(m => m.id !== id);
    const el = chatMessages.querySelector(`div[data-id="${id}"]`);
    if (el) el.remove();
    socket.emit('delete-message', { id });
}

function searchMessages(term) {
    searchFilter = term;
    renderChat();
}

function showEmojiPicker(messageId) {
    // simple built-in choice prompt for demonstration
    const emoji = prompt('Enter emoji to react with (e.g. 👍, ❤️)');
    if (!emoji) return;
    socket.emit('reaction', { messageId, userId: currentUser.id, emoji });
}

function updateTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (!el) return;
    if (typingUsers.size === 0) {
        el.textContent = '';
    } else {
        el.textContent = Array.from(typingUsers).join(', ') + ' is typing...';
    }
}

function handleReaction(data) {
    const msg = chatHistory.find(m => m.id === data.messageId);
    if (!msg) return;
    msg.reactions = msg.reactions || {};
    if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = {};
    msg.reactions[data.emoji][data.userId] = true;
    renderChat();
}

// file attachment helper
const chatFileInput = document.getElementById('chatFileInput');
if (chatFileInput) {
    chatFileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            pendingFile = { data: ev.target.result, name: file.name };
            messageInput.placeholder = 'File ready to send...';
        };
        reader.readAsDataURL(file);
    });
}

// event listeners for chat search, typing, etc will be added in setupEventListeners below

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ─── Timer / Ifthar ───────────────────────────────────────────────────────────
function startCountdown() { updateTimer(); setInterval(updateTimer, 1000); }

function updateTimer() {
    const now = new Date();
    const [h, m] = IFTAR_TIME.split(':').map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    const diff = target - now;
    if (diff <= 0) { if (!iftharStarted) startIfthar(); timerElement.textContent = 'Ifthar Time!'; return; }
    const hh = Math.floor(diff / 3600000), mm = Math.floor((diff % 3600000) / 60000), ss = Math.floor((diff % 60000) / 1000);
    timerElement.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function startIfthar() {
    iftharStarted = true;
    iftharActions.classList.remove('hidden');
    addMessage('System', '🎉 Iftar time! Time to break the fast together!', false);
    // Intensify lights
    if (candleLight) candleLight.intensity = 3.5;
    if (lanternLight) lanternLight.intensity = 2.5;
}

// ─── Actions ──────────────────────────────────────────────────────────────────
function eatFood() {
    if (!currentUser || handAnim.eating || handAnim.drinking) return;
    currentUser.plateEaten = true;
    handAnim.eating = true; handAnim.t = 0;
    if (navigator.vibrate) navigator.vibrate(50);

    socket.emit('action', {
        userId: currentUser.id,
        type: 'eat'
    });

    addMessage('System', `${currentUser.name} ate a date 🌴`, false);
    eatDateButton.disabled = true;
    eatDateButton.textContent = 'Date Eaten ✓';
}

function drinkWater() {
    if (!currentUser || handAnim.eating || handAnim.drinking) return;
    currentUser.glassDrank = true;
    handAnim.drinking = true; handAnim.t = 0;
    if (navigator.vibrate) navigator.vibrate([30, 30, 30]);

    socket.emit('action', {
        userId: currentUser.id,
        type: 'drink'
    });

    addMessage('System', `${currentUser.name} drank water 💧`, false);
    drinkWaterBtn.disabled = true;
    drinkWaterBtn.textContent = 'Water Drank ✓';
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
    if (voiceChat) {
        await voiceChat.cleanup();
    }
});