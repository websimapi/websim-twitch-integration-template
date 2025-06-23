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
const skipButton = document.getElementById('skip-button');
// --- Settings Elements ---
const minDurationInput = document.getElementById('min-duration-input');
const maxDurationInput = document.getElementById('max-duration-input');
const backgroundQueueToggle = document.getElementById('background-queue-toggle');
// --- User Submission Settings Elements ---
const allowUserUrlsToggle = document.getElementById('allow-user-urls-toggle');
const userSiteDurationInput = document.getElementById('user-site-duration-input');
const userQueueLimitInput = document.getElementById('user-queue-limit-input');
const userCooldownInput = document.getElementById('user-cooldown-input');
const modsSubsOnlyToggle = document.getElementById('mods-subs-only-toggle');

// --- IFRAME VIEWER LOGIC ---
const userQueue = [];
const backgroundQueue = [];
let isDisplayingSite = false;
let siteDisplayTimer = null; // To hold the setTimeout ID
let isLoadingProjects = false;
let nextCursor = null;
const BACKGROUND_QUEUE_FETCH_THRESHOLD = 20;
const MIN_SITE_DISPLAY_DURATION = 30 * 1000; // 30 seconds
const MAX_SITE_DISPLAY_DURATION = 60 * 1000; // 1 minute
// Keep track of a few hundred recent sites to avoid quick repeats
const RECENTLY_DISPLAYED_MAX_SIZE = 500;
const recentlyDisplayedSites = new Set();
const userLastSubmission = new Map();

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
 * Interrupts the current site and shows the next one from the queue.
 */
function skipToNextSite() {
    console.log('User skipped to next site.');
    // Clear the currently scheduled timer for the next site
    if (siteDisplayTimer) {
        clearTimeout(siteDisplayTimer);
        siteDisplayTimer = null;
    }
    // Immediately process the next item in the queue
    isDisplayingSite = false;
    processQueue();
}

/**
 * Processes the next site from the user queue or background queue.
 */
function processQueue() {
    if (isDisplayingSite) {
        return;
    }

    let nextSite = null;
    let displayDuration;

    // Prioritize the user queue
    if (userQueue.length > 0) {
        nextSite = userQueue.shift();
        console.log(`Displaying from user queue: ${nextSite.url}. Queue length: ${userQueue.length}`);
        let userDuration = parseInt(userSiteDurationInput.value, 10) * 1000;
        if(isNaN(userDuration) || userDuration < 5000) userDuration = 60000;
        displayDuration = userDuration;
    } else if (backgroundQueueToggle.checked) { // Check if background queue is enabled
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

            // Calculate duration for background sites
            let minDuration = parseInt(minDurationInput.value, 10) * 1000;
            let maxDuration = parseInt(maxDurationInput.value, 10) * 1000;

            if (isNaN(minDuration) || minDuration < 5000) {
                minDuration = 5000;
                minDurationInput.value = 5; // Correct UI
            }
            if (isNaN(maxDuration) || maxDuration < minDuration) {
                maxDuration = minDuration;
                maxDurationInput.value = minDuration / 1000; // Correct UI
            }
            displayDuration = minDuration + Math.random() * (maxDuration - minDuration);
        }
    }
    
    if (nextSite) {
        isDisplayingSite = true;
        websimFrame.src = nextSite.url;
        
        // Clear any previous timer just in case
        if (siteDisplayTimer) {
            clearTimeout(siteDisplayTimer);
        }

        siteDisplayTimer = setTimeout(() => {
            isDisplayingSite = false;
            processQueue(); // Process next in queue
        }, displayDuration);
    } else {
         // If both queues are empty (or background is disabled), try again in a few seconds.
         setTimeout(processQueue, 5000);
    }
}

/**
 * Validates and adds a site from chat to the high-priority user queue.
 * @param {string} url - The websim URL to display.
 * @param {object} tags - The TMI.js tags for the user who sent the message.
 */
function addSiteToUserQueue(url, tags) {
    const user = tags['display-name'];
    const userId = tags['user-id'];

    // 1. Check if user submissions are enabled at all
    if (!allowUserUrlsToggle.checked) return;

    // 2. Check for permissions (mod/sub)
    if (modsSubsOnlyToggle.checked && !tags.mod && !tags.subscriber) {
        console.log(`Submission blocked: ${user} is not a mod or subscriber.`);
        return;
    }

    // 3. Check user cooldown
    const cooldown = parseInt(userCooldownInput.value, 10) * 1000;
    if (cooldown > 0 && userLastSubmission.has(userId)) {
        const lastTime = userLastSubmission.get(userId);
        if (Date.now() - lastTime < cooldown) {
            console.log(`Submission blocked: ${user} is on cooldown.`);
            return;
        }
    }
    
    // 4. Check queue size limit
    const queueLimit = parseInt(userQueueLimitInput.value, 10);
    if (userQueue.length >= queueLimit) {
        console.log(`Submission blocked: User queue is full.`);
        return;
    }

    // 5. Basic URL validation
    try {
        const parsedUrl = new URL(url);
        const acceptedHosts = ['websim.com', 'www.websim.com', 'websim.ai', 'www.websim.ai'];
        if (!acceptedHosts.includes(parsedUrl.hostname)) {
             console.log(`Submission blocked: Invalid hostname ${parsedUrl.hostname}`);
             return;
        }
    } catch(e) {
        console.log(`Submission blocked: Invalid URL format ${url}`);
        return; // Not a valid URL
    }

    // 6. Add to queue and update cooldown timestamp
    userQueue.push({ id: url, url: url, submittedBy: user });
    userLastSubmission.set(userId, Date.now());
    console.log(`Added ${url} to user queue (submitted by ${user}).`);
    
    // 7. Start processing if not already running
    if (!isDisplayingSite) {
        processQueue();
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

    // 2. Check for websim URLs if the feature is enabled
    if (allowUserUrlsToggle.checked) {
        const urlRegex = /https?:\/\/websim\.(?:com|ai)\/(?:c\/[a-zA-Z0-9_.-]+|p\/[a-zA-Z0-9_.-]+|@[a-zA-Z0-9_]+\/[a-zA-Z0-9_-]+(?:\/\d+)?)/g;
        const matches = message.match(urlRegex);
        if (matches) {
            matches.forEach(url => addSiteToUserQueue(url, tags));
        }
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

skipButton.addEventListener('click', () => {
    skipToNextSite();
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