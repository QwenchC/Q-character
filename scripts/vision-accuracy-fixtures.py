"""Small, reproducible validation drawings; no user artwork is changed."""
from pathlib import Path
import json
import shutil
from PIL import Image, ImageDraw

out = Path('.runtime/vision-accuracy/fixtures')
out.mkdir(parents=True, exist_ok=True)
sources = {'front': Path('examples/cutout.png'), **{r: Path(f'docs/multiview-validation/views/{r}-cutout.png') for r in ('left', 'back', 'right')}}
real = out / 'turnaround'
real.mkdir(exist_ok=True)
for role, source in sources.items():
    shutil.copyfile(source, real / (role+'.png'))
cases = [{'id': 'turnaround', 'description': '棕色短发、白色短袖、绿色围裙的同一角色设计。', 'expected': 'perspective_or_uncertain', 'target': '正常透视不能要求侧面口袋复制正面弧形，也不能混数鞋带和鞋眼。'}]
for case in ('occluded-bun', 'extra-buns', 'skirt-to-trousers', 'extra-buttons'):
    folder = out / case
    folder.mkdir(exist_ok=True)
    for role in ('front', 'left', 'back'):
        image = Image.new('RGBA', (640, 800))
        d = ImageDraw.Draw(image)
        buns = [(170, 100, 280, 210), (360, 100, 470, 210)]
        if case == 'occluded-bun' and role == 'left':
            buns = buns[1:]
        if case == 'extra-buns' and role == 'left':
            buns += [(110, 210, 210, 310), (430, 210, 530, 310)]
        for box in buns:
            d.ellipse(box, fill='#493120', outline='#22160d', width=6)
        d.ellipse((180, 160, 460, 420), fill='#493120')
        if role != 'back':
            d.ellipse((205, 210, 435, 420), fill='#f3ceb1')
            d.pieslice((195, 165, 445, 295), 180, 360, fill='#493120')
            for x in ([330] if role == 'left' else [265, 360]):
                d.ellipse((x, 285, x+15, 308), fill='#18110d')
            d.arc((290, 315, 350, 370), 0, 180, fill='#a16453', width=4)
        for box in [(230, 600, 305, 725), (335, 600, 410, 725)]:
            d.rounded_rectangle(box, radius=14, fill='#d6ba87')
        d.rounded_rectangle((215, 420, 425, 630), radius=35, fill='#458f62', outline='#245b3a', width=5)
        if case == 'skirt-to-trousers' and role != 'left':
            d.polygon([(230, 500), (410, 500), (465, 665), (175, 665)], fill='#458f62', outline='#245b3a', width=5)
        for box in [(170, 440, 225, 590), (415, 440, 470, 590)]:
            d.rounded_rectangle(box, radius=22, fill='#f3ceb1')
        if case == 'extra-buttons' and role != 'back':
            for y in ([460, 520, 580] if role == 'left' else [460, 580]):
                d.ellipse((300, y, 340, y+40), fill='#f8cf5d', outline='#4a351b', width=4)
        for box in [(215, 705, 310, 755), (330, 705, 425, 755)]:
            d.rounded_rectangle(box, radius=18, fill='#444')
        image.save(folder / (role+'.png'))
    cases.append({'id': case, 'description': '丸子头、绿色服装、卡其色下装的同一个角色。', 'expected': 'no_structural_count' if case == 'occluded-bun' else 'structural', 'target': {'occluded-bun': '侧面单个可见发髻不证明少了一束头发。', 'extra-buns': '同一可见发型区域多出两个发髻。', 'skirt-to-trousers': '侧面从裙装变成裤装。', 'extra-buttons': '同一清晰可见上衣面板从两个纽扣变成三个。'}[case]})
(out / 'cases.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
print(out)
