console.log('Starting context menu initialization...');
console.log('Looking for map div ID: {{MAP_DIV_ID}}');
console.log('Expected map variable: {{MAP_VAR_NAME}}');

var globalMap = null;
var rightClickCoords = null;
var contextMenuElement = null;
var setupAttempts = 0;
var maxSetupAttempts = 50;
var visibleMarkersInterval = null;

// Store marker data for visibility checking
var allMarkersData = {{MARKERS_DATA}};

// Color options for markers
var markerColors = {
    'blue': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    'red': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    'green': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    'orange': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
    'yellow': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
    'violet': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
    'grey': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    'black': 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png'
};

// Predefined color palette for quick selection
var colorPalette = [
    '#ff0000', '#00ff00', '#0000ff', '#ff9900',
    '#ffff00', '#ff00ff', '#00ffff', '#9900ff',
    '#ff6666', '#66ff66', '#6666ff', '#ffcc66',
    '#ccff66', '#66ccff', '#ff66cc', '#cc66ff'
];

// ======================== MAP STATE PRESERVATION ========================
function saveMapState() {
    if (!globalMap) return;

    var center = globalMap.getCenter();
    var zoom = globalMap.getZoom();

    var mapState = {
        lat: center.lat,
        lng: center.lng,
        zoom: zoom,
        timestamp: Date.now()
    };

    // Store in sessionStorage (will persist during page reload but not across browser sessions)
    try {
        sessionStorage.setItem('mapState', JSON.stringify(mapState));
        console.log('Map state saved:', mapState);
    } catch (e) {
        console.warn('Could not save map state:', e);
    }
}

function restoreMapState() {
    if (!globalMap) return;

    try {
        var savedState = sessionStorage.getItem('mapState');
        if (savedState) {
            var mapState = JSON.parse(savedState);

            // Only restore if the state was saved recently (within 30 seconds)
            // This prevents restoring very old states
            if (Date.now() - mapState.timestamp < 30000) {
                console.log('Restoring map state:', mapState);
                globalMap.setView([mapState.lat, mapState.lng], mapState.zoom);

                // Clear the saved state after restoring
                sessionStorage.removeItem('mapState');
            } else {
                console.log('Map state too old, not restoring');
                sessionStorage.removeItem('mapState');
            }
        }
    } catch (e) {
        console.warn('Could not restore map state:', e);
    }
}

// Helper function to get display colors
function getColorHex(colorName) {
    var colors = {
        'blue': '#0066cc',
        'red': '#cc0000',
        'green': '#00cc00',
        'orange': '#ff8800',
        'yellow': '#ffcc00',
        'violet': '#8800cc',
        'grey': '#808080',
        'black': '#333333'
    };
    return colors[colorName] || '#0066cc';
}

// Helper function to create colored marker icons
function createDefaultColoredMarkerIcon(color) {

   return L.icon({
    iconUrl: "https://raw.githubusercontent.com/Arthur-cascardo/Files/refs/heads/main/pinwithshadow2.png",
    shadowUrl: 'https://raw.githubusercontent.com/Arthur-cascardo/Files/refs/heads/main/240_F_575062297_mNZCb6oLPOpTVIRQuZBSNT1xDsMezbi4%20(1).png',
    iconSize:     [30, 41],   // your custom marker size
    iconAnchor:   [15, 41],   // horizontally centered, bottom tip
    popupAnchor:  [0, -35],   // popup sits above marker
    shadowSize:   [41, 41],   // scaled wider for the 30px icon
    shadowAnchor: [15, 41]    // aligns bottom center of shadow with marker tip
   });
}

