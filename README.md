# Virtual Ifthar Table

A simple multiplayer website where Muslims and non-Muslims can join a virtual ifthar table to share the iftar experience together online.

## Features

- **Immersive 3D Design**: Beautiful 3D environment with dynamic lighting and perspective.
- **Avatar System**: Choose from various cartoon-style avatars (3D rendered heads).
- **Virtual Table**: See other users as avatars sitting around a 3D round table.
- **Real-time Chat**: Integrated chat popup for instant communication.
- **Voice Chat Support**: Real-time peer-to-peer voice communication using WebRTC:
  - Microphone control with enable/disable functionality
  - Voice Activity Detection (VAD) with visual feedback
  - Speaking indicators for all users
  - Low-latency audio streaming
  - Echo cancellation and noise suppression
  - Browser compatibility with modern browsers
- **Iftar Countdown**: Live timer showing time until iftar.
- **Interactive Experience**: Click to eat dates and drink water with smooth animations.
- **Voice Connection Status**: Visual indicator showing active voice chat connections.

## How to Use

1. Ensure you have Node.js installed.
2. Run `npm start` (or `node server.js`) in the project directory.
3. Open your browser and navigate to **`http://localhost:3000`** (or `https://` for production).
4. Enter your name and select an avatar.
5. Click **"Join Table"** to see everyone in 3D.
6. Use the **"Chat"** button to send text messages to others.
7. Click the **"🎤 Mic"** button to enable voice chat:
   - Button shows **"🎤 Mic Off"** (disabled)
   - Button shows **"🎤 Mic On"** (enabled, not speaking)
   - Button shows **"🎙 Speaking…"** (enabled, currently speaking)
8. When your microphone is active, others will hear you speak in real-time.
9. Voice activity is detected automatically and shown with visual indicators.

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

### Voice Chat Requirements

Voice chat requires:
- **HTTPS or localhost** (Secure Context required by browser security policy)
- **Microphone permissions** granted by the user
- **Modern browser** with WebRTC support (Chrome, Firefox, Safari 11+, Edge)
- **Stable internet connection** for low-latency audio streaming