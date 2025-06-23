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
const flagButton = document.getElementById('flag-button');
const pauseButton = document.getElementById('pause-button');
const flaggedUrlsList = document.getElementById('flagged-urls-list');

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

// --- Content Discovery Elements ---
const clearHistoryButton = document.getElementById('clear-history-button');
const advancedDiscoveryToggle = document.getElementById('advanced-discovery-toggle');
const exploreCreatorsToggle = document.getElementById('explore-creators-toggle');
const exploreNetworkToggle = document.getElementById('explore-network-toggle');
const exploreRemixesToggle = document.getElementById('explore-remixes-toggle');
const advancedSettingsContainer = document.querySelector('.advanced-setting');

// --- IFRAME VIEWER LOGIC ---
const userQueue = [];
const backgroundQueue = [];
let currentSite = null; // Holds the data for the site currently being displayed
let isDisplayingSite = false;
let siteDisplayTimer = null; // To hold the setTimeout ID
let isLoadingProjects = false;
const BACKGROUND_QUEUE_FETCH_THRESHOLD = 20;
// Keep track of all sites displayed in this session to avoid repeats.
const recentlyDisplayedSites = new Set();
// Keep a shorter history of full site objects to seed advanced discovery
const displayHistory = [];
const MAX_HISTORY_SIZE = 50; 
const userLastSubmission = new Map();
let flaggedSites = new Set();
let isPaused = false;
let timerStartTime = 0;
let remainingTime = 0;

// --- Advanced Content Discovery State ---
const discoveryFeeds = [
    { name: 'hot', range: 'week' },
    { name: 'viral', range: 'month' },
    { name: 'top', range: 'all' },
    { name: 'engaging', range: 'all' },
    { name: 'new', range: 'day' }
];
let currentFeedIndex = 0;
// Use a map to store pagination offsets for each feed type
const feedOffsets = new Map(discoveryFeeds.map(f => [f.name, 0]));

/**
 * A helper to process API results, filter them, and add to the background queue.
 * @param {Array} items - The array of site/project data from a Websim API endpoint.
 * @param {string} sourceName - A name for the source for logging purposes (e.g., 'trending:hot').
 * @returns {number} The number of new sites added to the queue.
 */
function filterAndAddSites(items, sourceName) {
    if (!items || items.length === 0) return 0;

    const newSites = items
        .filter(item => {
            const siteId = item.site?.id;
            // We need a valid site, project, and author to proceed
            if (!siteId || !item.project?.id || !item.project?.created_by?.username) return false;
            
            // Check against session-wide duplicate list and user's flag list
            return !recentlyDisplayedSites.has(siteId) && !flaggedSites.has(siteId);
        })
        .map(item => ({ 
            id: item.site.id, 
            url: `https://websim.com/c/${item.site.id}`,
            projectId: item.project.id,
            authorUsername: item.project.created_by.username
        }));

    if (newSites.length > 0) {
        // Shuffle before adding to randomize the order of intake
        for (let i = newSites.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newSites[i], newSites[j]] = [newSites[j], newSites[i]];
        }
        backgroundQueue.push(...newSites);
        console.log(`Added ${newSites.length} new sites from '${sourceName}'. Total queue: ${backgroundQueue.length}`);
        return newSites.length;
    }
    return 0;
}

/**
 * Loads the list of flagged sites from localStorage into memory.
 */
function loadFlaggedSites() {
    const storedFlags = localStorage.getItem('flaggedSites');
    if (storedFlags) {
        try {
            flaggedSites = new Set(JSON.parse(storedFlags));
        } catch (e) {
            console.error("Error parsing flagged sites from localStorage:", e);
            flaggedSites = new Set();
        }
    }
    renderFlaggedUrls();
}

/**
 * Saves the current set of flagged sites to localStorage.
 */
function saveFlaggedSites() {
    localStorage.setItem('flaggedSites', JSON.stringify(Array.from(flaggedSites)));
}

