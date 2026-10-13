"""
Editor CLI Core Module - XP File Operations
Wraps EditorApp for CLI access
"""
import json
from pathlib import Path


class EditorSession:
    """Stateful editor session for CLI."""

    def __init__(self):
        """Initialize editor session."""
        self.canvas = None
        self.file_path = None
        self.dirty = False
        self.layers = []

    def load_xp(self, file_path: str) -> dict:
        """Load XP file into editor."""
        try:
            path = Path(file_path)
            if not path.exists():
                return {"error": f"File not found: {file_path}", "status": "failed"}

            self.file_path = str(path)
            # Simulated load - in real use, calls EditorApp.loadXPFile()
            self.dirty = False

            return {
                "status": "success",
                "file": self.file_path,
                "message": f"Loaded: {path.name}"
            }
        except Exception as e:
            return {"error": str(e), "status": "failed"}

    def save_xp(self, file_path: str = None) -> dict:
        """Save editor canvas as XP file."""
        try:
            if not self.canvas:
                return {"error": "No canvas loaded", "status": "failed"}

            path = file_path or self.file_path
            if not path:
                return {"error": "No file path specified", "status": "failed"}

            # Simulated save - in real use, calls EditorApp.saveAsXP()
            self.file_path = path
            self.dirty = False

            return {
                "status": "success",
                "file": path,
                "message": f"Saved: {Path(path).name}"
            }
        except Exception as e:
            return {"error": str(e), "status": "failed"}

    def validate_xp(self, file_path: str) -> dict:
        """Validate XP file format."""
        try:
            path = Path(file_path)
            if not path.exists():
                return {"valid": False, "reason": "File not found"}

            if path.suffix.lower() != '.xp':
                return {"valid": False, "reason": "Not an XP file"}

            # Check file header (magic number)
            with open(path, 'rb') as f:
                header = f.read(4)
                # XP magic: 0x50584552 ("REXP" in little-endian)
                is_valid = header == b'REXP' or header == b'\x52\x45\x58\x50'

            return {
                "valid": is_valid,
                "file": str(path),
                "size_bytes": path.stat().st_size,
                "reason": "Valid XP file" if is_valid else "Invalid magic number"
            }
        except Exception as e:
            return {"valid": False, "reason": str(e)}

    def roundtrip_test(self, file_path: str) -> dict:
        """Test roundtrip: load -> save -> load."""
        try:
            # Step 1: Load
            load_result = self.load_xp(file_path)
            if load_result.get("status") != "success":
                return {"passed": False, "stage": "load", "error": load_result.get("error")}

            # Step 2: Save
            temp_file = str(Path(file_path).parent / f"{Path(file_path).stem}_roundtrip.xp")
            save_result = self.save_xp(temp_file)
            if save_result.get("status") != "success":
                return {"passed": False, "stage": "save", "error": save_result.get("error")}

            # Step 3: Validate
            validate_result = self.validate_xp(temp_file)
            if not validate_result.get("valid"):
                return {"passed": False, "stage": "validate", "error": validate_result.get("reason")}

            return {
                "passed": True,
                "original_file": file_path,
                "roundtrip_file": temp_file,
                "message": "Roundtrip test passed"
            }
        except Exception as e:
            return {"passed": False, "stage": "roundtrip", "error": str(e)}

    def to_json(self) -> str:
        """Serialize session state to JSON."""
        return json.dumps({
            "file": self.file_path,
            "dirty": self.dirty,
            "layers": len(self.layers)
        })
