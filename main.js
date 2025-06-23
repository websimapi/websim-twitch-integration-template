import { connectToTwitch } from './twitch-chat.js';

// --- DOM ELEMENTS ---
const connectButton = document.getElementById('connect-button');
const channelInput = document.getElementById('channel-input');
const statusDiv = document.getElementById('connection-status');
const commandLogDiv = document.getElementById('command-log');

// --- APPLICATION LOGIC ---

/**
 * This is the heart of your application's interaction with Twitch.
 * It gets called every time a message starting with '!' is sent in the connected chat.
 * 
 * @param {string} command - The command sent, without the '!'.
 * @param {string} user - The username of the person who sent the command.
 * @param {string[]} args - An array of arguments that followed the command.
 * @param {object} message - The full message object from tmi.js, for advanced use.
 */
function handleCommand(command, user, args, message) {
    const logMessage = `[${new Date().toLocaleTimeString()}] Command '${command}' from ${user}. Args: [${args.join(', ')}]`;
    console.log(logMessage);
    
    // Display the command in the on-page log
    const logEntry = document.createElement('div');
    logEntry.textContent = logMessage;
    commandLogDiv.appendChild(logEntry);
    commandLogDiv.scrollTop = commandLogDiv.scrollHeight; // Auto-scroll
    
    // --- YOUR CUSTOM COMMAND LOGIC GOES HERE ---
    // Example:
    switch (command) {
        case 'hello':
            console.log(`Hello ${user}!`);
            break;
        case 'roll':
            const dieRoll = Math.floor(Math.random() * (parseInt(args[0]) || 6)) + 1;
            console.log(`${user} rolled a ${dieRoll}`);
            break;
        // Add more cases for your commands
    }
}

/**
 * This function is called when the connection status changes.
 * @param {string} status - The new connection status (e.g., "Connecting...", "Connected", "Disconnected").
 */
function updateStatus(status) {
    statusDiv.textContent = `Status: ${status}`;
    console.log(status);
}

// --- EVENT LISTENERS ---

connectButton.addEventListener('click', () => {
    const channel = channelInput.value.trim().toLowerCase();
    if (channel) {
        // The core connection call.
        // Pass our application-specific handlers to the Twitch module.
        connectToTwitch(channel, handleCommand, updateStatus);
    } else {
        alert("Please enter a channel name.");
    }
});