/**
 * Renders the list of flagged URLs on the main page.
 */
function renderFlaggedUrls() {
    flaggedUrlsList.innerHTML = '';
    if (flaggedSites.size === 0) {
        flaggedUrlsList.textContent = 'No sites have been flagged.';
        return;
    }
    flaggedSites.forEach(siteIdentifier => {
        const entry = document.createElement('div');
        entry.className = 'flagged-entry';
        entry.textContent = siteIdentifier;
        entry.title = 'Click to un-flag this site';
        entry.addEventListener('click', () => {
            flaggedSites.delete(siteIdentifier);
            saveFlaggedSites();
            renderFlaggedUrls();
            console.log(`Un-flagged site: ${siteIdentifier}`);
        });
        flaggedUrlsList.appendChild(entry);
    });
}

/**
 * Fetches projects from a specific creator.
 * @param {string} username The creator's username.
 */
async function fetchCreatorProjects(username) {
    if (!username) return;
    console.log(`Advanced Discovery: Fetching projects for creator '${username}'...`);
    const url = `/api/v1/users/${username}/projects?has_site=true&limit=50&sort_by=updated_at`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const { projects } = await response.json();
        if (projects && projects.data) {
            filterAndAddSites(projects.data, `creator:${username}`);
        }
    } catch (error) {
        console.error(`Error fetching creator projects for ${username}:`, error);
    }
}

/**
 * Fetches projects from users that a specific creator follows.
 * @param {string} username The creator's username.
 */
async function fetchCreatorNetworkProjects(username) {
    if (!username) return;
    console.log(`Advanced Discovery: Fetching projects from network of '${username}'...`);
    const url = `/api/v1/users/${username}/following/projects?has_site=true&limit=50`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const { projects } = await response.json();
        if (projects && projects.data) {
            filterAndAddSites(projects.data, `network:${username}`);
        }
    } catch (error) {
        console.error(`Error fetching creator network projects for ${username}:`, error);
    }
}

/**
 * Fetches remixes (descendants) of a given project.
 * @param {string} projectId The ID of the project to find remixes for.
 */
async function fetchRemixProjects(projectId) {
    if (!projectId) return;
    console.log(`Advanced Discovery: Fetching remixes for project '${projectId}'...`);
    const url = `/api/v1/projects/${projectId}/descendants?has_site=true&limit=50`;
     try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const { projects } = await response.json();
        if (projects && projects.data) {
            filterAndAddSites(projects.data, `remixes:${projectId}`);
        }
    } catch (error) {
        console.error(`Error fetching remixes for ${projectId}:`, error);
    }
}

/**
 * Runs the advanced discovery methods using a seed from the display history.
 */
async function runAdvancedDiscovery() {
    if (!advancedDiscoveryToggle.checked || displayHistory.length === 0) {
        return;
    }

    console.log("Running advanced discovery phase...");
    
    // Pick a random seed from our recent history
    const seed = displayHistory[Math.floor(Math.random() * displayHistory.length)];
    if (!seed) {
        console.log("Advanced discovery skipped: No seed available.");
        return;
    }

    const tasks = [];
    if (exploreCreatorsToggle.checked) {
        tasks.push(fetchCreatorProjects(seed.authorUsername));
    }
    if (exploreNetworkToggle.checked) {
        tasks.push(fetchCreatorNetworkProjects(seed.authorUsername));
    }
    if (exploreRemixesToggle.checked) {
        tasks.push(fetchRemixProjects(seed.projectId));
    }

    if (tasks.length > 0) {
        await Promise.all(tasks);
        console.log("Advanced discovery phase complete.");
    }
}

/**
 * Fetches projects from various feeds to populate the background queue.
 * This is the main function for sourcing new content for the background carousel.
 */
