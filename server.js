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

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            console.log(`${users[socket.id].name} left the table`);
            const userId = users[socket.id].id;
            delete users[socket.id];
            io.emit('user-left', userId);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
