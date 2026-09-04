"""Build small, original vector landscapes and a loopable pan for the local demo library."""
from pathlib import Path
import math
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1] / 'examples'
root.mkdir(parents=True, exist_ok=True)

def landscape(blue=False):
    colors = ['#070e22', '#25446a', '#b793bd', '#252941', '#171e32', '#0c1424'] if blue else ['#181626', '#604157', '#db939d', '#594454', '#342d43', '#1c1c30']
    stars = ''.join(f'<circle cx="{(i*173)%1600}" cy="{(i*97)%440}" r="{.6+(i%3)*.3}" fill="#fff0dc" opacity="{.15+(i%5)*.07}"/>' for i in range(120))
    ridges = ''
    for layer in range(3):
        points = ' '.join(f'{x},{int(460+layer*115+math.sin(x/190+layer)*65+math.sin(x/81+layer*2)*32)}' for x in range(-50,1651,30))
        ridges += f'<polygon points="-50,950 {points} 1650,950" fill="{colors[3+layer]}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="{colors[0]}"/><stop offset=".7" stop-color="{colors[1]}"/><stop offset="1" stop-color="{colors[2]}"/></linearGradient><radialGradient id="halo"><stop stop-color="{colors[2]}" stop-opacity=".35"/><stop offset="1" stop-color="{colors[2]}" stop-opacity="0"/></radialGradient><linearGradient id="moon" x2="1" y2="1"><stop stop-color="#faebd5"/><stop offset="1" stop-color="#daafba"/></linearGradient><linearGradient id="mist"><stop stop-color="{colors[2]}" stop-opacity="0"/><stop offset=".5" stop-color="{colors[2]}" stop-opacity=".13"/><stop offset="1" stop-color="{colors[2]}" stop-opacity="0"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#sky)"/>{stars}<ellipse cx="1090" cy="335" rx="530" ry="370" fill="url(#halo)"/><circle cx="1090" cy="310" r="83" fill="url(#moon)"/>{ridges}<ellipse cx="650" cy="650" rx="900" ry="35" fill="url(#mist)"/><ellipse cx="1020" cy="754" rx="800" ry="21" fill="url(#mist)"/>
</svg>'''

for name,blue in [('Rose mountains',False),('Blue hour',True),('Drifting dusk',False)]:
    (root/f'{name}.svg').write_text(landscape(blue))
for folder,blue in [('rose-clock',False),('tide',True)]:
    (root/folder).mkdir(exist_ok=True)
    (root/folder/'background.svg').write_text(landscape(blue))

with tempfile.TemporaryDirectory(prefix='wallpaperdb-assets-') as tmp:
    png = Path(tmp)/'landscape.png'
    subprocess.run(['rsvg-convert','-o',str(png),str(root/'Drifting dusk.svg')],check=True)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i',str(png),'-vf',"zoompan=z='1.08+0.025*sin(on*2*PI/240)':x='(iw-iw/zoom)/2+12*sin(on*2*PI/240)':y='(ih-ih/zoom)/2':d=240:s=1280x720:fps=30",'-frames:v','240','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'Drifting dusk.mp4')],check=True)
shutil.copyfile(root/'Drifting dusk.mp4',root/'tide'/'background.mp4')
print('Generated original SVG illustrations and an eight-second H.264 demo loop.')