// Helper function to convert HSL to Hex
function hslToHex(h, s, l) {
    l /= 100;
    s /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// Helper function to draw color wheel
function drawColorWheel(ctx, centerX, centerY, radius) {
    for (let angle = 0; angle < 360; angle++) {
        for (let r = 0; r < radius; r++) {
            const rad = (angle * Math.PI) / 180;
            const x = centerX + r * Math.cos(rad);
            const y = centerY + r * Math.sin(rad);
            const saturation = r / radius;
            const hslColor = `hsl(${angle}, ${saturation * 100}%, 50%)`;
            ctx.fillStyle = hslColor;
            ctx.fillRect(x, y, 1, 1);
        }
    }
}

function findAndSetupMap() {
    setupAttempts++;
    console.log('Setup attempt:', setupAttempts);

    // Method 1: Try to find the map div and get the Leaflet instance from it
    var mapDiv = document.getElementById('{{MAP_DIV_ID}}');
    if (mapDiv && mapDiv._leaflet_map) {
        globalMap = mapDiv._leaflet_map;
        console.log('Found map via div._leaflet_map');
        initializeMapFeatures();
        return;
    }

    // Method 2: Try the global variable approach
    if (typeof window['{{MAP_VAR_NAME}}'] !== 'undefined') {
        globalMap = window['{{MAP_VAR_NAME}}'];
        console.log('Found map via global variable');
        initializeMapFeatures();
        return;
    }

    // Method 3: Search through all global variables for Leaflet maps
    for (var key in window) {
        if (key.startsWith('map_') && window[key] && typeof window[key].on === 'function') {
            try {
                if (window[key].getCenter && typeof window[key].getCenter === 'function') {
                    globalMap = window[key];
                    console.log('Found map via global search:', key);
                    initializeMapFeatures();
                    return;
                }
            } catch (e) {
                console.log('Not a leaflet map:', key);
            }
        }
    }

    // Method 4: Try to find any div with a leaflet-container class
    var leafletContainers = document.querySelectorAll('.leaflet-container');
    if (leafletContainers.length > 0) {
        var container = leafletContainers[0];
        if (container._leaflet_map) {
            globalMap = container._leaflet_map;
            console.log('Found map via leaflet-container class');
            initializeMapFeatures();
            return;
        }
    }

    if (setupAttempts < maxSetupAttempts) {
        setTimeout(findAndSetupMap, 200);
    } else {
        console.error('Could not find Leaflet map after', maxSetupAttempts, 'attempts');
        tryFallbackMapDetection();
    }
}

function tryFallbackMapDetection() {
    for (var prop in window) {
        try {
            if (window[prop] &&
                typeof window[prop] === 'object' &&
                window[prop].hasOwnProperty('_container') &&
                window[prop].hasOwnProperty('_zoom')) {
                globalMap = window[prop];
                console.log('Found map via fallback detection:', prop);
                initializeMapFeatures();
                return;
            }
        } catch (e) {}
    }
    console.error('Absolutely no Leaflet map found');
}

function initializeMapFeatures() {
    if (!globalMap) {
        console.error('Cannot initialize features: no map found');
        return;
    }

    console.log('Initializing map features...');
    setupContextMenu();
    enforceWorldBounds();
    startVisibleMarkersTracking();
    setupSearchBox();

    // Restore map state after all features are initialized
    setTimeout(() => {
        restoreMapState();
    }, 0);

    console.log('Map features initialized successfully');
}

// ======================== ENHANCED COLOR PICKER DIALOG ========================
function showColorPicker(callback) {
    var existing = document.getElementById('colorPicker');
    if (existing) document.body.removeChild(existing);

    var picker = document.createElement('div');
    picker.id = 'colorPicker';
    picker.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000;" onclick="closeColorPicker()">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 25px; border-radius: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 450px; font-family: Arial, sans-serif;" onclick="event.stopPropagation()">
                <h3 style="margin: 0 0 20px 0; color: #333; text-align: center;">Choose Marker Color</h3>
                <!-- Color Wheel Section -->
                <div style="text-align: center; margin-bottom: 20px;">
                    <canvas id="addColorWheel" width="150" height="150" style="cursor: crosshair; border: 2px solid #ddd; border-radius: 50%; margin-bottom: 15px;"></canvas>
                </div>

                <!-- Selected Color Display -->
                <div style="text-align: center; margin-bottom: 20px;">
                    <div style="display: inline-flex; align-items: center; gap: 10px;">
                        <span style="color: #666;">Selected:</span>
                        <div id="addSelectedColorBox" style="width: 30px; height: 30px; border: 2px solid #333; border-radius: 6px; background: ${getColorHex('blue')};"></div>
                        <input type="text" id="addColorHexInput" value="${getColorHex('blue')}" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; width: 70px; font-size: 12px;" readonly>
                    </div>
                </div>

                <!-- Color Palette -->
                <div style="margin-bottom: 20px;">
                    <div style="text-align: center; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 12px;">Color Palette:</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px;">
                        ${colorPalette.slice(0, 16).map(color => `
                            <div onclick="selectAddPresetColor('${color}')" style="width: 24px; height: 24px; background: ${color}; border: 2px solid #ddd; border-radius: 4px; cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'; this.style.borderColor='#333'" onmouseout="this.style.transform='scale(1)'; this.style.borderColor='#ddd'"></div>
                        `).join('')}
                    </div>
                </div>

                <!-- Action Buttons -->
                <div style="text-align: center; display: flex; gap: 10px; justify-content: center;">
                    <button onclick="confirmColorSelection()" style="padding: 12px 20px; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">Use This Color</button>
                    <button onclick="closeColorPicker()" style="padding: 12px 20px; border: 1px solid #ddd; border-radius: 8px; background: #f8f9fa; cursor: pointer;">Cancel</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(picker);
    window.colorPickerCallback = callback;
    window.selectedAddColor = 'blue';
    window.selectedAddColorHex = getColorHex('blue');

    // Initialize color wheel after a short delay to ensure DOM is ready
    setTimeout(() => {
        initializeAddColorWheel();
    }, 100);
}

function initializeAddColorWheel() {
    var canvas = document.getElementById('addColorWheel');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var radius = 65;

    drawColorWheel(ctx, centerX, centerY, radius);

    canvas.addEventListener('click', function(event) {
        var rect = canvas.getBoundingClientRect();
        var x = event.clientX - rect.left - centerX;
        var y = event.clientY - rect.top - centerY;

        var distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
            var angle = Math.atan2(y, x);
            var hue = (angle * 180 / Math.PI + 360) % 360;
            var saturation = Math.min(distance / radius, 1);
            var lightness = 0.5;

            var color = hslToHex(hue, saturation * 100, lightness * 100);
            updateAddSelectedColor(color);
        }
    });
}