async function populateBackgroundQueue() {
    if (isLoadingProjects) return;
    isLoadingProjects = true;

    // --- Phase 1: Fetch from standard trending feeds ---
    const feedConfig = discoveryFeeds[currentFeedIndex];
    const offset = feedOffsets.get(feedConfig.name) || 0;
    const limit = 100;

    console.log(`Fetching background projects from '${feedConfig.name}' feed (offset: ${offset})...`);
    
    const url = `/api/v1/feed/trending?feed=${feedConfig.name}&range=${feedConfig.range}&limit=${limit}&offset=${offset}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API request failed: ${response.status}`);
        const { feed } = await response.json();

        let addedCount = 0;
        if (feed && feed.data) {
            addedCount = filterAndAddSites(feed.data, `trending:${feedConfig.name}`);
        }

        // --- Logic for cycling through trending feeds ---
        if (!feed || !feed.data || feed.data.length < limit) {
            console.log(`Reached end of '${feedConfig.name}' feed. Resetting its offset and moving to the next feed.`);
            feedOffsets.set(feedConfig.name, 0);
            currentFeedIndex = (currentFeedIndex + 1) % discoveryFeeds.length;
        } else {
            feedOffsets.set(feedConfig.name, offset + limit);
            currentFeedIndex = (currentFeedIndex + 1) % discoveryFeeds.length; // Cycle for variety
        }

        // --- Phase 2: If queue is still low, trigger advanced discovery ---
        if (backgroundQueue.length < BACKGROUND_QUEUE_FETCH_THRESHOLD) {
             await runAdvancedDiscovery();
        }

        // If after all that, we still have nothing, and we got nothing from trending,
        // it might mean all our feeds are exhausted. Let's try another trending feed
        // after a short delay to avoid spamming.
        if (addedCount === 0 && backgroundQueue.length < BACKGROUND_QUEUE_FETCH_THRESHOLD) {
             console.log("All fetches yielded no new sites. Will try again after a short delay.");
             setTimeout(populateBackgroundQueue, 5000); // Try again in 5s
             return; // Exit here, the timeout will handle the next attempt.
        }

    } catch (error) {
        console.error('Error fetching trending projects:', error);
        // On error, just move to the next feed type to avoid getting stuck on a failing one.
        currentFeedIndex = (currentFeedIndex + 1) % discoveryFeeds.length;
    } finally {
        isLoadingProjects = false;
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
    currentSite = null; // Clear the current site reference
    processQueue();
}

/**
 * Flags the current site, saves it, and then skips to the next one.
 */
function flagAndSkip() {
    if (currentSite) {
        // Use the ID for background sites, and the full URL for user-submitted ones
        const identifier = currentSite.id || currentSite.url;
        console.log(`Flagging site: ${identifier}`);
        flaggedSites.add(identifier);
        saveFlaggedSites();
        renderFlaggedUrls();
    } else {
        console.log('No current site to flag.');
    }
    skipToNextSite();
}

/**
 * Processes the next site from the user queue or background queue.
 */
