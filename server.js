const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Store users: socket.id -> user object
const users = {};

app.use(express.static(path.join(__dirname, '.')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Send existing users to the new connection
    socket.emit('current-users', Object.values(users));

    socket.on('join', (userData) => {
        // Check if username is already taken (case-insensitive)
        const nameTaken = Object.values(users).some(u =>
            u.name.toLowerCase() === userData.name.trim().toLowerCase() && u.id !== userData.id
        );

        if (nameTaken) {
            socket.emit('join-error', 'This name is already taken. Please choose another one.');
            return;
        }

        // Ensure the ID is stable across reloads if sent by client
        const user = {
            ...userData,
            socketId: socket.id
        };
        users[socket.id] = user;

        console.log(`${user.name} joined the table`);

        // Broadcast to everyone that a new user joined
        io.emit('user-joined', user);
    });

    socket.on('change-name', (newName) => {
        if (!users[socket.id]) return;

        const trimmedName = newName.trim();
        if (!trimmedName || trimmedName.length > 20) {
            socket.emit('name-error', 'Invalid name length (1-20 characters).');
            return;
        }

        const nameTaken = Object.values(users).some(u =>
            u.name.toLowerCase() === trimmedName.toLowerCase() && u.socketId !== socket.id
        );

        if (nameTaken) {
            socket.emit('name-error', 'This name is already taken.');
            return;
        }

        const oldName = users[socket.id].name;
        users[socket.id].name = trimmedName;

        console.log(`${oldName} changed name to ${trimmedName}`);

        // Broadcast the name update
        io.emit('name-updated', {
            userId: users[socket.id].id,
            oldName: oldName,
            newName: trimmedName
        });
    });

    socket.on('chat', (messageData) => {
        // Broadcast message to all clients
        io.emit('chat-message', messageData);
    });

    socket.on('action', (actionData) => {
        // Update server-side state if needed
        if (users[socket.id]) {
            if (actionData.type === 'eat') users[socket.id].plateEaten = true;
            if (actionData.type === 'drink') users[socket.id].glassDrank = true;
        }
        // Broadcast action to all clients
        io.emit('user-action', {
            userId: actionData.userId,
            type: actionData.type
        });
    });

    // ─── Voice Chat Signaling ─────────────────────────────────────────
    socket.on('voice-get-peers', (callback) => {
        // Return list of all other connected users (by userId, not socketId)
        const otherUserIds = Object.values(users)
            .filter(u => u.socketId !== socket.id)
            .map(u => u.id);
        if (callback) callback(otherUserIds);
    });

    socket.on('voice-offer', (data) => {
        // Forward WebRTC offer to target user
        if (data && data.to) {
            socket.to(getSocketIdByUserId(data.to)).emit('voice-offer', {
                from: users[socket.id]?.id,
                data: data.data
            });
        }
    });

    socket.on('voice-answer', (data) => {
        // Forward WebRTC answer to target user
        if (data && data.to) {
            socket.to(getSocketIdByUserId(data.to)).emit('voice-answer', {
                from: users[socket.id]?.id,
                data: data.data
            });
        }
    });

    socket.on('voice-ice-candidate', (data) => {
        // Forward ICE candidate to target user
        if (data && data.to) {
            socket.to(getSocketIdByUserId(data.to)).emit('voice-ice-candidate', {
                from: users[socket.id]?.id,
                data: data.data
            });
        }
    });

    socket.on('voice-status-change', (statusData) => {
        // Update and broadcast voice status
        if (users[socket.id]) {
            users[socket.id].voiceStatus = statusData;
            io.emit('user-voice-status', {
                userId: users[socket.id].id,
                status: statusData
            });
        }
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            console.log(`${users[socket.id].name} left the table`);
            const userId = users[socket.id].id;
            delete users[socket.id];
            io.emit('user-left', userId);
            io.emit('voice-user-left', { userId });
        }
    });
});

// Helper: Get Socket ID by User ID
function getSocketIdByUserId(userId) {
    for (const socketId in users) {
        if (users[socketId].id === userId) {
            return socketId;
        }
    }
    return null;
}

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
