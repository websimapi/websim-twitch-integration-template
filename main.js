import { connectToTwitch } from './twitch-chat.js';

// --- DOM ELEMENTS ---
const connectButton = document.getElementById('connect-button');
const channelInput = document.getElementById('channel-input');
const statusDiv = document.getElementById('connection-status');
const commandLogDiv = document.getElementById('command-log');
const showViewerButton = document.getElementById('fullscreen-button'); // Renamed for clarity in code
const iframeViewer = document.getElementById('iframe-viewer');
const websimFrame = document.getElementById('websim-frame');
const closeViewerButton = document.getElementById('close-viewer-button');

// --- IFRAME VIEWER LOGIC ---
const userQueue = [];
const backgroundQueue = [];
let isDisplayingSite = false;
let isLoadingProjects = false;
let nextCursor = null;
const BACKGROUND_QUEUE_FETCH_THRESHOLD = 20;
const MIN_SITE_DISPLAY_DURATION = 30 * 1000; // 30 seconds
const MAX_SITE_DISPLAY_DURATION = 60 * 1000; // 1 minute
// Keep track of a few hundred recent sites to avoid quick repeats
const RECENTLY_DISPLAYED_MAX_SIZE = 500;
const recentlyDisplayedSites = new Set();

/**
 * Fetches a paginated list of public projects to populate the background queue.
 */
async function fetchBackgroundProjects() {
    if (isLoadingProjects) return;
    isLoadingProjects = true;
    console.log('Fetching new background projects...');

    // Use the `after` cursor for pagination if we have one.
    const url = `/api/v1/projects?first=100&sort_by=created_at&posted=true${nextCursor ? `&after=${nextCursor}` : ''}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        const { projects } = await response.json();

        if (projects && projects.data) {
            // Filter for projects that have a viewable site and haven't been shown recently.
            const newSites = projects.data
                .filter(item => item.site && item.site.id && !recentlyDisplayedSites.has(item.site.id))
                .map(item => ({
                    id: item.site.id,
                    url: `https://websim.com/c/${item.site.id}`
                }));

            if (newSites.length > 0) {
                // Shuffle the new sites to randomize the order
                for (let i = newSites.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newSites[i], newSites[j]] = [newSites[j], newSites[i]];
                }
                backgroundQueue.push(...newSites);
                console.log(`Added ${newSites.length} new sites to background queue. Total: ${backgroundQueue.length}`);
            }

            // Update cursor for the next fetch. If there's no next page, we'll start over from the beginning on the next cycle.
            nextCursor = projects.meta.has_next_page ? projects.meta.end_cursor : null;
        }
    } catch (error) {
        console.error('Error fetching background projects:', error);
    } finally {
        isLoadingProjects = false;
        // If the queue is still empty, maybe we've reached the end. Try again after a delay.
        if (backgroundQueue.length === 0) {
            console.log("No new projects found, will retry fetching later.");
        }
    }
}

/**
 * Processes the next site from the user queue or background queue.
 */
function processQueue() {
    if (isDisplayingSite) {
        return;
    }

    let nextSite = null;

    // Prioritize the user queue
    if (userQueue.length > 0) {
        nextSite = userQueue.shift();
        console.log(`Displaying from user queue: ${nextSite.url}. Queue length: ${userQueue.length}`);
    } else {
        // Fetch more background sites if the queue is running low
        if (backgroundQueue.length < BACKGROUND_QUEUE_FETCH_THRESHOLD && !isLoadingProjects) {
            fetchBackgroundProjects();
        }
        if (backgroundQueue.length > 0) {
            nextSite = backgroundQueue.shift();
            console.log(`Displaying from background queue: ${nextSite.url}. Queue length: ${backgroundQueue.length}`);
            
            // Track displayed sites to avoid repeats
            recentlyDisplayedSites.add(nextSite.id);
            if (recentlyDisplayedSites.size > RECENTLY_DISPLAYED_MAX_SIZE) {
                const oldestSite = recentlyDisplayedSites.values().next().value;
                recentlyDisplayedSites.delete(oldestSite);
            }
        }
    }
    
    if (nextSite) {
        isDisplayingSite = true;
        websimFrame.src = nextSite.url;

        const displayDuration = MIN_SITE_DISPLAY_DURATION + Math.random() * (MAX_SITE_DISPLAY_DURATION - MIN_SITE_DISPLAY_DURATION);

        setTimeout(() => {
            isDisplayingSite = false;
            processQueue(); // Process next in queue
        }, displayDuration);
    } else {
         // If both queues are empty, try again in a few seconds.
         setTimeout(processQueue, 5000);
    }
}

/**
 * Adds a site from chat to the high-priority user queue.
 * @param {string} url - The websim URL to display.
 */
function addSiteToUserQueue(url) {
    if (url.startsWith('http')) {
        // The user can submit the same URL multiple times.
        // We just wrap it in an object to be consistent with background queue items.
        userQueue.push({ id: url, url: url });
        console.log(`Added ${url} to user queue.`);
        processQueue(); // Start processing if not already running
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
        matches.forEach(url => addSiteToUserQueue(url));
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

showViewerButton.addEventListener('click', () => {
    if (iframeViewer.style.display === 'block') {
        iframeViewer.style.display = 'none';
        websimFrame.src = 'about:blank'; // Clear the iframe to stop execution
    } else {
        iframeViewer.style.display = 'block';
        // Kick off the queue processor if it's not already running
        if (!isDisplayingSite) {
            processQueue();
        }
    }
});

closeViewerButton.addEventListener('click', () => {
    iframeViewer.style.display = 'none';
    websimFrame.src = 'about:blank'; // Clear the iframe
});

document.addEventListener('keydown', (e) => {
    // Hide viewer if user presses Escape key
    if (e.key === "Escape" && iframeViewer.style.display === 'block') {
        iframeViewer.style.display = 'none';
        websimFrame.src = 'about:blank';
    }
});

// --- INITIALIZATION ---
// Pre-fetch some sites on page load so we're ready to go.
fetchBackgroundProjects();