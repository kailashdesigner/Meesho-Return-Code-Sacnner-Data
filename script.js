// Return Tracking Scanner System
// Mobile-first design with Google Sheets integration

// Configuration
const CONFIG = {
    // Replace with your Google Apps Script Web App URL
    GOOGLE_SHEET_URL: 'https://script.google.com/macros/s/AKfycbxVkr_Icr8YVjJZETk5_BfuoSPW0vZ2eXWzQSBtFo4NTACk4LFeuaS93BOnOQRb3g/exec',
    BEEP_SOUND_URL: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWi77+efTRAMUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUrgc7y2Yk2CBlou+/nn00QDFCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAC'
};

// State management
const state = {
    scannedCodes: new Set(), // For permanent duplicate detection
    recentScans: new Map(), // For cooldown tracking: code -> timestamp
    itemCounter: 0,
    scanner: null,
    isScanning: false,
    torchEnabled: false,
    videoTrack: null, // Camera track for torch control
    lastScanTime: 0, // For debounce
    scanDebounceMs: 1500, // 1.5 seconds debounce between scans
    cooldownMs: 5000, // 5 seconds cooldown for same code
    currentFPS: 10, // Current FPS setting
    idleFPS: 5, // Lower FPS when idle
    activeFPS: 15, // Higher FPS when actively scanning
    isIdle: true // Track if scanner is idle
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

/**
 * Initialize the application
 */
function initializeApp() {
    setupManualInput();
    setupCameraButton();
    setupCloseScanner();
    setupTorchButton();
    
    // Focus on input for better mobile UX
    const input = document.getElementById('manualInput');
    if (input) {
        // Delay focus to prevent keyboard popup on page load
        setTimeout(() => {
            input.focus();
        }, 300);
    }
}

/**
 * Setup manual input handler
 */
function setupManualInput() {
    const input = document.getElementById('manualInput');
    
    if (!input) return;
    
    // Handle Enter key
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleManualEntry();
        }
    });
    
    // Handle blur (when user taps outside)
    input.addEventListener('blur', () => {
        // Optional: Auto-submit on blur if value exists
        // Uncomment if desired:
        // if (input.value.trim()) {
        //     handleManualEntry();
        // }
    });
}

/**
 * Handle manual entry submission
 */
async function handleManualEntry() {
    const input = document.getElementById('manualInput');
    const trackingCode = input.value.trim();
    
    if (!trackingCode) {
        showMessage('Please enter a tracking code', 'error');
        return;
    }
    
    // Validate and process (play beep for manual entry)
    await processTrackingCode(trackingCode, 'Manual', true);
    
    // Clear input
    input.value = '';
    input.focus();
}

/**
 * Setup camera button
 */
function setupCameraButton() {
    const cameraBtn = document.getElementById('cameraBtn');
    
    if (!cameraBtn) return;
    
    cameraBtn.addEventListener('click', () => {
        openScanner();
    });
}

/**
 * Setup close scanner button
 */
function setupCloseScanner() {
    const closeBtn = document.getElementById('closeScanner');
    
    if (!closeBtn) return;
    
    closeBtn.addEventListener('click', () => {
        closeScanner();
    });
}

/**
 * Setup torch/flashlight button
 */
function setupTorchButton() {
    const torchBtn = document.getElementById('torchBtn');
    
    if (!torchBtn) return;
    
    torchBtn.addEventListener('click', () => {
        toggleTorch();
    });
    
    // Initially disable torch button (will be enabled if supported)
    torchBtn.classList.add('disabled');
}

/**
 * Open barcode scanner overlay
 */