window.selectAddPresetColor = function(color) {
    updateAddSelectedColor(color, false); // Palette colors are hex values
};

window.selectColorFromPicker = function(colorName) {
    var hexColor = getColorHex(colorName);
    updateAddSelectedColor(hexColor);
    window.selectedAddColor = colorName;
};

function updateAddSelectedColor(color) {
    window.selectedAddColorHex = color;
    // Use hex directly
    window.selectedAddColor = color; // Use hex value directly

    var colorBox = document.getElementById('addSelectedColorBox');
    var hexInput = document.getElementById('addColorHexInput');

    if (colorBox) colorBox.style.background = color;
    if (hexInput) hexInput.value = color;
}

window.confirmColorSelection = function() {
    // Use the hex value directly instead of converting to predefined color
    var selectedColor = window.selectedAddColorHex || '#0066cc';
    closeColorPicker();

    if (window.colorPickerCallback) {
        window.colorPickerCallback(selectedColor);
    } else if (rightClickCoords) {
        var text = prompt("Enter marker description:", "New Marker");
        if (text && text.trim()) {
            addMarker(rightClickCoords.lat, rightClickCoords.lng, text.trim(), selectedColor);
        }
    }
};

window.selectColor = function(color) {
    // Keep this for backward compatibility, but redirect to new function
    selectColorFromPicker(color);
};

window.closeColorPicker = function() {
    var picker = document.getElementById('colorPicker');
    if (picker) document.body.removeChild(picker);
    window.colorPickerCallback = null;
    window.selectedAddColor = null;
    window.selectedAddColorHex = null;
};

