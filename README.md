# Virtual Ifthar Table

A simple multiplayer website where Muslims and non-Muslims can join a virtual ifthar table to share the iftar experience together online.

## Features

- **Immersive 3D Design**: Beautiful 3D environment with dynamic lighting and perspective.
- **Avatar System**: Choose from various cartoon-style avatars (3D rendered heads).
- **Virtual Table**: See other users as avatars sitting around a 3D round table.
- **Real-time Chat**: Integrated chat popup for instant communication.
- **Iftar Countdown**: Live timer showing time until iftar.
- **Interactive Experience**: Click to eat dates and drink water with smooth animations.
- **Voice Chat Support**: Real-time voice activity detection (requires secure context).

## How to Use

1. Ensure you have Node.js installed.
2. Run `npm start` (or `node server.js`) in the project directory.
3. Open your browser and navigate to **`http://localhost:3000`**.
4. Enter your name and select an avatar.
5. Click **"Join Table"** to see everyone in 3D.
6. Use the **"Chat"** button to talk to others.

## Technology

- **Frontend**: HTML5, Vanilla CSS, Three.js (for 3D graphics)
- **Backend**: Node.js, Express, Socket.io (for real-time multiplayer)
- **Responsive**: Dynamic FOV and layout for mobile and desktop support.

## Customization

You can modify:
- **Iftar time**: Change the `IFTAR_TIME` constant in `script.js`
- **Avatars**: Edit the `avatars` array in `script.js`
- **Styling**: Modify `style.css` for colors and layout
- **Maximum users**: Change the `MAX_USERS` constant in `script.js`

## Demo Mode

The website includes demo users that automatically join to simulate a multiplayer experience. In a real implementation, you would connect to a WebSocket server or Firebase for actual multiplayer functionality.

## Browser Support

Works in all modern browsers:
- Chrome
- Firefox
- Safari
- Edge
- Mobile browsers

Simply open the `index.html` file in your browser to start using the Virtual Ifthar Table!