async function openScanner() {
    const overlay = document.getElementById('scannerOverlay');
    const container = document.getElementById('scannerContainer');
    
    if (!overlay || !container) return;
    
    // Reset state
    state.torchEnabled = false;
    state.videoTrack = null;
    state.lastScanTime = 0;
    state.isIdle = true;
    state.currentFPS = state.idleFPS;
    
    // Clear any existing scanner first
    if (state.scanner && state.isScanning) {
        try {
            await state.scanner.stop();
            await state.scanner.clear();
        } catch (e) {
            console.log('Clearing previous scanner:', e);
        }
        state.isScanning = false;
        state.scanner = null;
    }
    
    // Clear the container
    container.innerHTML = '';
    
    // Reset status
    updateScannerStatus('Scanning...');
    
    // Show overlay
    overlay.classList.add('active');
    
    // Small delay to ensure overlay is visible
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Initialize scanner
    try {
        state.scanner = new Html5Qrcode('scannerContainer');
        
        // Calculate square size based on viewport (35% of smaller dimension)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const minDimension = Math.min(viewportWidth, viewportHeight);
        const qrboxSize = Math.max(200, Math.floor(minDimension * 0.35)); // Minimum 200px
        
        // Enhanced camera constraints for better focus and torch support
        const cameraConfig = {
            facingMode: 'environment', // Prefer back camera
            // Request advanced features
            advanced: [
                // Enable continuous autofocus
                { focusMode: 'continuous' },
                // Request torch capability
                { torch: true }
            ]
        };
        
        // Start scanning with optimized settings
        // SCAN SPEED OPTIMIZATION: Start with active FPS for better initial scanning
        // Note: html5-qrcode doesn't support dynamic FPS changes after start,
        // so we use a balanced FPS that works well for both idle and active states
        await state.scanner.start(
            cameraConfig,
            {
                fps: state.activeFPS, // Use active FPS for better scanning performance
                qrbox: { width: qrboxSize, height: qrboxSize },
                aspectRatio: 1.0,
                // Additional optimization settings
                videoConstraints: {
                    facingMode: 'environment',
                    focusMode: 'continuous', // Continuous autofocus
                    zoom: 1.0 // Can be adjusted if needed
                }
            },
            onScanSuccess,
            onScanError
        );
        
        state.isScanning = true;
        
        // Try to get video track for torch control
        await setupTorchSupport();
        
        // Start FPS optimization loop
        startFPSOptimization();
        
    } catch (error) {
        console.error('Error starting scanner:', error);
        showMessage('Failed to start camera. Please check permissions.', 'error');
        closeScanner();
    }
}

/**
 * Setup torch/flashlight support by accessing camera track
 */
async function setupTorchSupport() {
    try {
        // Get the video element from html5-qrcode
        const container = document.getElementById('scannerContainer');
        const video = container.querySelector('video');
        
        if (!video) {
            console.log('Video element not found for torch support');
            return;
        }
        
        // Get the media stream track
        const stream = video.srcObject;
        if (!stream) {
            console.log('Media stream not available for torch support');
            return;
        }
        
        // Find video track
        const tracks = stream.getVideoTracks();
        if (tracks.length === 0) {
            console.log('No video tracks found for torch support');
            return;
        }
        
        state.videoTrack = tracks[0];
        
        // Check if torch is supported
        const capabilities = state.videoTrack.getCapabilities();
        if (capabilities && capabilities.torch) {
            // Torch is supported, enable the button
            const torchBtn = document.getElementById('torchBtn');
            if (torchBtn) {
                torchBtn.classList.remove('disabled');
            }
        } else {
            console.log('Torch not supported on this device');
        }
    } catch (error) {
        console.log('Error setting up torch support:', error);
    }
}

/**
 * Toggle torch/flashlight on/off
 */
async function toggleTorch() {
    const torchBtn = document.getElementById('torchBtn');
    
    if (!state.videoTrack || !torchBtn || torchBtn.classList.contains('disabled')) {
        return;
    }
    
    try {
        const capabilities = state.videoTrack.getCapabilities();
        if (!capabilities || !capabilities.torch) {
            console.log('Torch not supported');
            return;
        }
        
        // Toggle torch state
        state.torchEnabled = !state.torchEnabled;
        
        // Apply torch constraint
        await state.videoTrack.applyConstraints({
            advanced: [{ torch: state.torchEnabled }]
        });
        
        // Update button appearance
        if (state.torchEnabled) {
            torchBtn.classList.add('active');
        } else {
            torchBtn.classList.remove('active');
        }
        
    } catch (error) {
        console.error('Error toggling torch:', error);
        // Disable torch button if it fails
        if (torchBtn) {
            torchBtn.classList.add('disabled');
        }
    }
}

