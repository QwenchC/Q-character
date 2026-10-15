import { useState } from 'react';

export function CutoutPreview({ cutout, original, mask, onEdit, disabled }: { cutout: string; original?: string; mask?: string; onEdit?: () => void; disabled?: boolean }) {
  const [mode, setMode] = useState<'transparent' | 'white' | 'mask' | 'original'>('transparent');
  const image = mode === 'original' ? original : mode === 'mask' ? mask : cutout;
  return <div className="cutout-preview">
    <div className="cutout-modes"><button className={mode === 'transparent' ? 'selected' : ''} onClick={() => setMode('transparent')}>透明轮廓</button><button className={mode === 'white' ? 'selected' : ''} onClick={() => setMode('white')}>白底检查</button><button className={mode === 'mask' ? 'selected' : ''} disabled={!mask} onClick={() => setMode('mask')}>前景蒙版</button><button className={mode === 'original' ? 'selected' : ''} disabled={!original} onClick={() => setMode('original')}>对照原图</button></div>
    <div className={`cutout-stage ${mode}`}><img src={image} alt={mode === 'mask' ? '前景蒙版，白色为保留部分' : mode === 'original' ? '抠图前的原图' : '人物透明抠图结果'}/></div>
    <div className="cutout-inspect"><p>{mode === 'mask' ? '白色保留，黑色删除。检查衣服、头发和配饰是否完整。' : '确认衣服、头发、配饰完整，背景与地面阴影已移除，再生成 3D。'}</p><button className="secondary" disabled={disabled || !original} onClick={onEdit}>手动修正</button></div>
  </div>;
}
