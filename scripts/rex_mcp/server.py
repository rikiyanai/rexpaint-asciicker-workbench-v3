from mcp.server import MCPServer
import sys
import os
import subprocess
import glob
import time

# Vendored deps live alongside this file
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from xp_core import XPFile, XPLayer
except ImportError:
    XPFile = None
    XPLayer = None

# Initialize the MCP server
mcp = MCPServer("rex_manager")

REXPAINT_WINE_PATH = os.environ.get(
    "WINE_PATH",
    ""
)
REXPAINT_EXE_PATH = os.environ.get(
    "REXPAINT_EXE_PATH",
    ""
)
REXPAINT_EXE_DIR = os.path.dirname(REXPAINT_EXE_PATH)
WINE_PROCESS_NAME = os.environ.get("WINE_PROCESS_NAME", "wine-preloader")
CLICLICK_PATH = os.environ.get("CLICLICK_PATH", "/opt/homebrew/bin/cliclick")

@mcp.tool()
def ping() -> str:
    """A simple ping tool to verify the server is running."""
    return "pong"

@mcp.tool()
def is_rexpaint_running() -> bool:
    """Check if REXPaint.exe is currently running (via wine)."""
    try:
        output = subprocess.check_output(["ps", "-A"]).decode('utf-8')
        return "REXPaint.exe" in output
    except Exception:
        return False

@mcp.tool()
def launch_rexpaint() -> str:
    """Launch REXPaint via Wine if it's not already running."""
    if is_rexpaint_running():
        return "REXPaint is already running."

    if not REXPAINT_WINE_PATH:
        return "Error: WINE_PATH is not set."
    if not os.path.exists(REXPAINT_WINE_PATH):
        return f"Error: Wine not found at {REXPAINT_WINE_PATH}"
    if not REXPAINT_EXE_PATH:
        return "Error: REXPAINT_EXE_PATH is not set."
    if not os.path.exists(REXPAINT_EXE_PATH):
        return f"Error: REXPaint.exe not found at {REXPAINT_EXE_PATH}"

    try:
        subprocess.Popen(
            [REXPAINT_WINE_PATH, REXPAINT_EXE_PATH],
            cwd=REXPAINT_EXE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "WINEDEBUG": "-all"},
        )
        return "REXPaint launch initiated."
    except Exception as e:
        return f"Error launching REXPaint: {str(e)}"


# --- Window automation helpers ---

