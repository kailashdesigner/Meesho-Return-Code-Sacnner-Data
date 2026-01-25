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
    scannedCodes: new Set(), // For duplicate detection
    itemCounter: 0,
    scanner: null,
    isScanning: false
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
 * Open barcode scanner overlay
 */
async function openScanner() {
    const overlay = document.getElementById('scannerOverlay');
    const container = document.getElementById('scannerContainer');
    
    if (!overlay || !container) return;
    
    // Show overlay
    overlay.classList.add('active');
    
    // Initialize scanner
    try {
        state.scanner = new Html5Qrcode('scannerContainer');
        
        // Start scanning with smaller square scan area
        await state.scanner.start(
            { facingMode: 'environment' }, // Use back camera on mobile
            {
                fps: 10,
                qrbox: function(viewfinderWidth, viewfinderHeight) {
                    // Make it a smaller square (30% of the smaller dimension)
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                    const qrboxSize = Math.floor(minEdge * 0.3);
                    return { width: qrboxSize, height: qrboxSize };
                },
                aspectRatio: 1.0
            },
            onScanSuccess,
            onScanError
        );
        
        state.isScanning = true;
    } catch (error) {
        console.error('Error starting scanner:', error);
        showMessage('Failed to start camera. Please check permissions.', 'error');
        closeScanner();
    }
}

/**
 * Handle successful barcode scan
 */
async function onScanSuccess(decodedText, decodedResult) {
    // Play beep immediately to indicate successful scan
    playBeep();
    
    // Process the scanned code (scanner continues running, no beep in processTrackingCode)
    await processTrackingCode(decodedText, 'Camera', false);
    
    // Scanner stays open for continuous scanning
}

/**
 * Handle scan errors (continuous scanning)
 */
function onScanError(errorMessage) {
    // Ignore continuous error messages during scanning
    // Only log if it's a critical error
    if (errorMessage && !errorMessage.includes('NotFoundException')) {
        // Silent error handling for continuous scanning
    }
}

/**
 * Close scanner overlay
 */
async function closeScanner() {
    const overlay = document.getElementById('scannerOverlay');
    
    // Stop scanner if running
    if (state.scanner && state.isScanning) {
        try {
            await state.scanner.stop();
            await state.scanner.clear();
        } catch (error) {
            console.error('Error stopping scanner:', error);
        }
        state.isScanning = false;
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
    
    // Check for duplicate
    if (state.scannedCodes.has(trackingCode)) {
        showMessage(`Duplicate: ${trackingCode}`, 'error');
        addToList(trackingCode, entryType, true); // true = isDuplicate
        return false;
    }
    
    // Add to Set (mark as scanned)
    state.scannedCodes.add(trackingCode);
    
    // Add to list with success state
    addToList(trackingCode, entryType, false);
    
    // Play beep sound (only if requested - camera handles its own beep)
    if (playBeepSound) {
        playBeep();
    }
    
    // Show success message
    showMessage(`Added: ${trackingCode}`, 'success');
    
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
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

