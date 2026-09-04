"""Real Hyprland acceptance checks. Changes DP-2; uses temporary virtual outputs for groups."""
from pathlib import Path
import datetime
import hashlib
import json
import math
import os
import re
import socket
import struct
import subprocess
import time
import urllib.request
import urllib.error
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification'
OUT.mkdir(exist_ok=True)
RUNTIME = Path(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}'))
CONTROL = RUNTIME / 'wallpaperdb-native-prototype/control.sock'
HYPR = next((RUNTIME / 'hypr').glob('*/.socket.sock'))
ENV = {**os.environ, 'HYPRLAND_INSTANCE_SIGNATURE': HYPR.parent.name}
if 'WAYLAND_DISPLAY' not in ENV:
    ENV['WAYLAND_DISPLAY'] = next(p.name for p in RUNTIME.glob('wayland-*') if p.is_socket() and 'swww' not in p.name)

def api(op, **kwargs):
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(15)
        s.connect(str(CONTROL))
        s.sendall(json.dumps({'op': op, **kwargs}).encode() + b'\n')
        data = s.makefile('rb').readline()
    result = json.loads(data)
    if result.get('error'):
        raise RuntimeError(result['error'])
    return result

def hypr(*args):
    result = subprocess.run(['hyprctl', *args], env=ENV, check=True, text=True, capture_output=True)
    return json.loads(result.stdout) if '-j' in args else result.stdout.strip()

def wait_for(predicate, label, seconds=15):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = api('status')
        if predicate(last):
            return last
        time.sleep(.15)
    raise AssertionError(f'{label}: timed out. Surfaces: {last["surfaces"]}')

def surface(state, output='DP-2'):
    return next((s for s in state['surfaces'] if s['output'] == output), {})

def ready(state, renderer=None, output='DP-2'):
    stats = surface(state, output).get('telemetry', {})
    if stats.get('error'):
        raise AssertionError(stats['error'])
    return stats.get('state') == 'ready' if renderer else stats.get('frames', 0) > 15

def set_wallpaper(name, outputs=None, span=False, audio=False):
    return api('set', source=str(ROOT / 'examples' / name), outputs=outputs or ['DP-2'], span=span, fps=30, audio=audio)

def capture(name, output='DP-2'):
    path = OUT / f'{name}.png'
    subprocess.run([os.environ.get('GRIM', 'grim'), '-o', output, str(path)], env=ENV, check=True, timeout=10)
    # Ignore Waybar's clock / CPU widgets when comparing desktop content.
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True).stdout
    return hashlib.sha256(raw[96 * 3 * 3:]).hexdigest()

