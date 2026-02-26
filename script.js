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

// ─── Avatar Styles ────────────────────────────────────────────────────────────
const avatarStyles = [
    { skin: '#FFDBB4', hair: '#2C1810', body: '#667eea', hairStyle: 'short', accessory: '' },
    { skin: '#F5CBA7', hair: '#4A3728', body: '#e74c3c', hairStyle: 'long', accessory: '' },
    { skin: '#C68642', hair: '#1A1A1A', body: '#27ae60', hairStyle: 'curly', accessory: '' },
    { skin: '#8D5524', hair: '#3D2B1F', body: '#f39c12', hairStyle: 'bun', accessory: 'hijab' },
    { skin: '#FDDBB4', hair: '#C8A96E', body: '#9b59b6', hairStyle: 'long', accessory: '' },
    { skin: '#FFE0BD', hair: '#A0522D', body: '#1abc9c', hairStyle: 'short', accessory: 'glasses' },
    { skin: '#D4956A', hair: '#2C1810', body: '#e67e22', hairStyle: 'curly', accessory: 'headband' },
    { skin: '#FDDBB4', hair: '#4A3728', body: '#2980b9', hairStyle: 'none', accessory: 'hat' },
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

// ─── View Mode State ──────────────────────────────────────────────────────────
const VIEW_MODES = [
    { label: '👁 Normal', fov: 68, name: 'Normal' },
    { label: '🔭 Wide', fov: 110, name: 'Wide' },
    { label: '🌐 180°', fov: 150, name: 'Panoramic' },
];
let viewModeIdx = 0;
let fovTarget = 68;

// View rotation tracking
let targetRotX = 0;
let targetRotY = 0;
let currRotX = 0;
let currRotY = 0;
const ROT_SENSITIVITY = 0.4;
const ROT_LIMIT_X = 0.3; // Approx 17 degrees up/down
const ROT_LIMIT_Y = 0.6; // Approx 34 degrees left/right

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

    // Load persisted data
    const savedName = localStorage.getItem('ifthar_name');
    const savedAvatar = localStorage.getItem('ifthar_avatar');
    if (savedName) usernameInput.value = savedName;
    if (savedAvatar) selectedAvatar = JSON.parse(savedAvatar);

    generateAvatarOptions();
    setupEventListeners();
    startCountdown();
}