// ======================== CONTEXT MENU SETUP ========================
function setupContextMenu() {
    if (!globalMap) {
        console.error('Cannot setup context menu: no map found');
        return;
    }

    console.log('Setting up context menu...');
    if (!contextMenuElement) {
        contextMenuElement = document.createElement('div');
        contextMenuElement.innerHTML = `
            <div id="contextMenu" style="position: absolute; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); padding: 4px 0; z-index: 9999; display: none; min-width: 160px; font-family: Arial, sans-serif;">
                <div onclick="addMarkerWithColorPicker()" style="padding: 10px 16px; cursor: pointer; color: #333; font-size: 14px; border-bottom: 1px solid #f0f0f0;" onmouseover="this.style.backgroundColor='#f8f9fa'" onmouseout="this.style.backgroundColor='white'">
                    &#128205; Add Marker Here
                </div>
                <div onclick="hideContextMenu()" style="padding: 10px 16px; cursor: pointer; color: #333; font-size: 14px;" onmouseover="this.style.backgroundColor='#f8f9fa'" onmouseout="this.style.backgroundColor='white'">
                    &#10060; Cancel
                </div>
            </div>
        `;
        document.body.appendChild(contextMenuElement);
    }

    var mapContainer = globalMap.getContainer();
    if (mapContainer) {
        mapContainer.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();

            var rect = mapContainer.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var point = L.point(x, y);
            rightClickCoords = globalMap.containerPointToLatLng(point);

            console.log('Right click at:', rightClickCoords);
            showContextMenu(e.clientX, e.clientY);
        });

        globalMap.on('click', hideContextMenu);
        document.addEventListener('click', function(e) {
            var menu = document.getElementById('contextMenu');
            if (menu && !menu.contains(e.target)) hideContextMenu();
        });

        console.log('Context menu event listeners added');
    } else {
        console.error('Map container not found');
    }
}

function showContextMenu(x, y) {
    var menu = document.getElementById('contextMenu');
    if (menu) {
        var menuWidth = 160;
        var menuHeight = 80;
        x = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
        y = Math.max(10, Math.min(y, window.innerHeight - menuHeight - 10));

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';
        console.log('Context menu shown at:', x, y);
    }
}

window.hideContextMenu = function() {
    var menu = document.getElementById('contextMenu');
    if (menu) menu.style.display = 'none';
};

window.addMarkerWithColorPicker = function() {
    console.log('Add marker with color picker clicked');
    hideContextMenu();

    if (!rightClickCoords) {
        console.error('No right click coordinates available');
        alert('Error: No location selected');
        return;
    }

    showColorPicker(function(color) {
        var text = prompt("Enter marker description:", "New Marker");
        if (text && text.trim()) {
            console.log('Adding marker at:', rightClickCoords, 'with color:', color);
            addMarker(rightClickCoords.lat, rightClickCoords.lng, text.trim(), color);
        }
    });
};

// ======================== MARKER OPERATIONS ========================
function addMarker(lat, lon, text, color) {
    console.log('Attempting to add marker:', { lat, lon, text, color });

    // Save current map state before making the request
    saveMapState();

    fetch('/add_marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            lat: lat,
            lon: lon,
            popup_text: text,
            color: color || '#ffffff'
        })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Add marker response:', data);
        if (data.status === 'success') {
            alert('Marker added successfully!');
            location.reload();
        } else {
            // Clear saved state if there was an error
            sessionStorage.removeItem('mapState');
            alert('Error: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error adding marker:', error);
        // Clear saved state if there was an error
        sessionStorage.removeItem('mapState');
        alert('Failed to add marker: ' + error.message);
    });
}

window.editMarkerPrompt = function(markerId) {
    console.log('Editing marker:', markerId);

    fetch('/get_marker/' + markerId)
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            showEditDialog(markerId, data.marker.popup_text, data.marker.color || 'blue');
        } else {
            alert('Error getting marker data: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error getting marker data:', error);
        alert('Failed to get marker data');
    });
};

