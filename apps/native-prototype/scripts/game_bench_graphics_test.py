import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from game_bench_graphics import GraphicsFault, GraphicsWatch, check_session, graphics_fault


class GraphicsTests(unittest.TestCase):
    def test_actual_compositor_memory_fault_and_driver_timeouts_are_fatal(self):
        self.assertTrue(
            graphics_fault(
                "amdgpu 0000:15:00.0: amdgpu: [gfxhub] page fault (src_id:0 ring:24 vmid:1 pasid:22)"
            )
        )
        self.assertTrue(
            graphics_fault(
                "amdgpu: ring gfx_0.1.0 timeout, signaled seq=1439582, emitted seq=1439583"
            )
        )
        self.assertTrue(graphics_fault("NVRM: Xid (PCI:0000:01:00): 31, pid=123, name=cs2"))
        self.assertFalse(graphics_fault("amdgpu: ring gfx_0.1.0 uses VM inv eng 0"))
        self.assertFalse(graphics_fault("cs2 reported a socket timeout"))

    def test_fault_receipt_blocks_only_the_affected_graphics_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = root / "game-123"
            job.mkdir()
            block = root / "blocked.json"
            watch = GraphicsWatch.__new__(GraphicsWatch)
            watch.directory = job
            watch.env = {}
            watch.failure = None
            identity = {"session": "original", "boot_id": "boot"}
            with patch("game_bench_graphics.block_path", return_value=block), patch(
                "game_bench_graphics.session_identity", return_value=identity
            ):
                watch.observe(
                    {"MESSAGE": "amdgpu: [gfxhub] page fault", "__REALTIME_TIMESTAMP": "100"}
                )
                self.assertIsNotNone(watch.failure)
                self.assertEqual(json.loads(block.read_text())["job"], "game-123")
                with self.assertRaises(GraphicsFault):
                    check_session({})
            with patch("game_bench_graphics.block_path", return_value=block), patch(
                "game_bench_graphics.session_identity",
                return_value=identity | {"session": "restarted"},
            ):
                check_session({})
