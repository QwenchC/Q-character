import type { Capabilities, Settings } from './types';

export function QwenSettings({ value, onChange, capabilities }: { value: Settings; onChange: (value: Settings) => void; capabilities: Capabilities | null }) {
  const editReady = capabilities && !capabilities.missingEditNodes.length && capabilities.qwenModels.includes(value.qwenModel) && capabilities.qwenEncoders.includes(value.qwenEncoder) && capabilities.qwenVaes.includes(value.qwenVae);
  const matteReady = capabilities && !capabilities.missingMatteNodes.length && capabilities.backgroundModels.includes(value.backgroundModel);
  const fields = [
    { key: 'qwenModel' as const, label: 'Qwen 2.1 编辑模型', options: capabilities?.qwenModels },
    { key: 'qwenEncoder' as const, label: '视觉编码器 · qwen3vl_8b', options: capabilities?.qwenEncoders },
    { key: 'qwenVae' as const, label: 'Qwen 2.1 VAE', options: capabilities?.qwenVaes },
    { key: 'backgroundModel' as const, label: '语义抠图模型 · BiRefNet', options: capabilities?.backgroundModels },
  ];
  return <div className="qwen-settings"><label>照片转 Q 版方式<select value={value.imageEngine} onChange={e => onChange({ ...value, imageEngine: e.target.value as Settings['imageEngine'] })}><option value="qwen21">Qwen-Image 2.1 · 参考图编辑</option><option value="sdxl">SDXL · 基础重绘</option></select></label>{fields.map(field => <label key={field.key}>{field.label}<input list={`models-${field.key}`} value={value[field.key]} onChange={e => onChange({ ...value, [field.key]: e.target.value })}/><datalist id={`models-${field.key}`}>{field.options?.map(option => <option key={option} value={option}/>)}</datalist></label>)}<small>配套加载器分别读取生成模型、视觉编码器和 VAE。qwen3.5 提示词增强器不能替代这里的视觉编码器。</small>{capabilities && <p className="capabilities">Qwen 编辑：{editReady ? '模型与节点就绪' : '缺少已选模型或节点'}<br/>BiRefNet 抠图：{matteReady ? '模型与节点就绪' : '缺少已选模型或节点'}</p>}</div>;
}