/**
 * Update scanner status text
 */
function updateScannerStatus(text) {
    const statusEl = document.getElementById('scannerStatus');
    if (statusEl) {
        statusEl.textContent = text;
    }
}

/**
 * Start FPS optimization loop - tracks activity for potential future optimization
 * 
 * NOTE: html5-qrcode library doesn't support changing FPS dynamically after initialization.
 * We track idle/active state here for potential future use or if library adds this feature.
 * Currently, scanner starts with activeFPS (15) for optimal scanning performance.
 * Battery optimization is achieved through other means (debounce, cooldown, etc.).
 */
function startFPSOptimization() {
    // Clear any existing interval
    if (state.fpsOptimizationInterval) {
        clearInterval(state.fpsOptimizationInterval);
    }
    
    // Track activity state (for potential future optimization)
    state.fpsOptimizationInterval = setInterval(() => {
        if (!state.isScanning || !state.scanner) {
            clearInterval(state.fpsOptimizationInterval);
            return;
        }
        
        const timeSinceLastScan = Date.now() - state.lastScanTime;
        const idleThreshold = 3000; // 3 seconds of no scanning = idle
        
        // Track idle state (for potential future use)
        if (timeSinceLastScan > idleThreshold && !state.isIdle) {
            state.isIdle = true;
            state.currentFPS = state.idleFPS;
            // Note: Actual FPS cannot be changed after scanner.start()
            // This tracking is for potential future optimization
        }
    }, 2000);
}

/**
 * Handle successful barcode scan
 * Includes debounce logic to prevent rapid duplicate scans
 */
async function onScanSuccess(decodedText, decodedResult) {
    const now = Date.now();
    
    // DEBOUNCE LOGIC: Prevent rapid duplicate scans
    // If scanned within debounce period, ignore this scan
    if (now - state.lastScanTime < state.scanDebounceMs) {
        return; // Ignore this scan, too soon after last scan
    }
    
    // Update last scan time
    state.lastScanTime = now;
    state.isIdle = false; // Mark as active
    
    // Show scanned code in the scanner overlay
    showScannedCode(decodedText);
    
    // Process the scanned code (handles cooldown, duplicates, feedback)
    await processTrackingCode(decodedText, 'Camera', false);
    
    // Scanner stays open for continuous scanning (continuous scan mode)
}

/**
 * Handle scan errors (continuous scanning)
 */
function onScanError(errorMessage) {
    // Ignore continuous error messages during scanning
    // NotFoundException is normal when no code is detected
    // Only log actual errors
    if (errorMessage && 
        !errorMessage.includes('NotFoundException') && 
        !errorMessage.includes('No QR code found')) {
        // Log only real errors, not "not found" messages
        console.log('Scan error:', errorMessage);
        // Update status for real errors
        updateScannerStatus('Scan error');
        setTimeout(() => {
            updateScannerStatus('Scanning...');
        }, 2000);
    }
}

/**
 * Close scanner overlay
 */
async function closeScanner() {
    const overlay = document.getElementById('scannerOverlay');
    const container = document.getElementById('scannerContainer');
    
    // Stop FPS optimization
    if (state.fpsOptimizationInterval) {
        clearInterval(state.fpsOptimizationInterval);
        state.fpsOptimizationInterval = null;
    }
    
    // Turn off torch if enabled
    if (state.torchEnabled && state.videoTrack) {
        try {
            await state.videoTrack.applyConstraints({
                advanced: [{ torch: false }]
            });
        } catch (error) {
            console.log('Error turning off torch:', error);
        }
        state.torchEnabled = false;
    }
    
    // Reset torch button
    const torchBtn = document.getElementById('torchBtn');
    if (torchBtn) {
        torchBtn.classList.remove('active');
        torchBtn.classList.add('disabled');
    }
    
    // Stop scanner if running
    if (state.scanner && state.isScanning) {
        try {
            await state.scanner.stop();
            await state.scanner.clear();
        } catch (error) {
            console.error('Error stopping scanner:', error);
        }
        state.isScanning = false;
        state.scanner = null;
    }
    
    // Reset video track
    state.videoTrack = null;
    
    // Clear visual feedback classes
    if (container) {
        container.classList.remove('scan-success', 'scan-duplicate');
    }
    
    // Hide overlay
    if (overlay) {
        overlay.classList.remove('active');
    }
}

