import { connectToTwitch } from './twitch-chat.js';

// --- DOM ELEMENTS ---
const connectButton = document.getElementById('connect-button');
const channelInput = document.getElementById('channel-input');
const statusDiv = document.getElementById('connection-status');
const commandLogDiv = document.getElementById('command-log');
const fullscreenButton = document.getElementById('fullscreen-button');
const iframeViewer = document.getElementById('iframe-viewer');
const websimFrame = document.getElementById('websim-frame');
const closeViewerButton = document.getElementById('close-viewer-button');

// --- IFRAME VIEWER LOGIC ---
const siteQueue = [];
let isDisplayingSite = false;
const SITE_DISPLAY_DURATION = 15 * 1000; // 15 seconds

function processSiteQueue() {
    if (isDisplayingSite || siteQueue.length === 0) {
        return;
    }
    isDisplayingSite = true;
    const url = siteQueue.shift();
    console.log(`Displaying ${url}. Queue length: ${siteQueue.length}`);
    websimFrame.src = url;

    setTimeout(() => {
        isDisplayingSite = false;
        processSiteQueue(); // Process next in queue
    }, SITE_DISPLAY_DURATION);
}

function addSiteToQueue(url) {
    // Basic validation to avoid duplicates and ensure it's a valid http/https URL
    if (url.startsWith('http') && !siteQueue.includes(url)) {
        siteQueue.push(url);
        console.log(`Added ${url} to queue.`);
        processSiteQueue(); // Start processing if not already running
    }
}

// --- APPLICATION LOGIC ---

/**
 * Handles all incoming chat messages.
 * It routes commands (starting with '!') to handleCommand
 * and scans all messages for valid websim URLs.
 * @param {object} tags - The tmi.js message tags.
 * @param {string} message - The chat message content.
 */
function handleMessage(tags, message) {
    const user = tags['display-name'];
    
    // 1. Check for commands
    if (message.startsWith('!')) {
        const [command, ...args] = message.substring(1).split(/\s+/);
        if (command.length > 0) {
            handleCommand(command.toLowerCase(), user, args, tags);
        }
    }

    // 2. Check for websim URLs
    const urlRegex = /(https?:\/\/(?:www\.)?websim\.(?:com|ai)(?:\/[^\s]*)?)/g;
    const matches = message.match(urlRegex);
    if (matches) {
        matches.forEach(url => addSiteToQueue(url));
    }
}

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
        // Pass our message handler to the Twitch module.
        connectToTwitch(channel, handleMessage, updateStatus);
    } else {
        alert("Please enter a channel name.");
    }
});

fullscreenButton.addEventListener('click', () => {
    iframeViewer.style.display = 'block';
    if (iframeViewer.requestFullscreen) {
        iframeViewer.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    }
});

closeViewerButton.addEventListener('click', () => {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    }
    iframeViewer.style.display = 'none';
    websimFrame.src = 'about:blank'; // Clear the iframe
});

document.addEventListener('fullscreenchange', () => {
    // Hide viewer if user exits fullscreen (e.g., with Escape key)
    if (!document.fullscreenElement) {
        iframeViewer.style.display = 'none';
        websimFrame.src = 'about:blank';
    }
});