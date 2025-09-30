from flask import Flask, render_template_string, request, jsonify, send_from_directory
import webbrowser
import os
from folium import plugins
import requests
import uuid
import numbers
import re
import json
import random
import time
from Arduino import Arduino
import threading
import logging
from io import BytesIO
import base64
from PIL import Image
import requests
import folium
import numpy as np

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# Create Flask application instance
app = Flask(__name__, static_url_path='/static', static_folder='static')

# Server-side storage for map elements
STORAGE_FILE = "server_storage.json"

# Global variable to store current visible markers
current_visible_markers = []

# Global variable to store memory view trigger data for Arduino
memory_view_trigger = None

# Load once at module level (fastest)
with open('./context_menu.js', 'r') as f:
    JS_TEMPLATE = f.read()

if os.path.exists(STORAGE_FILE):
    with open(STORAGE_FILE, "r") as f:
        server_storage = json.load(f)
else:
    server_storage = {
        'markers': {},
        'paths': {},
        'memories': {}
    }


def get_context_menu_js(map_div_id, map_var_name, markers_data):
    js_content = JS_TEMPLATE.replace('{{MAP_DIV_ID}}', map_div_id)
    js_content = js_content.replace('{{MAP_VAR_NAME}}', map_var_name)
    js_content = js_content.replace('{{MARKERS_DATA}}', json.dumps(markers_data))
    return f"<script>\n{js_content}\n</script>"


def save_storage():
    """Save the server_storage dictionary to JSON."""
    with open(STORAGE_FILE, "w") as f:
        json.dump(server_storage, f, indent=4)


def get_marker_number_from_id(marker_id):
    """
    Convert marker_id to a number between 1-16.
    Uses hash of the marker_id to ensure consistent mapping.
    """
    try:
        # Access the global server_storage dictionary
        global server_storage
        marker_data = server_storage.get('markers', {}).get(marker_id)

        if not marker_data:
            log.warning(f"Marker ID '{marker_id}' not found in server_storage")
            return None

        popup_text = marker_data.get('popup_text', '')

        # Regex to extract number inside parentheses, e.g., "New Marker (12)"
        match = re.search(r'\((\d+)\)', popup_text)
        if match:
            marker_number = int(match.group(1))
            log.info(f"Extracted marker number {marker_number} for ID '{marker_id}'")
            return marker_number
        else:
            log.warning(f"No number found in popup_text for marker ID '{marker_id}'")
            return None

    except Exception as e:
        log.error(f"Error extracting marker number for ID '{marker_id}': {e}")
        return None

def hex_color_to_rgb(hex_color):
    """Convert hex color to RGB tuple."""
    if hex_color.startswith('#'):
        hex_color = hex_color[1:]
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def create_memory_view_array(marker_id, marker_color):
    """
    Create a unique 50-byte array for memory view trigger.
    Format: [4-byte header][MARKER_NUMBER][R][G][B][43 padding bytes]
    """
    # 4-byte header that's very unlikely to occur in regular data
    MEMORY_HEADER = [0xFF, 0xFE, 0xFD, 0xFC]

    marker_number = get_marker_number_from_id(marker_id)
    r, g, b = hex_color_to_rgb(marker_color)

    # Create 50-byte array
    memory_array = [0] * 50
    memory_array[0] = MEMORY_HEADER[0]  # Header byte 1
    memory_array[1] = MEMORY_HEADER[1]  # Header byte 2
    memory_array[2] = MEMORY_HEADER[2]  # Header byte 3
    memory_array[3] = MEMORY_HEADER[3]  # Header byte 4
    memory_array[4] = marker_number  # Marker number (1-16)
    memory_array[5] = r  # Red component
    memory_array[6] = g  # Green component
    memory_array[7] = b  # Blue component
    # Remaining bytes stay as 0 (padding)

    return memory_array


# Cache for colored icons
_icon_cache = {}