def process_stats():
    records = {}
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            raw = path.read_text().rsplit(')', 1)[1].split()
            records[int(path.parent.name)] = (int(raw[1]), int(raw[11]) + int(raw[12]), int(raw[21]) * os.sysconf('SC_PAGE_SIZE'))
        except (OSError, ValueError, IndexError):
            pass
    # Unix socket peers identify precisely the daemon being measured.
    with socket.socket(socket.AF_UNIX) as s:
        s.connect(str(CONTROL))
        pid, _, _ = struct.unpack('3i', s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        s.sendall(b'{"op":"status"}\n'); s.makefile('rb').readline()
    members = {pid}
    for _ in range(8):
        members |= {p for p, (parent, _, _) in records.items() if parent in members}
    return {p: records[p][1:] for p in members if p in records}

def measure(label, seconds=4):
    before = process_stats(); start = time.monotonic(); time.sleep(seconds); after = process_stats()
    cpu = sum(max(0, ticks - before.get(pid, (ticks, 0))[0]) for pid, (ticks, _) in after.items()) / os.sysconf('SC_CLK_TCK') / (time.monotonic() - start) * 100
    result = {'cpu_percent_one_core': round(cpu, 2), 'summed_rss_mib': round(sum(rss for _, rss in after.values()) / 1048576, 1), 'processes': len(after)}
    try:
        pss_kib = sum(int(re.search(r'^Pss:\s+(\d+)', Path(f'/proc/{pid}/smaps_rollup').read_text(), re.M)[1]) for pid in after)
        result['proportional_rss_mib'] = round(pss_kib / 1024, 1)
    except (OSError, TypeError):
        result['proportional_rss_mib'] = None
    report['performance'][label] = result
    print(f'MEASURE {label}: {result}', flush=True)

report = {'time': datetime.datetime.now().astimezone().isoformat(), 'completed': False, 'checks': [], 'performance': {}, 'versions': {}}
def passed(label):
    report['checks'].append(label); print(f'PASS {label}', flush=True)

virtual = []
original = api('status')
physical = hypr('-j', 'monitors')
assert any(m['name'] == 'DP-2' for m in physical), 'DP-2 must be connected'
target_monitor = next(m for m in physical if m['name'] == 'DP-2')
ui_title = 'WallpaperDB · Desktop'
def native_ui():
    return next((w for w in hypr('-j', 'clients') if w['title'] == ui_title and w['class'] == 'wallpaperdb-native'), None)

original_ui = native_ui()
ui_rule = f'wallpaperdb-verification-{os.getpid()}'
ui_confined = False
baseline_layers = hypr('-j', 'layers')
try:
    # Scope a temporary rule before mapping our window. Moving it after mapping
    # would briefly open it on whichever monitor the user is currently using.
    for key, value in [
        ('match:class', '^wallpaperdb-native$'),
        ('match:title', '^WallpaperDB · Desktop$'),
        ('monitor', 'DP-2'),
        ('workspace', f"{target_monitor['activeWorkspace']['id']} silent"),
        ('no_initial_focus', 'on'),
        ('suppress_event', 'activate activatefocus'),
        ('float', 'on'),
        ('size', '1240 840'),
        ('center', 'on'),
    ]:
        reply = hypr('keyword', f'windowrule[{ui_rule}]:{key}', value)
        assert reply == 'ok', f'Cannot confine verification UI to DP-2: {reply}'
    ui_confined = True
    if original_ui:
        hypr('dispatch', 'closewindow', 'address:' + original_ui['address'])
    report['versions']['hyprland'] = hypr('-j', 'version')
    report['versions']['webkitgtk'] = subprocess.check_output(['pkg-config', '--modversion', 'webkit2gtk-4.1'], text=True).strip()
    report['monitors'] = [{k: m[k] for k in ['name', 'width', 'height', 'x', 'y', 'scale', 'transform']} for m in physical]
    base = original['url']
    page = urllib.request.urlopen(base, timeout=3).read().decode()
    token = re.search(r'name="wallpaperdb-token" content="(.*?)"', page)[1]
    req = urllib.request.Request(base + '/api', data=b'{"op":"status"}', headers={'Content-Type': 'application/json', 'X-WallpaperDB-Token': token})
    assert urllib.request.urlopen(req, timeout=3).status == 200
    for headers in [{'Content-Type': 'application/json'}, {'Content-Type': 'application/json', 'X-WallpaperDB-Token': token, 'Origin': 'https://untrusted.example'}]:
        try:
            urllib.request.urlopen(urllib.request.Request(base + '/api', data=b'{"op":"stop"}', headers=headers), timeout=3)
            raise AssertionError('Unauthenticated control request was accepted')
        except urllib.error.HTTPError as error:
            assert error.code == 403
    passed('HTTP success status and rejection of unauthenticated / cross-origin writes')

    set_wallpaper('Rose mountains.svg')
    wait_for(lambda s: ready(s, 'native image'), 'image readiness')
    time.sleep(.3)
    image_a = capture('dp2-image')
    measure('image')
    assert image_a == capture('dp2-image-idle'), 'A stationary wallpaper repainted differently'
    assert any(l['namespace'] == 'wallpaperdb-DP-2' and l['w'] == 1920 and l['h'] == 1080 for l in hypr('-j', 'layers')['DP-2']['levels']['0'])
    passed('Stationary image on real DP-2 background layer; unchanged across idle interval')
    before = api('status')['groups']
    try:
        api('set', source='/nonexistent/image.png', outputs=['DP-2'], fps=30)
        raise AssertionError('Invalid file accepted')
    except RuntimeError:
        assert api('status')['groups'] == before
    passed('Invalid assignment preserves the current wallpaper')

    set_wallpaper('Drifting dusk.mp4')
    state = wait_for(lambda s: ready(s, 'mpv'), 'video decoder readiness')
    report['video_decoder'] = surface(state)['telemetry']
    assert surface(state)['telemetry']['renderer'] == 'mpv'
    frame = capture('dp2-video')
    time.sleep(1.4)
    assert capture('dp2-video-next') != frame
    passed('Video produces changing frames on DP-2 through mpv')
    measure('video')
    api('pause', outputs=['DP-2'], paused=True)
    wait_for(lambda s: surface(s).get('paused'), 'video pause')
    time.sleep(.2)
    frame = capture('dp2-video-paused')
    measure('video_paused')
    assert capture('dp2-video-paused-later') == frame
    api('pause', outputs=['DP-2'], paused=False)
    wait_for(lambda s: not surface(s).get('paused'), 'video resume')
    passed('Video pause freezes output; resume restores playback')

    set_wallpaper('rose-clock', audio=True)
    state = wait_for(lambda s: ready(s), 'image live scene')
    prior_pointer = surface(state)['telemetry']['pointer']
    original_pointer = hypr('-j', 'cursorpos')
    hypr('dispatch', 'movecursor', '800 -650')
    # A person may still be using the mouse while this runs. Require actual
    # compositor-driven changes, rather than requiring the pointer to stay put.
    state = wait_for(lambda s: surface(s).get('telemetry', {}).get('pointer', {}) != prior_pointer, 'pointer input')
    pointer = surface(state)['telemetry']['pointer']
    assert math.isfinite(pointer['x']) and math.isfinite(pointer['y'])
    if hypr('-j', 'cursorpos') == {'x': 800, 'y': -650}:
        hypr('dispatch', 'movecursor', f'{original_pointer["x"]} {original_pointer["y"]}')
    api('signal', name='key', value='Space', outputs=['DP-2'])
    state = wait_for(lambda s: surface(s).get('telemetry', {}).get('signals', 0) >= 1, 'keyboard signal')
    assert surface(state)['telemetry']['lastSignal'] == {'name': 'key', 'value': 'Space'}
    actual = datetime.datetime.fromisoformat(surface(state)['telemetry']['date'].replace('Z', '+00:00'))
    assert abs((datetime.datetime.now(datetime.timezone.utc) - actual).total_seconds()) < 5
    passed('Live image responds to desktop pointer, semantic keyboard input, and current date/time')
    tone = OUT / 'quiet-audio-test.wav'
    with wave.open(str(tone), 'wb') as wav:
        wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        wav.writeframes(b''.join(struct.pack('<h', int(1100 * math.sin(2 * math.pi * 440 * i / 24000))) for i in range(24000 * 2)))
    playback = subprocess.Popen(['paplay', str(tone)], env=ENV)
    wait_for(lambda s: surface(s).get('telemetry', {}).get('audio', {}).get('rms', 0) > .002, 'system audio', 8)
    playback.wait(timeout=5)
    capture('dp2-live-image')
    passed('Real output audio reaches the running scene (RMS and frequency bands)')
    measure('live_image_audio')

    api('ui')
    ui = None
    for _ in range(40):
        ui = native_ui()
        if ui: break
        time.sleep(.1)
    assert ui, 'Native library window did not open'
    assert ui['monitor'] == target_monitor['id'], 'Library must map directly onto DP-2'
    address = 'address:' + ui['address']
    try:
        workspace = next(m for m in hypr('-j', 'monitors') if m['name'] == 'DP-2')['activeWorkspace']['id']
        hypr('dispatch', 'movetoworkspacesilent', f'{workspace},{address}')
        hypr('dispatch', 'setfloating', address)
        hypr('dispatch', 'resizewindowpixel', 'exact 1240 840,' + address)
        hypr('dispatch', 'movewindowpixel', 'exact 660 -960,' + address)
        time.sleep(1)
        previous_signals = surface(api('status'))['telemetry']['signals']
        hypr('dispatch', 'sendshortcut', ',space,' + address)
        wait_for(lambda s: surface(s)['telemetry']['signals'] > previous_signals, 'native keyboard event')
        capture('dp2-native-library')
        passed('Native GTK library opens on DP-2 and a real compositor keyboard event reaches the wallpaper')
        # Ask our own native window to fullscreen; never target the user's
        # focused application, since they may keep working during verification.
        api('ui', fullscreen=True)
        wait_for(lambda s: surface(s).get('paused'), 'fullscreen suspension')
        api('ui', fullscreen=False)
        wait_for(lambda s: not surface(s).get('paused'), 'fullscreen resume')
        passed('Fullscreen native window automatically pauses and resumes the wallpaper')
    finally:
        hypr('dispatch', 'closewindow', address)

    set_wallpaper('tide', audio=True)
    state = wait_for(lambda s: ready(s) and surface(s)['telemetry'].get('videos', [{}])[0].get('ready', 0) >= 3, 'video live scene', 20)
    initial_time = surface(state)['telemetry']['videos'][0]['time']
    time.sleep(1.5)
    state = api('status')
    assert surface(state)['telemetry']['videos'][0]['time'] != initial_time
    api('signal', name='key', value='Space', outputs=['DP-2'])
    wait_for(lambda s: surface(s)['telemetry']['signals'] > 0, 'live video keyboard')
    capture('dp2-live-video')
    measure('live_video_audio')
    passed('Live video decodes, advances, and runs JavaScript interaction')
    api('pause', outputs=['DP-2'], paused=True)
    state = wait_for(lambda s: surface(s).get('paused'), 'live pause')
    time.sleep(.5)
    count = surface(api('status'))['telemetry']['frames']
    measure('live_video_paused')
    assert surface(api('status'))['telemetry']['frames'] == count
    assert not api('status')['audio']['available']
    passed('Paused scene stops frame callbacks and releases audio capture')

    # Actual compositor outputs, with only DP-2 being a physical test display.
    for name, x in [('WDB-VERIFY-A', 2240), ('WDB-VERIFY-B', 4160)]:
        assert name not in [m['name'] for m in physical]
        hypr('output', 'create', 'headless', name); virtual.append(name)
        hypr('keyword', 'monitor', f'{name},1920x1080@60,{x}x-1080,1')
    wait_for(lambda s: all(v in [m['name'] for m in s['monitors']] for v in virtual), 'virtual displays')
    set_wallpaper('Rose mountains.svg', ['DP-2', virtual[0]], span=True)
    set_wallpaper('Blue hour.svg', [virtual[1]])
    state = api('status')
    assert surface(state)['canvas']['width'] == 3840
    assert surface(state, virtual[0])['viewport']['x'] == 1920
    assert surface(state, virtual[1])['canvas']['width'] == 1920
    capture('dp2-spanning-image'); capture('span-image-right', virtual[0])
    passed('One spanning image plus an independent wallpaper across three compositor outputs')
    set_wallpaper('Drifting dusk.mp4', ['DP-2', virtual[0]], span=True)
    wait_for(lambda s: ready(s, 'mpv') and ready(s, 'mpv', virtual[0]), 'spanning video')
    time.sleep(2)
    state = api('status')
    t1 = surface(state)['telemetry']['time']; t2 = surface(state, virtual[0])['telemetry']['time']
    report['span_video_time_delta_seconds'] = abs(t1-t2)
    assert min(abs(t1-t2), abs(8-abs(t1-t2))) < .4
    passed('Spanning video uses adjacent crops and synchronized playback')
    set_wallpaper('rose-clock', ['DP-2', virtual[0]], span=True, audio=True)
    wait_for(lambda s: ready(s) and ready(s, output=virtual[0]), 'spanning scene')
    capture('dp2-spanning-live'); capture('span-live-right', virtual[0])
    passed('JavaScript scene shares one canvas across DP-2 and a virtual output')
    set_wallpaper('tide', ['DP-2', virtual[0]], span=True, audio=True)
    def live_video_ready(state, output):
        stats = surface(state, output).get('telemetry', {})
        return ready(state, output=output) and stats.get('videos', [{}])[0].get('ready', 0) >= 3
    wait_for(lambda s: all(live_video_ready(s, o) for o in ['DP-2', virtual[0]]), 'spanning video scene', 20)
    api('signal', name='key', value='Space', outputs=['DP-2', virtual[0]])
    state = wait_for(lambda s: all(surface(s, o)['telemetry']['signals'] > 0 for o in ['DP-2', virtual[0]]), 'spanning video scene signals')
    times = []
    now = datetime.datetime.now(datetime.timezone.utc)
    for output in ['DP-2', virtual[0]]:
        stats = surface(state, output)['telemetry']
        sampled = datetime.datetime.fromisoformat(stats['date'].replace('Z', '+00:00'))
        times.append((stats['videos'][0]['time'] + (now - sampled).total_seconds()) % 8)
    drift = min(abs(times[0] - times[1]), 8 - abs(times[0] - times[1]))
    report['span_live_video_time_delta_seconds'] = drift
    assert drift < .4, f'Spanning live videos drifted by {drift} seconds'
    capture('dp2-spanning-live-video'); capture('span-live-video-right', virtual[0])
    passed('Live video scene spans outputs, synchronizes media, and receives shared keyboard signals')
    set_wallpaper('rose-clock', ['DP-2', virtual[0]], span=True, audio=True)
    wait_for(lambda s: ready(s) and ready(s, output=virtual[0]), 'restore image scene')
    hypr('output', 'remove', virtual[0])
    wait_for(lambda s: surface(s).get('canvas', {}).get('width') == 1920, 'unplug reflow')
    hypr('output', 'create', 'headless', virtual[0]); hypr('keyword', 'monitor', f'{virtual[0]},1920x1080@60,2240x-1080,1')
    wait_for(lambda s: surface(s).get('canvas', {}).get('width') == 3840 and ready(s, output=virtual[0]), 'reconnect restore')
    passed('Hot unplug reflows a span; reconnect restores the saved group')
    set_wallpaper('Blue hour.svg', [virtual[0]])
    assert surface(api('status'))['canvas']['width'] == 1920
    passed('Replacing one group member preserves other wallpapers and recomputes their canvas')
    hypr('keyword', 'monitor', f'{virtual[0]},1920x1080@60,2240x-1080,1.5,transform,1')
    wait_for(lambda s: surface(s, virtual[0]).get('viewport', {}).get('width') == 720 and surface(s, virtual[0]).get('viewport', {}).get('height') == 1280, 'rotated fractional-scale output')
    capture('rotated-scaled-output', virtual[0])
    passed('A real compositor surface follows rotation and fractional display scale')
except BaseException as error:
    report['failure'] = str(error)
    raise
else:
    report['completed'] = True
finally:
    try:
        api('clear', outputs=virtual)
        for name in virtual:
            try: hypr('output', 'remove', name)
            except subprocess.CalledProcessError: pass
        set_wallpaper('rose-clock', audio=True)
        if original_ui and ui_confined:
            api('ui')
            restored_ui = None
            for _ in range(40):
                restored_ui = native_ui()
                if restored_ui: break
                time.sleep(.1)
            assert restored_ui and restored_ui['monitor'] == target_monitor['id'], 'Restored library must stay on DP-2'
        after = hypr('-j', 'layers')
        for name, layers in baseline_layers.items():
            expected = {(l['namespace'], l['pid']) for l in layers['levels']['0'] if not l['namespace'].startswith('wallpaperdb') and l['pid'] not in [s.get('telemetry', {}).get('pid') for s in original['surfaces']]}
            actual = {(l['namespace'], l['pid']) for l in after.get(name, {}).get('levels', {}).get('0', [])}
            assert expected <= actual, f'Existing background process changed on {name}'
        report['existing_backgrounds_preserved'] = True
    except BaseException as error:
        report['completed'] = False
        report['cleanup_failure'] = str(error)
        raise
    finally:
        hypr('keyword', f'windowrule[{ui_rule}]:enable', 'false')
        (OUT / 'report.json').write_text(json.dumps(report, indent=2))
print(f'All {len(report["checks"])} acceptance checks passed. Evidence: {OUT}', flush=True)
