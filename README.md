# Virtual Ifthar Table

A simple multiplayer website where Muslims and non-Muslims can join a virtual ifthar table to share the iftar experience together online.

## Features

- **Simple 2D Design**: Low graphics, fast loading, mobile and PC compatible
- **Avatar System**: Choose from various cartoon-style avatars
- **Virtual Table**: See other users as avatars sitting around a round table
- **Real-time Chat**: Send and receive messages instantly
- **Iftar Countdown**: Timer showing time until iftar
- **Interactive Experience**: Click to eat dates and drink water at iftar time

## How to Use

1. Open `index.html` in any web browser
2. Enter your name
3. Select an avatar
4. Click "Join Table"
5. You'll see other users around the virtual table
6. Use the chat to communicate with others
7. When the countdown reaches zero, you can click "Eat Date" and "Drink Water"

## Technology

- **Frontend**: HTML, CSS, JavaScript
- **No external dependencies**: Works completely offline
- **Responsive design**: Works on mobile and desktop

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