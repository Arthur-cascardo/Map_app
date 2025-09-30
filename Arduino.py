import re
import json
import requests
import time
import serial
import logging


class Arduino:
    def __init__(self, url, memory_url, port, baudrate):
        """
        Initialize Arduino communication class.

        Args:
            url (str): URL for fetching visible markers
            memory_url (str): URL for fetching memory triggers
            port (str): Serial port (e.g., 'COM5', '/dev/ttyUSB0')
            baudrate (int): Serial communication speed
        """
        self.url = url
        self.memory_url = memory_url
        self.port = port
        self.baudrate = baudrate
        self.marker_colors = {}
        self.serial_connection = None

        # Setup logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)

        self.logger.info(f"Arduino class initialized - Port: {port}, Baudrate: {baudrate}")

    def load_marker_colors(self, markers_file_path):
        """Load marker colors from local JSON file"""
        try:
            with open(markers_file_path, 'r') as file:
                data = json.load(file)

            # Pattern to extract number from popup_text like "New Marker (1)"
            pattern = r'\((\d+)\)'
            colors_loaded = 0

            for marker_id, marker_data in data.get('markers', {}).items():
                popup_text = marker_data.get('popup_text', '')
                color_hex = marker_data.get('color', '#FFFFFF')

                # Extract marker number from popup text
                match = re.search(pattern, popup_text)
                if match:
                    marker_number = int(match.group(1))
                    rgb_color = self.hex_to_rgb(color_hex)
                    self.marker_colors[marker_number] = rgb_color
                    colors_loaded += 1

            self.logger.info(f"Loaded {colors_loaded} marker colors from {markers_file_path}")

        except FileNotFoundError:
            self.logger.error(f"Marker file not found: {markers_file_path}")
            self.marker_colors = {}
        except json.JSONDecodeError:
            self.logger.error(f"Error parsing JSON file: {markers_file_path}")
            self.marker_colors = {}
        except Exception as e:
            self.logger.error(f"Error loading marker colors: {e}")
            self.marker_colors = {}

    def fetch_visible_markers(self):
        """Fetch currently visible markers from Flask server"""
        try:
            response = requests.get(self.url, timeout=5)
            response.raise_for_status()
            result = response.json()

            # Extract marker numbers from names using regex
            numbers = []
            pattern = r'\((\d+)\)'

            for name in result.get('marker_names', []):
                match = re.search(pattern, name)
                if match:
                    numbers.append(int(match.group(1)))

            return numbers

        except requests.exceptions.RequestException as e:
            self.logger.warning(f"Failed to fetch visible markers: {e}")
            return []

    def fetch_memory_trigger(self):
        """Check for memory view trigger from Flask server"""
        try:
            response = requests.get(self.memory_url, timeout=5)
            response.raise_for_status()
            result = response.json()

            if result.get('has_trigger', False):
                trigger_data = result.get('trigger_data', [])
                marker_number = result.get('marker_number', 0)
                color_rgb = result.get('color_rgb', [255, 255, 255])

                self.logger.info(f"Memory trigger detected - Marker: {marker_number}, RGB: {tuple(color_rgb)}")
                return trigger_data

            return None

        except requests.exceptions.RequestException as e:
            self.logger.warning(f"Memory trigger request failed: {e}")
            return None

    def hex_to_rgb(self, hex_color):
        """Convert hex color string to RGB tuple"""
        if hex_color.startswith('#'):
            hex_color = hex_color[1:]
        try:
            return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            self.logger.warning(f"Invalid hex color: {hex_color}")
            return (255, 255, 255)  # Default to white

    def get_marker_color(self, marker_id):
        """Get RGB color for a specific marker ID from loaded data"""
        return self.marker_colors.get(marker_id, (255, 255, 255))

    def create_position_mask(self, marker_list):
        """Generate 16-bit position mask from marker list"""
        try:
            mask = 0
            for marker_num in marker_list:
                if 1 <= marker_num <= 16:
                    mask |= 1 << (16 - marker_num)
            return mask
        except (TypeError, ValueError):
            return 0

    def create_regular_packet(self, marker_list):
        """
        Create 50-byte packet for regular LED data.
        Format: [position_high][position_low][RGB_data_48_bytes]
        """
        try:
            # Create position mask
            position_mask = self.create_position_mask(marker_list)
            position_bytes = position_mask.to_bytes(2, byteorder="big")

            # Create RGB data for all 16 LEDs (3 bytes each = 48 total)
            color_data = bytearray()
            for led_id in range(1, 17):
                if led_id in marker_list:
                    r, g, b = self.get_marker_color(led_id)
                else:
                    r, g, b = 0, 0, 0  # Off
                color_data.extend([r, g, b])

            # Combine into 50-byte packet
            packet = position_bytes + bytes(color_data)
            return packet

        except Exception as e:
            self.logger.error(f"Error creating regular packet: {e}")
            return b'\x00' * 50  # Return empty packet

    def create_memory_packet(self, trigger_data):
        """
        Convert memory trigger data to bytes packet.
        The trigger_data should already be the 50-byte array from server.
        """
        try:
            if not trigger_data or len(trigger_data) != 50:
                self.logger.error(f"Invalid trigger data length: {len(trigger_data) if trigger_data else 0}")
                return None

            # Convert to bytes if needed
            if isinstance(trigger_data, list):
                return bytes(trigger_data)
            return trigger_data

        except Exception as e:
            self.logger.error(f"Error creating memory packet: {e}")
            return None

    def open_serial_connection(self):
        """Open serial connection to Arduino"""
        try:
            if self.serial_connection and self.serial_connection.is_open:
                return True

            self.serial_connection = serial.Serial(self.port, self.baudrate, timeout=1)
            time.sleep(2)  # Arduino reset delay
            self.logger.info(f"Serial connection opened on {self.port}")
            return True

        except serial.SerialException as e:
            self.logger.error(f"Failed to open serial connection: {e}")
            return False

    def close_serial_connection(self):
        """Close serial connection"""
        try:
            if self.serial_connection and self.serial_connection.is_open:
                self.serial_connection.close()
                self.logger.info("Serial connection closed")
        except Exception as e:
            self.logger.error(f"Error closing serial connection: {e}")

    def send_packet(self, packet):
        """Send packet to Arduino via serial"""
        try:
            if not self.serial_connection or not self.serial_connection.is_open:
                if not self.open_serial_connection():
                    return False

            self.serial_connection.write(packet)
            return True

        except serial.SerialException as e:
            self.logger.error(f"Serial communication error: {e}")
            return False

    def read_arduino_response(self):
        """Read response from Arduino if available"""
        try:
            if self.serial_connection and self.serial_connection.in_waiting > 0:
                response = self.serial_connection.readline().decode('utf-8').strip()
                if response:
                    self.logger.info(f"Arduino: {response}")
                return response
        except Exception as e:
            self.logger.warning(f"Error reading Arduino response: {e}")
        return None

    def run_communication_to_arduino(self):
        """Main communication loop"""
        if not self.open_serial_connection():
            self.logger.error("Cannot start communication - serial connection failed")
            return

        try:
            while True:
                time.sleep(0.3)  # Communication interval

                # Priority 1: Check for memory triggers
                memory_trigger = self.fetch_memory_trigger()
                if memory_trigger:
                    packet = self.create_memory_packet(memory_trigger)
                    if packet and self.send_packet(packet):
                        # Extract info for logging
                        header = packet[:4].hex()
                        marker_num = packet[4]
                        r, g, b = packet[5], packet[6], packet[7]

                        self.logger.info(f"MEMORY TRIGGER SENT - Header: {header}, "
                                         f"Marker: {marker_num}, RGB: ({r},{g},{b})")
                    continue

                # Priority 2: Send regular marker data
                markers = self.fetch_visible_markers()
                packet = self.create_regular_packet(markers)

                if self.send_packet(packet):
                    # Extract position for logging
                    position_mask = int.from_bytes(packet[:2], byteorder="big")
                    active_count = bin(position_mask).count('1')

                    self.logger.info(f"REGULAR DATA SENT - Active LEDs: {active_count}, "
                                     f"Position: 0b{position_mask:016b}")

                # Check for Arduino responses
                self.read_arduino_response()

                # Reload marker colors periodically
                self.reload_marker_colors('server_storage.json')

        except KeyboardInterrupt:
            self.logger.info("Communication stopped by user")
        except Exception as e:
            self.logger.error(f"Communication error: {e}")
        finally:
            self.close_serial_connection()

    def reload_marker_colors(self, markers_file_path):
        """Reload marker colors from file"""
        self.load_marker_colors(markers_file_path)

    def set_marker_color_override(self, marker_id, rgb_tuple):
        """Override a marker color temporarily"""
        if isinstance(rgb_tuple, tuple) and len(rgb_tuple) == 3:
            self.marker_colors[marker_id] = rgb_tuple
            self.logger.info(f"Color override set for marker {marker_id}: {rgb_tuple}")
        else:
            self.logger.error(f"Invalid RGB tuple for marker {marker_id}: {rgb_tuple}")

    def get_status(self):
        """Get current status of the Arduino connection"""
        return {
            'serial_connected': self.serial_connection is not None and self.serial_connection.is_open,
            'port': self.port,
            'baudrate': self.baudrate,
            'loaded_colors': len(self.marker_colors),
            'urls': {
                'markers': self.url,
                'memory': self.memory_url
            }
        }