function showEditDialog(markerId, currentText, currentColor) {
    var existing = document.getElementById('editDialog');
    if (existing) document.body.removeChild(existing);

    // Handle both hex colors and predefined color names
    var displayColor = currentColor.startsWith('#') ? currentColor : getColorHex(currentColor);

    var dialog = document.createElement('div');
    dialog.id = 'editDialog';
    dialog.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000;" onclick="closeEditDialog()">
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 25px; border-radius: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 450px; font-family: Arial, sans-serif;" onclick="event.stopPropagation()">
                <h3 style="margin: 0 0 20px 0; color: #333;">Edit Marker</h3>

                <label style="display: block; margin-bottom: 5px; color: #555; font-weight: bold;">Description:</label>
                <input type="text" id="editText" value="${currentText.replace(/"/g, '&quot;')}" style="width: 100%; padding: 10px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 14px;">

                <label style="display: block; margin-bottom: 10px; color: #555; font-weight: bold;">Color:</label>

                <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span style="color: #666;">Current:</span>
                    <div id="currentEditColorBox" style="width: 30px; height: 30px; border: 2px solid #333; border-radius: 6px; background: ${displayColor};"></div>
                    <span style="color: #666;">${currentColor}</span>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <canvas id="editColorWheel" width="150" height="150" style="cursor: crosshair; border: 2px solid #ddd; border-radius: 50%;"></canvas>
                </div>

                <div style="text-align: center; margin-bottom: 15px;">
                    <div style="display: inline-flex; align-items: center; gap: 10px;">
                        <span style="color: #666;">New:</span>
                        <div id="editSelectedColorBox" style="width: 30px; height: 30px; border: 2px solid #333; border-radius: 6px; background: ${displayColor};"></div>
                        <input type="text" id="editColorHexInput" value="${displayColor}" style="padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; width: 70px; font-size: 12px;" readonly>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <div style="text-align: center; margin-bottom: 8px;">
                        <span style="color: #666; font-size: 12px;">Quick Select:</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px;">
                        ${colorPalette.slice(0, 16).map(color => `
                            <div onclick="selectEditPresetColor('${color}')" style="width: 24px; height: 24px; background: ${color}; border: 2px solid #ddd; border-radius: 4px; cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'; this.style.borderColor='#333'" onmouseout="this.style.transform='scale(1)'; this.style.borderColor='#ddd'"></div>
                        `).join('')}
                    </div>
                </div>

                <div style="text-align: center; display: flex; gap: 10px; justify-content: center;">
                    <button onclick="saveEdit('${markerId}')" style="padding: 12px 20px; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">Save</button>
                    <button onclick="closeEditDialog()" style="padding: 12px 20px; border: 1px solid #ddd; border-radius: 8px; background: #f8f9fa; cursor: pointer;">Cancel</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    window.selectedEditColor = currentColor;
    window.selectedEditColorHex = displayColor;

    setTimeout(() => {
        var input = document.getElementById('editText');
        if (input) {
            input.focus();
            input.select();
        }
        initializeEditColorWheel();
    }, 100);
}

function initializeEditColorWheel() {
    var canvas = document.getElementById('editColorWheel');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var radius = 65;

    drawColorWheel(ctx, centerX, centerY, radius);

    canvas.addEventListener('click', function(event) {
        var rect = canvas.getBoundingClientRect();
        var x = event.clientX - rect.left - centerX;
        var y = event.clientY - rect.top - centerY;

        var distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
            var angle = Math.atan2(y, x);
            var hue = (angle * 180 / Math.PI + 360) % 360;
            var saturation = Math.min(distance / radius, 1);
            var lightness = 0.5;

            var color = hslToHex(hue, saturation * 100, lightness * 100);
            updateEditSelectedColor(color);
        }
    });
}

window.selectEditPresetColor = function(color) {
    updateEditSelectedColor(color);
};

function updateEditSelectedColor(color) {
    window.selectedEditColorHex = color;
    // Use hex directly
    window.selectedEditColor = color; // Use hex value directly

    var colorBox = document.getElementById('editSelectedColorBox');
    var hexInput = document.getElementById('editColorHexInput');

    if (colorBox) colorBox.style.background = color;
    if (hexInput) hexInput.value = color;
}

