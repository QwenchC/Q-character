"""Deliberately simple, code-drawn acceptance fixture, never a user's artwork."""
from PIL import Image, ImageDraw
from pathlib import Path
out = Path('.runtime/vision-validation/controlled')
out.mkdir(parents=True, exist_ok=True)
for role in ('front', 'left', 'back'):
    im = Image.new('RGBA', (640, 800))
    d = ImageDraw.Draw(im)
    # Hair buns are all visible: two in the reference/back, four on the defective side.
    buns = [(170, 100, 280, 210), (360, 100, 470, 210)]
    if role == 'left':
        buns += [(110, 210, 210, 310), (430, 210, 530, 310)]
    for b in buns:
        d.ellipse(b, fill='#493120', outline='#22160d', width=6)
    d.ellipse((180, 160, 460, 420), fill='#493120')
    if role != 'back':
        d.ellipse((205, 210, 435, 420), fill='#f3ceb1')
        d.pieslice((195, 165, 445, 295), 180, 360, fill='#493120')
        for x in ([330] if role == 'left' else [265, 360]):
            d.ellipse((x, 285, x+15, 308), fill='#18110d')
        d.arc((290, 315, 350, 370), 0, 180, fill='#a16453', width=4)
    d.rounded_rectangle((215, 420, 425, 630), radius=35, fill='#458f62', outline='#245b3a', width=5)
    for b in [(170, 440, 225, 590), (415, 440, 470, 590)]:
        d.rounded_rectangle(b, radius=22, fill='#f3ceb1')
    for b in [(230, 615, 305, 725), (335, 615, 410, 725)]:
        d.rounded_rectangle(b, radius=14, fill='#d6ba87')
    for b in [(215, 705, 310, 755), (330, 705, 425, 755)]:
        d.rounded_rectangle(b, radius=18, fill='#444')
    im.save(out / (role+'.png'))
print(out)
