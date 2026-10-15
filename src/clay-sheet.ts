import { clayRecipe, gramsText } from './color';
import type { ClayGuide } from './types';

export async function claySheet(guide: ClayGuide, name: string, grams: number) {
  const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 350 + guide.swatches.length * 160 + 270;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#faf9f3'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#35492d'; ctx.font = 'bold 42px "Microsoft YaHei",sans-serif'; ctx.fillText(`${name.slice(0, 24)} · 黏土调色指引`, 60, 80);
  ctx.font = '23px "Microsoft YaHei",sans-serif'; ctx.fillText(`每色试配 ${grams} g · 按重量计份 · 共 20 份 · 屏幕颜色仅供参考`, 60, 130);
  ctx.fillStyle = '#7c6450'; ctx.fillText('近似起始配方：不同品牌、含水量、干燥和屏幕会影响结果，请先做小色样。', 60, 175);
  ctx.fillStyle = '#53694b'; ctx.fillText('基础黏土：', 60, 250);
  guide.bases.forEach((base, i) => { const x = 220 + i * 200; ctx.fillStyle = base.hex; ctx.fillRect(x, 215, 40, 40); ctx.fillStyle = '#53694b'; ctx.fillText(base.name.slice(0, 6), x + 50, 243); });
  guide.swatches.forEach((swatch, i) => {
    const y = 320 + i * 160, recipe = clayRecipe(swatch.target, guide.bases);
    ctx.fillStyle = '#e3e6d9'; ctx.fillRect(60, y + 132, 1380, 1);
    ctx.fillStyle = swatch.target; ctx.fillRect(60, y, 95, 95); ctx.strokeStyle = '#a5ae96'; ctx.strokeRect(60, y, 95, 95);
    ctx.fillStyle = '#35492d'; ctx.font = 'bold 25px "Microsoft YaHei",sans-serif'; ctx.fillText(`${swatch.name.slice(0, 20)}  ${swatch.target.toUpperCase()}`, 185, y + 30);
    ctx.font = '23px "Microsoft YaHei",sans-serif'; ctx.fillText(recipe.ingredients.map(b => `${b.name} ${b.parts} 份（${gramsText(grams * b.parts / 20)}g）`).join(' + '), 185, y + 75);
    ctx.fillStyle = '#7c7869'; ctx.font = '19px "Microsoft YaHei",sans-serif'; ctx.fillText(`少量试配 → 完全揉匀 → 留湿样与干样对照${recipe.difference > 12 ? ' · 当前基础色较难接近，可补充近似成品色' : ''}`, 185, y + 110);
  });
  const y = 350 + guide.swatches.length * 160;
  ctx.fillStyle = '#53694b'; ctx.font = '23px "Microsoft YaHei",sans-serif';
  ['1. 先称取占比最大的颜色，再将少量深色分次加入，揉匀后再判断。', '2. 太深先加少量白色；偏灰时补少量目标主色，每次记录实际增加的重量。', '3. 色样干燥后与设计图、湿样一起比较，再决定整批用量。', '4. 图像色块占比不代表黏土重量：体积、遮挡和分件厚度需要手作时另行估算。', '5. 微量配料先做色母或放大试配；克数经过四舍五入，请以重量份为准。'].forEach((line, i) => ctx.fillText(line, 60, y + i * 48));
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('调色指引导出失败。')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