window.saveEdit = function(markerId) {
    var text = document.getElementById('editText').value.trim();
    if (!text) {
        alert('Please enter a description');
        return;
    }

    // Use the hex value directly instead of converting to predefined color
    var colorToSave = window.selectedEditColorHex || '#0066cc';

    // Save current map state before making the request
    saveMapState();

    fetch('/edit_marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            marker_id: markerId,
            popup_text: text,
            color: colorToSave
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Marker updated successfully!');
            closeEditDialog();
            location.reload();
        } else {
            // Clear saved state if there was an error
            sessionStorage.removeItem('mapState');
            alert('Error: ' + (data.message || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error updating marker:', error);
        // Clear saved state if there was an error
        sessionStorage.removeItem('mapState');
        alert('Failed to update marker');
    });
};

window.closeEditDialog = function() {
    var dialog = document.getElementById('editDialog');
    if (dialog) document.body.removeChild(dialog);
    window.selectedEditColor = null;
    window.selectedEditColorHex = null;
};

window.deleteMarker = function(markerId) {
    if (confirm("Are you sure you want to delete this marker?")) {
        // Save current map state before making the request
        saveMapState();

        fetch('/delete_marker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marker_id: markerId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                alert('Marker deleted!');
                location.reload();
            } else {
                // Clear saved state if there was an error
                sessionStorage.removeItem('mapState');
                alert('Error: ' + (data.message || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting marker:', error);
            // Clear saved state if there was an error
            sessionStorage.removeItem('mapState');
            alert('Failed to delete marker');
        });
    }
};

// ======================== SEARCH BOX ========================
function setupSearchBox() {
    if (!globalMap) return;
    if (document.getElementById('locationSearchContainer')) return;

    var searchContainer = document.createElement('div');
    searchContainer.id = 'locationSearchContainer';
    searchContainer.innerHTML = `
        <div style="position: fixed; bottom: 10px; left: 10px; background: rgba(255,255,255,0.95); border: 2px solid #333; border-radius: 8px; padding: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); font-family: Arial, sans-serif; min-width: 300px; z-index: 1000;">
            <h4 style="margin: 0 0 8px 0; color: #333; font-size: 14px;">&#128269; Search Location</h4>
            <div style="display: flex; gap: 5px; margin-bottom: 8px;">
                <input type="text" id="locationSearch" placeholder="Enter city, address, or place..." style="flex: 1; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px;">
                <button onclick="searchLocation()" style="padding: 6px 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Search</button>
            </div>
            <div id="searchResults" style="font-size: 11px; color: #666; min-height: 16px;"></div>
        </div>
    `;

    document.body.appendChild(searchContainer);
    document.getElementById('locationSearch').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchLocation();
    });
}