/**
 * Process tracking code (validate, check duplicate, add to list, send to sheet)
 * @param {string} trackingCode - The tracking code to process
 * @param {string} entryType - 'Manual' or 'Camera'
 * @param {boolean} playBeepSound - Whether to play beep sound (default: false, camera handles its own beep)
 */
async function processTrackingCode(trackingCode, entryType, playBeepSound = false) {
    // Validate
    if (!trackingCode || trackingCode.length === 0) {
        showMessage('Invalid tracking code', 'error');
        return false;
    }
    
    const now = Date.now();
    
    // DUPLICATE COOLDOWN LOGIC: Check if same code was scanned within cooldown period
    const lastScanTime = state.recentScans.get(trackingCode);
    if (lastScanTime && (now - lastScanTime) < state.cooldownMs) {
        // Same code scanned within cooldown period
        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        showMessage(`Meeshow - Cooldown: ${trackingCode} | ${entryType} | ${time}`, 'error');
        updateScannerStatus('Duplicate detected');
        showVisualFeedback('duplicate');
        vibrateDuplicate();
        playErrorSound();
        return false;
    }
    
    // Check for permanent duplicate (already in scannedCodes Set)
    if (state.scannedCodes.has(trackingCode)) {
        const time = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        showMessage(`Meeshow - Duplicate: ${trackingCode} | ${entryType} | ${time}`, 'error');
        updateScannerStatus('Duplicate detected');
        showVisualFeedback('duplicate');
        addToList(trackingCode, entryType, true); // true = isDuplicate
        vibrateDuplicate();
        playErrorSound();
        return false;
    }
    
    // SUCCESS: New code scanned
    // Add to permanent Set (mark as scanned)
    state.scannedCodes.add(trackingCode);
    
    // Add to cooldown Map with current timestamp
    state.recentScans.set(trackingCode, now);
    
    // Clean up old cooldown entries (older than cooldown period)
    cleanupCooldownEntries();
    
    // Add to list with success state
    addToList(trackingCode, entryType, false);
    
    // Play beep sound (only if requested - camera handles its own beep)
    if (playBeepSound) {
        playBeep();
    } else {
        // Camera scan - provide success feedback
        vibrateSuccess();
        playBeep();
    }
    
    // Update status and visual feedback
    updateScannerStatus('Code detected');
    showVisualFeedback('success');
    
    // Show success message with Meeshow branding
    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    showMessage(`Meeshow - Scanned: ${trackingCode} | ${entryType} | ${time}`, 'success');
    
    // Reset status after 2 seconds
    setTimeout(() => {
        updateScannerStatus('Scanning...');
    }, 2000);
    
    // Send to Google Sheet (only if not duplicate)
    try {
        await sendToGoogleSheet(trackingCode);
    } catch (error) {
        console.error('Error sending to Google Sheet:', error);
        showMessage('Failed to save to sheet', 'error');
    }
    
    return true;
}

/**
 * Clean up old entries from cooldown Map
 * Removes entries older than cooldown period to prevent memory leak
 */
function cleanupCooldownEntries() {
    const now = Date.now();
    for (const [code, timestamp] of state.recentScans.entries()) {
        if (now - timestamp > state.cooldownMs) {
            state.recentScans.delete(code);
        }
    }
}

/**
 * Add item to tracking list table
 */