def get_colored_marker_icon(color):
    """
    Create or retrieve a custom colored marker icon.
    Recolors only the #7f3a3a area, preserves outline/inner circle.
    Uses caching so each color is generated only once.
    """
    if color in _icon_cache:
        return folium.CustomIcon(
            icon_image=_icon_cache[color],
            icon_size=(30, 41),
            icon_anchor=(12, 41),
            popup_anchor=(1, -34)
        )

    # Download base image
    base_url = "https://raw.githubusercontent.com/Arthur-cascardo/Files/refs/heads/main/pinwithshadow2.png"
    response = requests.get(base_url)
    base_img = Image.open(BytesIO(response.content)).convert("RGBA")

    target_rgb = (127, 58, 58)  # #7f3a3a
    new_rgb = tuple(int(color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

    # Fast recolor with putdata
    data = base_img.getdata()
    new_data = [(new_rgb[0], new_rgb[1], new_rgb[2], a) if (r, g, b) == target_rgb else (r, g, b, a)
                for r, g, b, a in data]
    base_img.putdata(new_data)

    # Encode as base64
    buffer = BytesIO()
    base_img.save(buffer, format="PNG")
    img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    data_url = f"data:image/png;base64,{img_str}"

    # Cache result
    _icon_cache[color] = data_url

    return folium.CustomIcon(
        icon_image=data_url,
        icon_size=(30, 41),
        icon_anchor=(12, 41),
        popup_anchor=(1, -34)
    )


def com_with_arduino():
    arduino_com = Arduino(url='http://127.0.0.1:5000/api/visible_markers',
                          memory_url='http://127.0.0.1:5000/api/memory_trigger',
                          port='COM5',
                          baudrate=9600
                          )
    while True:
        arduino_com.run_communication_to_arduino()
        print("Port is busy or arduino is disconnected.\nRestarting connection in 2s...")
        time.sleep(2)  # delay before retry


class InteractiveWorldMap:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.map = None
        self.markers = []

    def create_base_map(self, center_lat=20.0, center_lon=0.0, zoom_start=3):
        # Create base map with world bounds and no wrap
        self.map = folium.Map(
            location=[center_lat, center_lon],
            zoom_start=zoom_start,
            tiles='OpenStreetMap',
            # Limit the map to show only one world
            max_bounds=True,
            world_copy_jump=False,
            no_wrap=True,
            # Set world bounds to prevent infinite scrolling
            min_lat=-85,
            max_lat=85,
            min_lon=-180,
            max_lon=180,
            # Limit zoom levels to prevent too much zoom in/out
            min_zoom=3,
            max_zoom=18
        )

        # Add different map tile options
        self.add_tile_layers()
        # Add map controls
        self.add_map_controls()

        return self.map

    def add_tile_layers(self):
        # Alternative free tile layers with no_wrap option
        folium.TileLayer(
            tiles='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attr='Esri World Imagery',
            name='Satellite View',
            overlay=False,
            control=True,
            no_wrap=True
        ).add_to(self.map)

    def add_map_controls(self):
        folium.LayerControl().add_to(self.map)
        plugins.Fullscreen().add_to(self.map)
        plugins.MeasureControl().add_to(self.map)

        fmtr = "function(num) {return L.Util.formatNum(num, 4) + ' º ';};"
        plugins.MousePosition(
            position='bottomright',
            separator=' | ',
            empty_string='NaN',
            lng_first=True,
            num_digits=20,
            prefix='Coordinates:',
            lat_formatter=fmtr,
            lng_formatter=fmtr,
        ).add_to(self.map)

        minimap = plugins.MiniMap()
        self.map.add_child(minimap)

    def add_marker(self, lat, lon, popup_text="Marker", tooltip_text=None, color='blue'):
        """Add a marker with custom colored icon."""
        marker = folium.Marker(
            location=[lat, lon],
            popup=folium.Popup(popup_text, max_width=300),
            tooltip=tooltip_text,
            icon=get_colored_marker_icon(color)
        )
        marker.add_to(self.map)
        self.markers.append(marker)
        return marker

    def add_path(self, coordinates, popup_text="Path", color='blue', weight=3):
        polyline = folium.PolyLine(
            locations=coordinates,
            popup=popup_text,
            color=color,
            weight=weight,
            opacity=0.8
        )
        polyline.add_to(self.map)
        return polyline


@app.route('/')
def index():
    # Create map instance
    world_map = InteractiveWorldMap()
    world_map.create_base_map()

    # Add existing markers from storage
    for marker_id, marker_data in server_storage['markers'].items():
        memory_text = server_storage['memories'].get(marker_id)

        # Get the color from marker data, default to 'blue'
        marker_color = marker_data.get('color', 'blue')

        popup_content_html = f"""
            <div>
                <h4>{marker_data['popup_text']}</h4>
                <p>Lat: {marker_data['lat']:.4f}, Lon: {marker_data['lon']:.4f}</p>
                <p>Color: <span style="color: {marker_color};">● {marker_color.title()}</span></p>
        """
        if memory_text:
            popup_content_html += f"""
                <p>Memory: <span style="color: green;">✓</span></p>
                <button onclick="viewMemory('{marker_id}')">View Memory</button><br>
            """
        else:
            popup_content_html += f"""
                <p>Memory: <span style="color: red;">✗</span></p>
            """

        popup_content_html += f"""
                <button onclick="addMemoryPrompt('{marker_id}')">Add Memory</button>
                <button onclick="editMarkerPrompt('{marker_id}')" style="margin-left: 5px;">Edit Marker</button>
                <button onclick="deleteMarker('{marker_id}')" style="margin-left: 5px; background-color: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Delete Marker</button>
            </div>
        """

        world_map.add_marker(
            lat=marker_data['lat'],
            lon=marker_data['lon'],
            popup_text=popup_content_html,
            tooltip_text=marker_data.get('tooltip_text'),
            color=marker_color
        )

    # Get the map HTML
    map_html = world_map.map.get_root().render()

    # Extract the map variable name and div ID from the generated HTML
    map_var_match = re.search(r'var\s+(map_[A-Za-z0-9_]+)\s*=\s*L\.map\(\s*(?:"|&quot;)([^"&]+)(?:"|&quot;)', map_html)
    if map_var_match:
        map_var_name = map_var_match.group(1)
        map_div_id = map_var_match.group(2)
    else:
        # Fallback
        map_var_name = 'leafletMap'
        map_div_id = 'map'

    # Create marker data dictionary for JavaScript (include color information)
    markers_data = {}
    for mid, mdata in server_storage['markers'].items():
        markers_data[mid] = {
            'lat': mdata['lat'],
            'lon': mdata['lon'],
            'name': mdata['popup_text'],
            'color': mdata.get('color', 'blue')  # Include color in the data
        }

    # Enhanced JavaScript with world bounds enforcement and search functionality
    context_menu_js = get_context_menu_js(map_div_id, map_var_name, markers_data)

    # Insert our JavaScript right before the closing body tag
    if '</body>' in map_html:
        map_html = map_html.replace('</body>', context_menu_js + '\n</body>')
    else:
        map_html = map_html + context_menu_js

    return map_html


# New endpoint to receive visible markers data
@app.route('/visible_markers', methods=['POST'])
def visible_markers_route():
    try:
        global current_visible_markers
        data = request.json
        visible_markers = data.get('visible_markers', [])
        current_visible_markers = visible_markers

        # Log visible markers (you can process this data as needed)
        marker_names = [marker['name'] for marker in visible_markers]

        return jsonify({
            "status": "success",
            "visible_count": len(current_visible_markers),
            "marker_names": marker_names
        })

    except Exception as e:
        print(f"Error processing visible markers: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# API endpoint to get visible markers programmatically
# Make sure you have the global variable declared at the top of your file
current_visible_markers = []


@app.route('/api/visible_markers', methods=['GET'])  # Changed to GET since you're retrieving
def api_visible_markers():
    """
    API endpoint that returns currently stored visible markers.
    """
    try:
        global current_visible_markers

        # Use the stored markers instead of reading from request
        visible_markers = current_visible_markers
        marker_names = [marker['name'] for marker in visible_markers]

        return jsonify({
            "status": "success",
            "visible_markers": visible_markers,
            "count": len(visible_markers),
            "marker_names": marker_names  # Added this for consistency
        })

    except Exception as e:
        print(f"Error getting visible markers via API: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# New API endpoint to get memory trigger data for Arduino
@app.route('/api/memory_trigger', methods=['GET'])
def api_memory_trigger():
    """
    API endpoint that returns memory view trigger data for Arduino.
    Returns the 50-byte array when a memory view has been triggered.
    """
    try:
        global memory_view_trigger

        if memory_view_trigger is not None:
            # Get the trigger data and clear it (one-time use)
            trigger_data = memory_view_trigger.copy()
            memory_view_trigger = None  # Clear after reading

            return jsonify({
                "status": "success",
                "has_trigger": True,
                "trigger_data": trigger_data,
                "marker_number": trigger_data[1],
                "color_rgb": [trigger_data[2], trigger_data[3], trigger_data[4]]
            })
        else:
            return jsonify({
                "status": "success",
                "has_trigger": False,
                "trigger_data": None
            })

    except Exception as e:
        print(f"Error getting memory trigger via API: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/add_marker', methods=['POST'])
def add_marker_route():
    try:
        data = request.json
        lat = data.get('lat')
        lon = data.get('lon')
        popup_text = data.get('popup_text', 'Marker')
        color = data.get('color', 'blue')  # Get color from request

        print(f"Received marker request: lat={lat}, lon={lon}, text='{popup_text}', color='{color}'")

        # Validate coordinates
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return jsonify({"status": "error", "message": "Invalid coordinates"}), 400

        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return jsonify({"status": "error", "message": "Coordinates out of range"}), 400

        # Generate unique ID and store
        marker_id = str(uuid.uuid4())
        server_storage['markers'][marker_id] = {
            'lat': lat,
            'lon': lon,
            'popup_text': popup_text,
            'tooltip_text': None,
            'color': color  # Store the color
        }

        print(f"Added marker: {popup_text} at ({lat:.4f}, {lon:.4f}) with color {color} and ID {marker_id}")
        print(f"Total markers in storage: {len(server_storage['markers'])}")
        save_storage()

        return jsonify({
            "status": "success",
            "message": "Marker added successfully",
            "marker_id": marker_id
        })

    except Exception as e:
        print(f"Error adding marker: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/add_memory', methods=['POST'])
def add_memory_route():
    try:
        data = request.json
        marker_id = data.get('marker_id')
        memory_text = data.get('memory_text')

        if not marker_id or not memory_text:
            return jsonify({"status": "error", "message": "Missing marker_id or memory_text"}), 400

        if marker_id in server_storage['markers']:
            server_storage['memories'][marker_id] = memory_text
            # Keep the original color when adding memory
            print(f"Added memory for marker {marker_id}: {memory_text}")
            save_storage()
            return jsonify({"status": "success", "message": "Memory added successfully"})
        else:
            return jsonify({"status": "error", "message": "Marker not found"}), 404

    except Exception as e:
        print(f"Error adding memory: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/get_memory/<marker_id>')
def get_memory_route(marker_id):
    try:
        global memory_view_trigger

        memory = server_storage['memories'].get(marker_id)
        if memory:
            # Get marker data to extract color
            marker_data = server_storage['markers'].get(marker_id)
            if marker_data:
                marker_color = marker_data.get('color', '#0000ff')  # Default to blue

                # Create and store the memory view trigger array
                memory_view_trigger = create_memory_view_array(marker_id, marker_color)

                marker_number = get_marker_number_from_id(marker_id)
                print(f"Memory view triggered for marker {marker_number} (ID: {marker_id}) with color {marker_color}")
                print(f"Trigger array: {memory_view_trigger[:10]}...")  # Print first 10 bytes for debug

            return jsonify({"status": "success", "memory": memory})
        else:
            return jsonify({"status": "error", "message": "No memory found"}), 404
    except Exception as e:
        print(f"Error getting memory: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/get_marker/<marker_id>')
def get_marker_route(marker_id):
    try:
        marker = server_storage['markers'].get(marker_id)
        if marker:
            return jsonify({"status": "success", "marker": marker})
        else:
            return jsonify({"status": "error", "message": "Marker not found"}), 404
    except Exception as e:
        print(f"Error getting marker: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/edit_marker', methods=['POST'])
def edit_marker_route():
    try:
        data = request.json
        marker_id = data.get('marker_id')
        popup_text = data.get('popup_text')
        color = data.get('color')  # Get color from request

        if not marker_id or not popup_text:
            return jsonify({"status": "error", "message": "Missing marker_id or popup_text"}), 400

        if marker_id in server_storage['markers']:
            server_storage['markers'][marker_id]['popup_text'] = popup_text

            # Update color if provided
            if color:
                server_storage['markers'][marker_id]['color'] = color
                print(f"Updated marker {marker_id} color to: {color}")

            print(f"Edited marker {marker_id}: new text '{popup_text}'")
            save_storage()
            return jsonify({"status": "success", "message": "Marker updated successfully"})
        else:
            return jsonify({"status": "error", "message": "Marker not found"}), 404

    except Exception as e:
        print(f"Error editing marker: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/delete_marker', methods=['POST'])
def delete_marker_route():
    try:
        data = request.json
        marker_id = data.get('marker_id')

        if not marker_id:
            return jsonify({"status": "error", "message": "Missing marker_id"}), 400

        if marker_id in server_storage['markers']:
            marker_data = server_storage['markers'][marker_id]
            del server_storage['markers'][marker_id]
            # Also remove any associated memory
            if marker_id in server_storage['memories']:
                del server_storage['memories'][marker_id]
            print(f"Deleted marker: {marker_id} ({marker_data.get('popup_text', 'Unknown')})")
            save_storage()
            return jsonify({"status": "success", "message": "Marker deleted successfully"})
        else:
            return jsonify({"status": "error", "message": "Marker not found"}), 404

    except Exception as e:
        print(f"Error deleting marker: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


def run_flask_app():
    # Disable reloader if running Flask in a separate thread
    # as it can interfere with the main thread's execution.
    app.run(debug=True, port=5000, host='0.0.0.0', use_reloader=False)


if __name__ == '__main__':
    # Start the Flask app in a separate thread
    print("Starting Flask server...")
    flask_thread = threading.Thread(target=run_flask_app)
    flask_thread.start()
    time.sleep(1)
    # After starting the Flask app, initiate the background task thread
    arduino_thread = threading.Thread(target=com_with_arduino)
    arduino_thread.start()

    # You can add more code here to run in the main thread
    print("Main thread continues after launching Flask and background task.")