// ─── Avatar Picker (CSS cartoon, same as before) ──────────────────────────────
function generateAvatarOptions() {
    avatarSel.innerHTML = '';
    avatarStyles.forEach((style, i) => {
        const el = document.createElement('div');
        el.className = 'avatar-option' + (selectedAvatar === i ? ' selected' : '');
        el.innerHTML = buildCartoonHTML(style);
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

function buildCartoonHTML(s) {
    let h = '';
    if (s.hairStyle === 'short') h = `<div class="ch-hair ch-hair-short" style="background:${s.hair}"></div>`;
    else if (s.hairStyle === 'long') h = `<div class="ch-hair ch-hair-long" style="background:${s.hair}"></div><div class="ch-hair-side" style="background:${s.hair}"></div>`;
    else if (s.hairStyle === 'curly') h = `<div class="ch-hair ch-hair-curly" style="background:${s.hair}"></div>`;
    else if (s.hairStyle === 'bun') h = `<div class="ch-hair ch-hair-bun" style="background:${s.hair}"></div>`;
    let a = '';
    if (s.accessory === 'glasses') a = `<div class="ch-glasses"><span></span><span></span></div>`;
    else if (s.accessory === 'hijab') { a = `<div class="ch-hijab" style="background:${s.body}"></div>`; h = ''; }
    else if (s.accessory === 'hat') { a = `<div class="ch-hat" style="background:${s.body}"><div class="ch-hat-brim"></div></div>`; h = ''; }
    else if (s.accessory === 'headband') a = `<div class="ch-headband" style="background:${s.body}"></div>`;
    return `<div class="cartoon-char"><div class="ch-head" style="background:${s.skin}">${h}${a}<div class="ch-face"><div class="ch-eyes"><div class="ch-eye"><div class="ch-pupil"></div></div><div class="ch-eye"><div class="ch-pupil"></div></div></div><div class="ch-mouth"></div><div class="ch-cheeks"><div class="ch-cheek"></div><div class="ch-cheek"></div></div></div><div class="ch-ear ch-ear-l" style="background:${s.skin}"></div><div class="ch-ear ch-ear-r" style="background:${s.skin}"></div></div><div class="ch-body" style="background:${s.body}"><div class="ch-body-shine"></div></div></div>`;
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
        if (currentUser) {
            targetRotY = -(e.clientX / window.innerWidth - 0.5) * 2 * ROT_LIMIT_Y;
            targetRotX = -(e.clientY / window.innerHeight - 0.5) * 2 * ROT_LIMIT_X;
        }
    });

    window.addEventListener('touchmove', e => {
        if (currentUser && e.touches.length > 0) {
            const touch = e.touches[0];
            targetRotY = -(touch.clientX / window.innerWidth - 0.5) * 2 * ROT_LIMIT_Y;
            targetRotX = -(touch.clientY / window.innerHeight - 0.5) * 2 * ROT_LIMIT_X;
        }
    }, { passive: false });
}

function toggleChat() {
    chatPopup.classList.toggle('hidden');
    chatToggleBtn.classList.toggle('hidden');

    // Focus input if opening
    if (!chatPopup.classList.contains('hidden')) {
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
        } else {
            // We joined successfully
            addMessage('System', `Welcome ${user.name} to the Virtual Ifthar Table! 🌙`, false);
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
        if (data.senderId !== currentUser?.id) {
            addMessage(data.sender, data.text, false);
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
}

function removeUser(userId) {
    users = users.filter(u => u.id !== userId);
    removeUserFromScene(userId);
    const msg = "Someone left the table"; // We could track names if needed
    // addMessage('System', msg, false);
}

// ─── Three.js Scene ───────────────────────────────────────────────────────────
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06021a);
    scene.fog = new THREE.FogExp2(0x06021a, 0.055);

    camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.01, 60);
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
    // Starfield
    const n = 600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - .5) * 40;
        pos[i * 3 + 1] = Math.random() * 18 + 3;
        pos[i * 3 + 2] = (Math.random() - .5) * 40;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, sizeAttenuation: true })));

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshPhongMaterial({ color: 0x100826 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Moon sphere
    const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0xffe8b0 })
    );
    moonMesh.position.set(-6, 9, -14);
    scene.add(moonMesh);
    const mg = new THREE.Mesh(new THREE.SphereGeometry(1.3, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0xffe8b0, transparent: true, opacity: 0.12 }));
    mg.position.copy(moonMesh.position);
    scene.add(mg);

    // Distant mosque silhouette
    buildMosqueSilhouette();
}

function buildMosqueSilhouette() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x120630 });
    // Main dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.set(-8, 1.5, -18);
    scene.add(dome);
    // Minaret left
    const min1 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 5, 8), mat);
    min1.position.set(-9.8, 2.5, -18);
    scene.add(min1);
    const tip1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 8), mat);
    tip1.position.set(-9.8, 5.4, -18);
    scene.add(tip1);
    // Minaret right
    const min2 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 5, 8), mat);
    min2.position.set(-6.2, 2.5, -18);
    scene.add(min2);
    const tip2 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 8), mat);
    tip2.position.set(-6.2, 5.4, -18);
    scene.add(tip2);
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 1), mat);
    body.position.set(-8, 1, -18);
    scene.add(body);
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

