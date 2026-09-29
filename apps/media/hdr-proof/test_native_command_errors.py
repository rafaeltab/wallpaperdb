"""Native decoder error concealment cannot qualify an emitted image.

The negative JPEG retains the native libjpeg writer's complete headers but
removes the entropy scan. Its deterministic generator and both hashes below
make this malformed-file control reproducible in the pinned environment.
"""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest

import numpy as np
from PIL import Image

import avif
import gainmap


class NativeCommandErrorTests(unittest.TestCase):
    def fixtures(self, directory):
        y, x = np.mgrid[:32, :32]
        pixels = np.stack(((x * 13 + y * 7) % 256, (x * 3 + y * 19) % 256,
                           (x * 29 + y * 11) % 256), axis=-1).astype(np.uint8)
        valid, malformed = directory/'native.jpg', directory/'missing-scan.jpg'
        Image.fromarray(pixels).save(valid, format='JPEG', quality=90, subsampling=0,
                                     optimize=False, progressive=False)
        data = valid.read_bytes()
        scan = data.index(b'\xff\xda')
        scan_data = scan + 2 + int.from_bytes(data[scan+2:scan+4], 'big')
        malformed.write_bytes(data[:scan_data] + b'\xff\xd9')
        self.assertEqual(avif.digest(valid), 'c0a636fba71250edb42a0f56934160c6e00019e9957e2b25cb4e095e90681ffe')
        self.assertEqual(avif.digest(malformed), 'b3621ffcee10b77798621ce120654bfbb01d27f55f98c9c2ed07a37c0b54cbda')
        return valid, malformed

    def decode_command(self, path, *logging, executable='ffmpeg'):
        return [executable, *logging, '-c:v', 'mjpeg', '-i', str(path), '-frames:v', '1',
                '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']

    def test_real_malformed_jpeg_zero_exit_and_concealed_pixels_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            _, malformed = self.fixtures(Path(temporary))
            command = self.decode_command(malformed, '-v', 'error')
            observed = subprocess.run(command, capture_output=True, timeout=30)
            self.assertEqual(observed.returncode, 0)
            self.assertEqual(len(observed.stdout), 32 * 32 * 3)
            self.assertIn(b'overread', observed.stderr)
            with self.assertRaisesRegex(RuntimeError, 'FFmpeg reported error diagnostics'):
                avif.native(command)
            recorded = avif.COMMANDS[-1]
            self.assertEqual(recorded['argv'], command)
            self.assertEqual(recorded['exit_code'], 0)
            self.assertIn('overread', recorded['stderr'])

    def test_absolute_ffmpeg_and_loglevel_alias_keep_the_same_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            _, malformed = self.fixtures(Path(temporary))
            command = self.decode_command(malformed, '-loglevel', 'error', executable=shutil.which('ffmpeg'))
            with self.assertRaisesRegex(RuntimeError, 'FFmpeg reported error diagnostics'):
                avif.native(command)
            self.assertEqual(avif.COMMANDS[-1]['exit_code'], 0)
            self.assertIn('overread', avif.COMMANDS[-1]['stderr'])

    def test_clean_decode_and_explicit_informational_logging_remain_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            valid, _ = self.fixtures(Path(temporary))
            clean = avif.native(self.decode_command(valid, '-v', 'error'))
            self.assertEqual(len(clean), 32 * 32 * 3)
            self.assertEqual(avif.COMMANDS[-1]['stderr'], '')
            # FFmpeg uses the last explicit log level. Informational logs
            # cannot be mistaken for errors from an earlier option.
            informative = avif.native(self.decode_command(valid, '-v', 'error', '-loglevel', 'info'))
            self.assertEqual(informative, clean)
            self.assertTrue(avif.COMMANDS[-1]['stderr'])
            self.assertEqual(avif.COMMANDS[-1]['exit_code'], 0)

    def test_nonzero_native_failure_still_records_its_actual_return_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            missing = Path(temporary)/'missing.jpg'
            with self.assertRaisesRegex(RuntimeError, 'exited'):
                avif.native(self.decode_command(missing, '-v', 'error'))
            self.assertNotEqual(avif.COMMANDS[-1]['exit_code'], 0)
            self.assertIn('No such file', avif.COMMANDS[-1]['stderr'])

    def test_gainmap_text_runner_preserves_json_log_before_rejecting_concealment(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            valid, malformed = self.fixtures(directory)
            for source in (valid, malformed):
                command = ['ffmpeg', '-v', 'error', '-c:v', 'mjpeg', '-i', source,
                           '-frames:v', '1', '-f', 'null', '-']
                log = directory/f'{source.stem}.json'
                if source == malformed:
                    with self.assertRaisesRegex(RuntimeError, 'FFmpeg reported error diagnostics'):
                        gainmap.command(command, log)
                else:
                    self.assertEqual(gainmap.command(command, log), '')
                recorded = json.loads(log.read_text())
                self.assertEqual(set(recorded), {'command', 'exit_code', 'stdout', 'stderr'})
                self.assertEqual(recorded['command'], [str(value) for value in command])
                self.assertEqual(recorded['exit_code'], 0)
                self.assertEqual(recorded['stdout'], '')
                if source == malformed:
                    self.assertIn('overread', recorded['stderr'])
                else:
                    self.assertEqual(recorded['stderr'], '')

    def test_gainmap_binary_runner_preserves_raw_stderr_before_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            valid, malformed = self.fixtures(directory)
            log = directory/'binary.log'
            clean = gainmap.command(self.decode_command(valid, '-loglevel', 'error'), log, binary=True)
            self.assertEqual(len(clean), 32 * 32 * 3)
            self.assertEqual(log.read_bytes(), b'')
            with self.assertRaisesRegex(RuntimeError, 'FFmpeg reported error diagnostics'):
                gainmap.command(self.decode_command(malformed, '-loglevel', 'error'), log, binary=True)
            self.assertIn(b'overread', log.read_bytes())
            self.assertTrue(log.read_bytes().startswith(b'[mjpeg @ '))


if __name__ == '__main__':
    unittest.main()
