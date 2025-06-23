import tmi from 'tmi.js';

let client = null;

// --- DOM ELEMENTS ---
const chatMessagesDiv = document.getElementById('chat-messages');

/**
 * Displays a chat message in the UI.
 * @param {string} username - The user who sent the message.
 * @param {string} message - The message content.
 * @param {object} tags - tmi.js message tags, used for coloring the username.
 */
function addChatMessage(username, message, tags) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    const userElement = document.createElement('span');
    userElement.classList.add('username');
    userElement.textContent = username;
    // Use the color from Twitch, or a default if not available
    userElement.style.color = tags.color || '#BF94FF'; 

    const messageContent = document.createElement('span');
    messageContent.textContent = `: ${message}`;

    messageElement.appendChild(userElement);
    messageElement.appendChild(messageContent);
    
    // Prepend so it appears at the top before the flex-direction: column-reverse kicks in
    chatMessagesDiv.prepend(messageElement); 
    
    // Keep the chat box from overflowing
    while (chatMessagesDiv.children.length > 100) {
        chatMessagesDiv.removeChild(chatMessagesDiv.lastChild);
    }
}

/**
 * Connects to Twitch chat and sets up handlers.
 * @param {string} channel - The Twitch channel to connect to.
 * @param {function} commandHandler - A function to call when a command is received.
 * @param {function} statusCallback - A function to call with connection status updates.
 */
export function connectToTwitch(channel, commandHandler, statusCallback) {
    // Disconnect any existing client
    if (client && client.readyState() === 'OPEN') {
        client.disconnect();
    }
    
    statusCallback(`Connecting to #${channel}...`);

    const options = {
        connection: {
            secure: true,
            reconnect: true
        },
        channels: [channel]
    };
    
    client = new tmi.Client(options);

    // --- TMI.JS EVENT HANDLERS ---

    // Called every time a message comes in
    client.on('message', (ch, tags, message, self) => {
        if (self) return; // Ignore messages from the bot

        addChatMessage(tags['display-name'], message, tags);

        // Check if the message is a command (starts with '!')
        if (message.startsWith('!')) {
            const [command, ...args] = message.substring(1).split(/\s+/);
            if (command.length > 0 && commandHandler) {
                // Pass the command and user info to the application logic
                commandHandler(command.toLowerCase(), tags['display-name'], args, tags);
            }
        }
    });

    // Called when successfully connected
    client.on('connected', (addr, port) => {
        statusCallback(`Connected to #${channel}`);
    });

    // Called on disconnection
    client.on('disconnected', (reason) => {
        statusCallback(`Disconnected: ${reason || 'Unknown reason'}`);
    });
    
    // Make the connection
    client.connect().catch(err => {
        console.error("Connection error:", err);
        statusCallback(`Error connecting: ${err}`);
    });
}