def _focus_rexpaint():
    """Bring REXPaint (Wine) window to front via AppleScript."""
    script = f'''
    tell application "System Events"
        tell process "{WINE_PROCESS_NAME}"
            set frontmost to true
        end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True,
                   capture_output=True, timeout=5)
    time.sleep(0.15)


@mcp.tool()
def focus_rexpaint() -> str:
    """Bring REXPaint window to the front."""
    if not is_rexpaint_running():
        return "Error: REXPaint is not running."
    try:
        _focus_rexpaint()
        return "REXPaint focused."
    except Exception as e:
        return f"Error focusing REXPaint: {e}"


@mcp.tool()
def send_keystroke(key: str) -> str:
    """Send a single keystroke to REXPaint.

    For printable characters, pass the character (e.g. "2", "a").
    For special keys, use AppleScript key code names:
      return, escape, tab, delete, space,
      arrow-up, arrow-down, arrow-left, arrow-right,
      f1-f12
    """
    if not is_rexpaint_running():
        return "Error: REXPaint is not running."
    try:
        _focus_rexpaint()
        # Single printable character → use AppleScript keystroke
        if len(key) == 1:
            script = f'''
            tell application "System Events"
                keystroke "{key}"
            end tell
            '''
            subprocess.run(["osascript", "-e", script], check=True,
                           capture_output=True, timeout=5)
        else:
            # Named key → use cliclick kp:
            subprocess.run([CLICLICK_PATH, f"kp:{key}"], check=True,
                           capture_output=True, timeout=5)
        return f"Sent keystroke: {key}"
    except Exception as e:
        return f"Error sending keystroke: {e}"


@mcp.tool()
def send_key_combo(keys: list[str]) -> str:
    """Send a key combination to REXPaint (e.g. ["ctrl", "s"] for Ctrl+S).

    Modifier names: ctrl, alt, shift, cmd.
    Final key: any cliclick key name or single character.
    """
    if not is_rexpaint_running():
        return "Error: REXPaint is not running."
    if len(keys) < 2:
        return "Error: need at least 2 keys (modifier + key)."
    try:
        _focus_rexpaint()
        modifiers = keys[:-1]
        final_key = keys[-1]
        cmds = [f"kd:{m}" for m in modifiers] + \
               [f"kp:{final_key}"] + \
               [f"ku:{m}" for m in modifiers]
        subprocess.run([CLICLICK_PATH] + cmds, check=True,
                       capture_output=True, timeout=5)
        return f"Sent combo: {'+'.join(keys)}"
    except Exception as e:
        return f"Error sending key combo: {e}"


@mcp.tool()
def switch_layer(layer_num: int) -> str:
    """Switch REXPaint to a specific layer (0-9). Sends the digit key."""
    if not 0 <= layer_num <= 9:
        return "Error: layer_num must be 0-9."
    return send_keystroke(str(layer_num))


@mcp.tool()
def click_at(x: int, y: int) -> str:
    """Click at screen coordinates in the REXPaint window."""
    if not is_rexpaint_running():
        return "Error: REXPaint is not running."
    try:
        _focus_rexpaint()
        subprocess.run([CLICLICK_PATH, f"c:{x},{y}"], check=True,
                       capture_output=True, timeout=5)
        return f"Clicked at ({x}, {y})."
    except Exception as e:
        return f"Error clicking: {e}"


@mcp.tool()
def save_in_rexpaint() -> str:
    """Send Ctrl+S to save the current file in REXPaint."""
    return send_key_combo(["ctrl", "s"])


@mcp.tool()
def export_png_in_rexpaint() -> str:
    """Send Ctrl+E to export PNG in REXPaint."""
    return send_key_combo(["ctrl", "e"])

@mcp.tool()
def list_assets(directory: str = "sprites") -> list[str]:
    """List all .xp files in the specified directory."""
    pattern = os.path.join(directory, "**/*.xp")
    files = glob.glob(pattern, recursive=True)
    return [os.path.relpath(f, directory) for f in files]

@mcp.tool()
def get_summary(path: str) -> str:
    """Get metadata and a small ASCII preview of an XP file."""
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile(path)
        if not xp.layers:
            return "XP file has no layers."

        l0 = xp.layers[0]
        meta = xp.get_metadata()

        summary = [
            f"Asset: {os.path.basename(path)}",
            f"Dimensions: {l0.width}x{l0.height}",
            f"Layers: {len(xp.layers)}",
            f"Metadata: {meta}",
            "\nPreview (Layer 0, top-left 10x10):"
        ]

        preview_w = min(10, l0.width)
        preview_h = min(10, l0.height)

        for y in range(preview_h):
            line = ""
            for x in range(preview_w):
                glyph = l0.data[y][x][0]
                if glyph == 0 or glyph == 32:
                    line += "."
                elif 33 <= glyph <= 126:
                    line += chr(glyph)
                else:
                    line += "#"
            summary.append(line)

        return "\n".join(summary)

    except Exception as e:
        return f"Error getting summary: {str(e)}"

@mcp.tool()
def read_xp(path: str) -> str:
    """Read an XP file and return basic info."""
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile(path)
        if not xp.layers:
            return "Loaded XP file but it has no layers."
        return f"Loaded XP file with {len(xp.layers)} layers. Size: {xp.layers[0].width}x{xp.layers[0].height}"
    except Exception as e:
        return f"Error loading XP file: {str(e)}"

@mcp.tool()
def write_xp(path: str, width: int, height: int) -> str:
    """Create a new basic XP file with 3 empty layers."""
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile()
        for _ in range(3):
            xp.layers.append(XPLayer(width, height))
        xp.save(path)
        return f"Created XP file at {path}"
    except Exception as e:
        return f"Error creating XP file: {str(e)}"

@mcp.tool()
def set_cell(path: str, layer: int, x: int, y: int, glyph: int, fg: list[int], bg: list[int]) -> str:
    """Set a specific cell in an XP file."""
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile(path)
        if layer >= len(xp.layers):
            return f"Error: Layer {layer} out of range (count: {len(xp.layers)})"

        l = xp.layers[layer]
        if not (0 <= x < l.width and 0 <= y < l.height):
            return f"Error: Coordinates ({x}, {y}) out of range ({l.width}x{l.height})"

        l.data[y][x] = (glyph, tuple(fg), tuple(bg))
        xp.save(path)
        return f"Updated cell at ({x}, {y}) in layer {layer}"
    except Exception as e:
        return f"Error updating cell: {str(e)}"

@mcp.tool()
def fill_rect(path: str, layer: int, x: int, y: int, w: int, h: int, glyph: int, fg: list[int], bg: list[int]) -> str:
    """Fill a rectangular area in an XP file."""
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile(path)
        if layer >= len(xp.layers):
            return f"Error: Layer {layer} out of range"

        l = xp.layers[layer]
        for dy in range(h):
            for dx in range(w):
                cur_x, cur_y = x + dx, y + dy
                if 0 <= cur_x < l.width and 0 <= cur_y < l.height:
                    l.data[cur_y][cur_x] = (glyph, tuple(fg), tuple(bg))

        xp.save(path)
        return f"Filled rect at ({x}, {y}) size {w}x{h} in layer {layer}"
    except Exception as e:
        return f"Error filling rect: {str(e)}"

@mcp.tool()
def apply_deltas(path: str, layer: int, deltas: list[dict]) -> str:
    """
    Apply multiple cell updates (deltas) at once to minimize token cost.
    Each delta should be a dict: {'x': int, 'y': int, 'glyph': int, 'fg': [r,g,b], 'bg': [r,g,b]}
    """
    if XPFile is None:
        return "Error: XPFile module could not be imported."

    try:
        xp = XPFile(path)
        if layer >= len(xp.layers):
            return "Error: Layer out of range"

        l = xp.layers[layer]
        count = 0
        for d in deltas:
            cur_x, cur_y = d['x'], d['y']
            if 0 <= cur_x < l.width and 0 <= cur_y < l.height:
                l.data[cur_y][cur_x] = (d['glyph'], tuple(d['fg']), tuple(d['bg']))
                count += 1

        xp.save(path)
        return f"Applied {count} deltas to layer {layer}"
    except Exception as e:
        return f"Error applying deltas: {str(e)}"

@mcp.tool()
def get_mcp_config() -> str:
    """Return the MCP configuration snippet for Claude Desktop."""
    snippet_path = os.path.join(os.path.dirname(__file__), "mcp_config_snippet.json")
    try:
        with open(snippet_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading config snippet: {str(e)}"

if __name__ == '__main__':
    mcp.run()