// ─── Player Hands (camera-local) ──────────────────────────────────────────────
function buildPlayerHands() {
    const styleIdx = typeof selectedAvatar === 'number' ? selectedAvatar : 0;
    const skinHex = avatarStyles[styleIdx]?.skin || '#FFDBB4';
    const skin = new THREE.Color(skinHex);

    playerL = makeHand(skin, true);
    playerR = makeHand(skin, false);

    // Position in camera-local space so they appear at bottom of screen
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
    const skinHex = avatarStyles[styleIdx]?.skin || '#F5CBA7';
    const skin = new THREE.Color(skinHex);
    const Y = 0.905;

    // Hands on table surface
    const lh = makeHand(skin, true);
    const rh = makeHand(skin, false);

    lh.position.set(seat.x - 0.12, Y, seat.z + 0.1);
    rh.position.set(seat.x + 0.12, Y, seat.z + 0.1);
    lh.rotation.set(0.42, seat.ry, 0);
    rh.rotation.set(0.42, seat.ry, 0);
    scene.add(lh);
    scene.add(rh);

    // Mini head + body
    const head = makeUserHead(styleIdx);
    head.position.set(seat.x, Y + 0.38, seat.z + 0.06);
    head.rotation.y = seat.ry + Math.PI;
    scene.add(head);

    // Name sprite
    const ns = makeNameSprite(user.name);
    ns.position.set(seat.x, Y + 0.7, seat.z + 0.04);
    scene.add(ns);

    otherMeshes[user.id] = { lh, rh, head, ns };
}

function removeUserFromScene(userId) {
    const m = otherMeshes[userId];
    if (!m) return;
    [m.lh, m.rh, m.head, m.ns].forEach(o => scene.remove(o));
    delete otherMeshes[userId];
}

// Small cartoon head made of Three.js geometry
function makeUserHead(styleIdx) {
    const s = avatarStyles[styleIdx] || avatarStyles[0];
    const g = new THREE.Group();
    const skinMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.skin), shininess: 14 });
    const hairMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.hair) });
    const bodyMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(s.body) });

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), skinMat);
    g.add(head);
    // Hair cap
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.103, 12, 10, 0, Math.PI * 2, 0, Math.PI * .44), hairMat);
    hair.position.y = 0.018;
    g.add(hair);
    // Eyes
    [-0.038, 0.038].forEach(x => {
        const eye = obj(new THREE.SphereGeometry(0.015, 6, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }), [x, 0.018, 0.09]);
        g.add(eye);
    });
    // Body
    const body = obj(new THREE.BoxGeometry(0.13, 0.15, 0.08), bodyMat, [0, -0.19, 0]);
    g.add(body);

    return g;
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
    isMicOn ? stopMic() : await startMic();
}

async function startMic() {
    if (!navigator.mediaDevices) {
        addMessage('System', '❌ Mic error: Use HTTPS or localhost for voice chat (Secure Context required).', false);
        return;
    }
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.7;
        const src = audioCtx.createMediaStreamSource(micStream);
        src.connect(analyserNode);
        isMicOn = true;
        updateMicBtn();
        addMessage('System', '🎤 Microphone ON — others can hear you', false);
        // Voice Activity Detection loop
        const buf = new Uint8Array(analyserNode.frequencyBinCount);
        vadTimer = setInterval(() => {
            analyserNode.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            const talking = avg > 18;
            if (talking !== isSpeaking) {
                isSpeaking = talking;
                if (speakRing) speakRing.visible = talking;
                updateMicBtn();
            }
        }, 80);
    } catch (err) {
        addMessage('System', `❌ Mic error: ${err.message}`, false);
    }
}

function stopMic() {
    clearInterval(vadTimer);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    isMicOn = false; isSpeaking = false;
    if (speakRing) speakRing.visible = false;
    updateMicBtn();
    addMessage('System', '🔇 Microphone OFF', false);
}

function updateMicBtn() {
    const btn = document.getElementById('micBtn');
    if (!btn) return;
    if (!isMicOn) {
        btn.textContent = '🎤 Mic Off';
        btn.classList.remove('mic-on', 'mic-speaking');
    } else if (isSpeaking) {
        btn.textContent = '🎙 Speaking…';
        btn.classList.add('mic-on', 'mic-speaking');
        btn.classList.remove = btn.classList.remove.bind(btn);
    } else {
        btn.textContent = '🎤 Mic On';
        btn.classList.add('mic-on');
        btn.classList.remove('mic-speaking');
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
function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg || !currentUser) return;

    socket.emit('chat', {
        senderId: currentUser.id,
        sender: currentUser.name,
        text: msg
    });

    addMessage(currentUser.name, msg, true);
    messageInput.value = '';
}

function addMessage(sender, text, isOwn) {
    const el = document.createElement('div');
    el.className = `message ${isOwn ? 'own' : 'other'}`;
    el.innerHTML = `<div class="sender">${sender}</div><div class="text">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

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