function processQueue() {
    if (isDisplayingSite || isPaused) {
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
            populateBackgroundQueue();
        }
        if (backgroundQueue.length > 0) {
            nextSite = backgroundQueue.shift();
            console.log(`Displaying from background queue: ${nextSite.url}. Queue length: ${backgroundQueue.length}`);
            
            // Track displayed site ID to avoid repeats for the entire session.
            recentlyDisplayedSites.add(nextSite.id);
            // Add full object to short-term history for seeding advanced discovery.
            displayHistory.push(nextSite);
            if(displayHistory.length > MAX_HISTORY_SIZE) {
                displayHistory.shift();
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
        currentSite = nextSite; // Store the current site details
        websimFrame.src = nextSite.url;
        
        // Store duration and start time for pause/resume functionality
        remainingTime = displayDuration;
        timerStartTime = Date.now();

        // Clear any previous timer just in case
        if (siteDisplayTimer) {
            clearTimeout(siteDisplayTimer);
        }

        siteDisplayTimer = setTimeout(() => {
            isDisplayingSite = false;
            currentSite = null; // Clear site when its time is up
            processQueue(); // Process next in queue
        }, displayDuration);
    } else {
         // If both queues are empty (or background is disabled), try again in a few seconds.
         // Don't queue up another attempt if we are paused.
         if (!isPaused) {
            setTimeout(processQueue, 5000);
         }
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

    // 0. Check if site is flagged
    if (flaggedSites.has(url)) {
        console.log(`Submission blocked: URL ${url} is flagged.`);
        return;
    }

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

/**
 * Clears the session's watched history, resets content feeds, and fetches new sites.
 */
function clearWatchedHistory() {
    console.log("Clearing watched history and resetting feeds...");
    // 1. Clear the session history set
    recentlyDisplayedSites.clear();
    // 2. Clear the short-term history array for seeding
    displayHistory.length = 0;
    // 3. Clear the background queue
    backgroundQueue.length = 0;
    // 4. Reset all feed offsets
    feedOffsets.forEach((_val, key) => feedOffsets.set(key, 0));
    // 5. Reset feed index to start from the beginning
    currentFeedIndex = 0;
    // 6. Stop the current site from displaying and clear the viewer
    if (siteDisplayTimer) {
        clearTimeout(siteDisplayTimer);
        siteDisplayTimer = null;
    }
    isDisplayingSite = false;
    currentSite = null;
    websimFrame.src = 'about:blank';
    
    console.log("History cleared. Fetching new content...");
    // 7. Immediately fetch new content and kick off the queue if the viewer is open
    populateBackgroundQueue().then(() => {
        if (iframeViewer.style.display === 'block') {
            processQueue();
        }
    });
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

flagButton.addEventListener('click', () => {
    flagAndSkip();
});

pauseButton.addEventListener('click', () => {
    isPaused = !isPaused;

    if (isPaused) {
        // --- PAUSE ---
        pauseButton.textContent = 'Play';
        if (siteDisplayTimer) {
            clearTimeout(siteDisplayTimer);
            siteDisplayTimer = null;
            // Calculate and store how much time was left on the timer
            const elapsedTime = Date.now() - timerStartTime;
            remainingTime -= elapsedTime;
            if (remainingTime < 0) remainingTime = 0;
            console.log(`Paused. Time remaining: ${Math.round(remainingTime / 1000)}s`);
        } else {
            console.log("Paused between sites.");
        }
    } else {
        // --- RESUME ---
        pauseButton.textContent = 'Pause';
        if (isDisplayingSite && remainingTime > 0) {
            console.log(`Resuming. Time remaining: ${Math.round(remainingTime / 1000)}s`);
            // Set a new timer with the remaining time
            timerStartTime = Date.now();
            siteDisplayTimer = setTimeout(() => {
                isDisplayingSite = false;
                currentSite = null;
                processQueue();
            }, remainingTime);
        } else {
             // If we were paused between sites, just kick off the queue.
            console.log("Resuming. Processing next in queue.");
            processQueue();
        }
    }
});

clearHistoryButton.addEventListener('click', clearWatchedHistory);

advancedDiscoveryToggle.addEventListener('change', () => {
    if (advancedDiscoveryToggle.checked) {
        advancedSettingsContainer.classList.remove('hidden');
    } else {
        advancedSettingsContainer.classList.add('hidden');
    }
});

document.addEventListener('keydown', (e) => {
    // Hide viewer if user presses Escape key
    if (e.key === "Escape" && iframeViewer.style.display === 'block') {
        iframeViewer.style.display = 'none';
        websimFrame.src = 'about:blank';
    }
});

// --- INITIALIZATION ---
// Toggle advanced settings visibility on load
if (!advancedDiscoveryToggle.checked) {
    advancedSettingsContainer.classList.add('hidden');
}
// Pre-fetch some sites on page load so we're ready to go.
populateBackgroundQueue();
loadFlaggedSites();