window.searchLocation = function() {
    var query = document.getElementById('locationSearch').value.trim();
    var results = document.getElementById('searchResults');

    if (!query) {
        results.innerHTML = '<span style="color: red;">Please enter a location</span>';
        return;
    }

    results.innerHTML = 'Searching...';

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3`)
    .then(response => response.json())
    .then(data => {
        if (data && data.length > 0) {
            var result = data[0];
            var lat = parseFloat(result.lat);
            var lon = parseFloat(result.lon);

            globalMap.setView([lat, lon], 12);

            if (window.searchMarker) {
                globalMap.removeLayer(window.searchMarker);
            }

            window.searchMarker = L.marker([lat, lon], {
                icon: createDefaultColoredMarkerIcon()
            }).addTo(globalMap);

            var displayName = result.display_name.split(',')[0].replace(/'/g, "\\'");

            window.searchMarker.bindPopup(`
                <div>
                    <h4>Search Result</h4>
                    <p><strong>${result.display_name}</strong></p>
                    <button onclick="addSearchMarkerWithColor(${lat}, ${lon}, '${displayName}')" style="background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-top: 5px;">
                        Add as Marker
                    </button>
                </div>
            `).openPopup();

            results.innerHTML = `<span style="color: green;">Found: ${result.display_name.substring(0, 50)}...</span>`;
        } else {
            results.innerHTML = '<span style="color: red;">No results found</span>';
        }
    })
    .catch(error => {
        console.error('Search error:', error);
        results.innerHTML = '<span style="color: red;">Search failed</span>';
    });
};

window.addSearchMarkerWithColor = function(lat, lon, name) {
    showColorPicker(function(color) {
        var text = prompt("Enter marker description:", name);
        if (text && text.trim()) {
            addMarker(lat, lon, text.trim(), color);
            if (window.searchMarker) {
                globalMap.removeLayer(window.searchMarker);
                window.searchMarker = null;
            }
        }
    });
};

// ======================== MEMORY FUNCTIONS ========================
window.addMemoryPrompt = function(markerId) {
    var memory = prompt("Enter memory (text or URL):");
    if (memory && memory.trim()) {
        // Save current map state before making the request
        saveMapState();

        fetch('/add_memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                marker_id: markerId,
                memory_text: memory.trim()
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                alert('Memory added!');
                location.reload();
            } else {
                // Clear saved state if there was an error
                sessionStorage.removeItem('mapState');
                alert('Error: ' + (data.message || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error adding memory:', error);
            // Clear saved state if there was an error
            sessionStorage.removeItem('mapState');
            alert('Failed to add memory');
        });
    }
};

// ======================== UPDATED MEMORY VIEW FUNCTION ========================
window.viewMemory = function(markerId) {
    console.log('Viewing memory for marker:', markerId);

    fetch('/get_memory/' + markerId)
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            var memory = data.memory;

            // Display the memory to the user
            if (memory.startsWith('http')) {
                window.open(memory, '_blank');
            } else {
                alert('Memory: ' + memory);
            }

            // Log that memory view was triggered (Arduino communication happens server-side)
            console.log('Memory view triggered for marker ' + markerId + ' - Arduino trigger sent to server');

        } else {
            alert('No memory found');
        }
    })
    .catch(error => {
        console.error('Error getting memory:', error);
        alert('Failed to get memory');
    });
};

// ======================== MAP BOUNDS & TRACKING ========================
function enforceWorldBounds() {
    if (!globalMap) return;

    try {
        var bounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));
        globalMap.setMaxBounds(bounds);
        globalMap.options.maxBoundsViscosity = 1.0;
        globalMap.options.worldCopyJump = false;
        globalMap.options.noWrap = true;
        globalMap.options.minZoom = 2;
        globalMap.options.maxZoom = 18;
    } catch (error) {
        console.error('Error setting map bounds:', error);
    }
}

function startVisibleMarkersTracking() {
    if (!globalMap) return;

    try {
        updateVisibleMarkers();
        if (visibleMarkersInterval) clearInterval(visibleMarkersInterval);
        visibleMarkersInterval = setInterval(updateVisibleMarkers, 1000);
        globalMap.on('moveend', updateVisibleMarkers);
        globalMap.on('zoomend', updateVisibleMarkers);
    } catch (error) {
        console.error('Error starting visible markers tracking:', error);
    }
}

function updateVisibleMarkers() {
    if (!globalMap || !allMarkersData) return;

    try {
        var bounds = globalMap.getBounds();
        var visible = [];

        for (var id in allMarkersData) {
            var marker = allMarkersData[id];
            if (bounds.contains(L.latLng(marker.lat, marker.lon))) {
                visible.push({
                    id: id,
                    name: marker.name,
                    lat: marker.lat,
                    lon: marker.lon
                });
            }
        }

        fetch('/visible_markers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible_markers: visible })
        }).catch(error => {
            console.log('Visible markers update failed:', error);
        });
    } catch (error) {
        console.error('Visible markers error:', error);
    }
}

window.getVisibleMarkers = function() {
    if (!globalMap || !allMarkersData) return [];

    try {
        var bounds = globalMap.getBounds();
        var visible = [];

        for (var id in allMarkersData) {
            var marker = allMarkersData[id];
            if (bounds.contains(L.latLng(marker.lat, marker.lon))) {
                visible.push(marker);
            }
        }

        return visible;
    } catch (error) {
        console.error('Error getting visible markers:', error);
        return [];
    }
};

// ======================== INITIALIZATION ========================
function initializeScript() {
    console.log('Initializing script...');

    if (typeof L === 'undefined') {
        console.log('Leaflet not loaded yet, waiting...');
        setTimeout(initializeScript, 500);
        return;
    }

    setTimeout(findAndSetupMap, 1000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeScript);
} else {
    initializeScript();
}