function addToList(trackingCode, entryType, isDuplicate) {
    const tbody = document.getElementById('trackingList');
    if (!tbody) return;
    
    state.itemCounter++;
    const row = document.createElement('tr');
    
    // Add error class if duplicate
    if (isDuplicate) {
        row.classList.add('error');
    } else {
        row.classList.add('success');
        // Remove success class after animation
        setTimeout(() => {
            row.classList.remove('success');
        }, 2000);
    }
    
    const time = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    row.innerHTML = `
        <td>${state.itemCounter}</td>
        <td>${escapeHtml(trackingCode)}</td>
        <td>${escapeHtml(entryType)}</td>
        <td>${time}</td>
    `;
    
    // Insert at the top
    tbody.insertBefore(row, tbody.firstChild);
    
    // Scroll to top to show new entry
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Send tracking code to Google Sheet via Apps Script Web App
 */
async function sendToGoogleSheet(trackingCode) {
    if (!CONFIG.GOOGLE_SHEET_URL || CONFIG.GOOGLE_SHEET_URL.includes('YOUR_')) {
        console.warn('Google Sheet URL not configured');
        return;
    }
    
    try {
        const response = await fetch(CONFIG.GOOGLE_SHEET_URL, {
            method: 'POST',
            mode: 'no-cors', // Required for Google Apps Script
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                tracking: trackingCode
            })
        });
        
        // Note: no-cors mode doesn't allow reading response
        // But the data is still sent to the server
        console.log('Data sent to Google Sheet');
    } catch (error) {
        console.error('Error sending to Google Sheet:', error);
        throw error;
    }
}

/**
 * Show message to user
 */
function showMessage(text, type = 'success') {
    const messageEl = document.getElementById('message');
    if (!messageEl) return;
    
    messageEl.textContent = text;
    messageEl.className = `message ${type} show`;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        messageEl.classList.remove('show');
    }, 3000);
}

/**
 * Play beep sound
 */
function playBeep() {
    try {
        const audio = new Audio(CONFIG.BEEP_SOUND_URL);
        audio.volume = 0.3;
        audio.play().catch(err => {
            // Ignore audio play errors (user interaction required on some browsers)
            console.log('Audio play prevented:', err);
        });
    } catch (error) {
        // Fallback: silent if audio fails
        console.log('Beep sound not available');
    }
}

/**
 * Vibrate device for successful scan (short vibration)
 * VIBRATION API USAGE: Single short pulse for success
 */
function vibrateSuccess() {
    try {
        // Check if vibration API is supported
        if ('vibrate' in navigator) {
            // Success pattern: single short vibration (100ms)
            navigator.vibrate(100);
        }
    } catch (error) {
        // Vibration not supported or failed
        console.log('Vibration not available');
    }
}

/**
 * Vibrate device for duplicate scan (different pattern)
 * VIBRATION API USAGE: Pattern of short pulses for duplicate/error
 */
function vibrateDuplicate() {
    try {
        // Check if vibration API is supported
        if ('vibrate' in navigator) {
            // Duplicate pattern: two short vibrations (100ms on, 50ms off, 100ms on)
            navigator.vibrate([100, 50, 100]);
        }
    } catch (error) {
        // Vibration not supported or failed
        console.log('Vibration not available');
    }
}

/**
 * Show visual feedback (green border on success, red on duplicate)
 */
function showVisualFeedback(type) {
    const container = document.getElementById('scannerContainer');
    if (!container) return;
    
    // Remove existing classes
    container.classList.remove('scan-success', 'scan-duplicate');
    
    // Add appropriate class
    if (type === 'success') {
        container.classList.add('scan-success');
        // Remove after animation
        setTimeout(() => {
            container.classList.remove('scan-success');
        }, 500);
    } else if (type === 'duplicate') {
        container.classList.add('scan-duplicate');
        // Remove after animation
        setTimeout(() => {
            container.classList.remove('scan-duplicate');
        }, 500);
    }
}

/**
 * Play error sound for duplicate scans
 */
function playErrorSound() {
    try {
        // Create a lower-pitched beep for errors
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 300; // Lower frequency for error
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
        // Fallback: silent if audio fails
        console.log('Error sound not available');
    }
}

/**
 * Show scanned code in the scanner overlay
 */
function showScannedCode(trackingCode) {
    const displayEl = document.getElementById('scannedCodeDisplay');
    if (!displayEl) return;
    
    // Show the scanned code
    displayEl.textContent = `✓ Scanned: ${trackingCode}`;
    displayEl.classList.add('show');
    
    // Hide after 3 seconds
    setTimeout(() => {
        displayEl.classList.remove('show');
        // Clear text after animation
        setTimeout(() => {
            displayEl.textContent = '';
        }, 300);
    }, 3000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

