import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Box, Check, ChevronDown, CircleHelp, Download, ExternalLink, FolderOpen, ImagePlus, Layers3, LoaderCircle, Palette, Plus, Settings2, Sparkles, WandSparkles, X, TriangleAlert, FileBox, Save, BookOpen, RefreshCw } from 'lucide-react';
import { Viewer, type ViewerHandle } from './Viewer';
import { CutoutPreview } from './CutoutPreview';
import { MaskEditor } from './MaskEditor';
import { ColorWorkbench } from './ColorWorkbench';
import { claySheet } from './clay-sheet';
import { QwenSettings } from './QwenSettings';
import { AndroidSettings } from './mobile/AndroidSettings';
import { SyncPanel } from './SyncPanel';
import { assetUrl, isActive, type Asset, type Bootstrap, type Capabilities, type ClayGuide, type Job, type Project, type Settings, type TextureConfig } from './types';

const defaultSettings: Settings = { server: 'http://127.0.0.1:8188', comfyPath: 'F:\\ComfyUI-aki\\ComfyUI', designCheckpoint: 'sdXL_v10VAEFix.safetensors', shapeCheckpoint: 'hunyuan_3d_v2.1.safetensors', imageEngine: 'qwen21', qwenModel: 'qwen_image_2.1_int8_convrot.safetensors', qwenEncoder: 'qwen3vl_8b_int8_convrot.safetensors', qwenVae: 'qwen_image_2.1_vae_bf16.safetensors', backgroundModel: 'birefnet.safetensors' };
const suggestions = ['抱着小猫的围裙女孩', '戴围巾的小小魔法师', '穿宇航服的圆脸少年'];
type Page = 'design' | 'workbench' | 'library';

export function App() {
  const api = window.studio;
  const android = !!window.QNative;
  const [data, setData] = useState<Bootstrap>({ settings: defaultSettings, projects: [], dataPath: '', active: null, version: '0.5.0' });
  const [currentId, setCurrentId] = useState(''); const [page, setPage] = useState<Page>('design');
  const [inputMode, setInputMode] = useState<'text' | 'image'>('text');
  const [sourceId, setSourceId] = useState(''); const [modelId, setModelId] = useState('');
  const [job, setJob] = useState<Job | null>(null); const [cap, setCap] = useState<Capabilities | null>(null);
  const [connection, setConnection] = useState<'offline' | 'checking' | 'online'>('offline');
  const [showSettings, setShowSettings] = useState(false); const [settingsDraft, setSettingsDraft] = useState(defaultSettings);
  const [showHelp, setShowHelp] = useState(false); const [toast, setToast] = useState(''); const [error, setError] = useState('');
  const [editingMask, setEditingMask] = useState(false);
  const [showSync, setShowSync] = useState(false), [paletteDirty, setPaletteDirty] = useState(false), [syncReload, setSyncReload] = useState(0);
  const [working, setWorking] = useState(false); const [quality, setQuality] = useState('standard'); const [denoise, setDenoise] = useState(0.65);
  const [modelInfo, setModelInfo] = useState({ faces: 0, meshes: 0 });
  const viewer = useRef<ViewerHandle>(null); const currentRef = useRef<Project | undefined>(undefined);
  const editState=useRef(false),pendingSyncRefresh=useRef(false);editState.current=editingMask||paletteDirty;
  const project = data.projects.find(p => p.id === currentId); currentRef.current = project;
  const busy = isActive(job); const disabled = working || busy;
  useEffect(() => { const back = () => { if(showSync)void api?.syncCancel?.();setShowSettings(false); setShowHelp(false); setShowSync(false); }; window.addEventListener('qcharacter-back', back); return () => window.removeEventListener('qcharacter-back', back); }, [api,showSync]);
  useEffect(() => { if (!currentId || !api?.syncEditing) return; void api.syncEditing(currentId, editingMask || paletteDirty); return () => { void api.syncEditing?.(currentId, false); }; }, [api,currentId,editingMask,paletteDirty]);
  const images = project?.assets.filter(x => !['model', 'mask'].includes(x.kind)) ?? [];
  const models = project?.assets.filter(x => x.kind === 'model') ?? [];
  const source = images.find(x => x.id === sourceId) ?? [...images].reverse().find(x => x.kind === 'cutout') ?? [...images].reverse().find(x => x.kind === 'design') ?? images[0];
  const model = models.find(x => x.id === modelId) ?? models.at(-1);
  const original = source?.sourceAssetId ? project?.assets.find(asset => asset.id === source.sourceAssetId) : undefined;
  const mask = source?.maskAssetId ? project?.assets.find(asset => asset.id === source.maskAssetId) : undefined;

  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(''), 4200); };
  const perform = async (fn: () => Promise<void>) => { setError(''); setWorking(true); try { if (!api) throw new Error('请在 Windows 桌面应用中使用此功能。'); await fn(); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setWorking(false); } };
  const refresh = useCallback(async () => { if (!api) return; const result = await api.bootstrap(); setData(result); if (currentRef.current) currentRef.current=result.projects.find(p=>p.id===currentRef.current?.id); return result; }, [api]);
  const connect = async () => {
    if (!api) return;
    setConnection('checking');
    try { const result = await api.connect(); setCap(result); setConnection('online'); }
    catch (e) { setConnection('offline'); setCap(null); setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api.bootstrap().then(result => { if (!alive) return; setData(result); setSettingsDraft(result.settings); setCurrentId(result.projects[0]?.id ?? ''); const w=result.projects[0]?.workspace;if(w){setSourceId(w.sourceId);setModelId(w.modelId);setPage(w.page);setInputMode(w.inputMode);}setJob(result.active); }).catch(e => setError(e.message));
    const unsubscribe = api.onJob(next => {
      if (!alive) return;
      setJob(next);
      if (!isActive(next)) void refresh().then(() => {
        if (next.status !== 'completed' || currentRef.current?.id !== next.projectId) return;
        if (next.kind === 'shape') { setModelId(next.resultAssetId || ''); setPage('workbench'); }
        else { setSourceId(next.resultAssetId || ''); setPage('design'); }
      });
    });
    return () => { alive = false; unsubscribe(); };
  }, [api, refresh]);
  const reloadSynced=useCallback(()=>{void refresh().then(result=>{if(editState.current){pendingSyncRefresh.current=true;return;}const p=result?.projects.find(p=>p.id===currentRef.current?.id);if(p?.workspace){setSourceId(p.workspace.sourceId);setModelId(p.workspace.modelId);setPage(p.workspace.page);setInputMode(p.workspace.inputMode);}setSyncReload(n=>n+1);}).catch(e=>setError(e.message));},[refresh]);
  useEffect(() => api?.onSync?.(event => { if (event.type !== 'changed') return;if(editState.current){pendingSyncRefresh.current=true;return;}reloadSynced(); }), [api,reloadSynced]);
  useEffect(()=>{if(!editingMask&&!paletteDirty&&pendingSyncRefresh.current){pendingSyncRefresh.current=false;reloadSynced();}},[editingMask,paletteDirty,reloadSynced]);

  const update = (fields: Partial<Project>) => {
    const value = currentRef.current;
    if (!value) return;
    const next = { ...value, ...fields }; currentRef.current = next;
    setData(old => ({ ...old, projects: old.projects.map(p => p.id === currentId ? next : p) }));
    void api?.saveProject(next.id, fields).catch(e => setError(e.message));
  };
  const save = async () => { const value = currentRef.current; if (value && api) {const saved=await api.saveProject(value.id, {workspace:{sourceId:source?.id||'',modelId:model?.id||'',page,inputMode}});if(currentRef.current?.id===saved.id){currentRef.current=saved;setData(old=>({...old,projects:old.projects.map(p=>p.id===saved.id?saved:p)}));}} };
  useEffect(()=>{if(!api||!project||disabled||showSync||editingMask)return;const w=project.workspace;if(w?.sourceId===(source?.id||'')&&w?.modelId===(model?.id||'')&&w?.page===page&&w?.inputMode===inputMode)return;const timer=setTimeout(()=>{void save().catch(e=>setError(e.message));},400);return()=>clearTimeout(timer);},[api,currentId,source?.id,model?.id,page,inputMode,disabled,showSync,editingMask,project?.workspace]);
  const selectProject = async (id: string) => { await save(); setCurrentId(id); const w=data.projects.find(p=>p.id===id)?.workspace;setSourceId(w?.sourceId||'');setModelId(w?.modelId||'');if(w){setPage(w.page);setInputMode(w.inputMode);} };
  useEffect(() => { if (!android || !api?.syncRun) return; const timer=setInterval(()=>{if(document.visibilityState!=='visible'||disabled||editingMask||paletteDirty||showSync||showSettings||showHelp)return;void api.syncStatus!().then(status=>{if(!status.auto||!status.paired)return;return perform(async()=>{await save();const r=await api.syncRun!();if(r.errors.length)setError(`自动同步：${r.errors[0].message}`);if(r.changed||r.conflicts)notify(`已同步 ${r.changed} 个作品${r.conflicts?`，保留 ${r.conflicts} 个冲突副本`:''}`);});}).catch(e=>setError(e.message));},30000);return()=>clearInterval(timer); });
  const openSync = () => perform(async()=>{if(paletteDirty)throw new Error('请先点击“保存配色”，再同步作品。');await save();setShowSync(true);});
  const createProject = () => perform(async () => { await save(); const next = await api!.createProject(`我的小角色 ${data.projects.length + 1}`); await refresh(); setCurrentId(next.id); setSourceId(''); setModelId(''); setPage('design'); });
  const importAsset = (kind: 'reference' | 'model') => perform(async () => {
    if (!project) return; await save(); const next = await api!.importAsset(project.id, kind);
    if (next) { await refresh(); const asset = next.assets.at(-1)!; if (kind === 'model') { setModelId(asset.id); setPage('workbench'); } else { setSourceId(asset.id); setInputMode('image'); } }
  });
  const generate = (kind: 'design' | 'shape' | 'matte') => perform(async () => {
    if (!project) return;
    if (kind === 'design' && inputMode === 'text' && !project.description.trim()) throw new Error('先写下你想制作的角色。建议包含发型、服装、姿势和配饰。');
    if ((kind !== 'design' || inputMode === 'image') && !source) throw new Error('请先导入或生成一张角色图片。');
    await save();
    const inputId = kind === 'matte' && source?.kind === 'cutout' && original ? original.id : source?.id;
    const next = await api!.generate(project.id, { kind, assetId: kind !== 'design' || inputMode === 'image' ? inputId : undefined, denoise, quality });
    setJob(next);
  });
  const exportModel = (format: 'glb' | 'stl') => perform(async () => {
    if (!project || !model || !viewer.current) return;
    const bytes = await viewer.current.exportModel(format, project.heightMm);
    if (await api!.exportBytes({ name: `${project.name}-${project.heightMm}mm.${format}`, bytes })) notify(`已导出 ${format.toUpperCase()} · ${project.heightMm} mm`);
  });
  const exportSheet = () => perform(async () => {
    if (!project || !viewer.current) return;
    const bytes = await viewer.current.referenceSheet(project.heightMm, project.name);
    if (await api!.exportBytes({ name: `${project.name}-三视图.png`, bytes })) notify('三视图参考已导出');
  });
  const saveSettings = () => perform(async () => {
    const result = await api!.settings(settingsDraft); setData(old => ({ ...old, settings: result })); setSettingsDraft(result); setShowSettings(false); setCap(null); setConnection('offline'); notify('连接设置已保存');
  });
  const saveMask = async (bytes: Uint8Array) => {
    if (!api || !project || !source) throw new Error('找不到当前作品。');
    const next = await api.saveMask(project.id, source.id, bytes);
    setData(old => ({ ...old, projects: old.projects.map(value => value.id === next.id ? next : value) }));
    setSourceId(next.assets.at(-1)!.id); setEditingMask(false); notify('修正已保存为新版本，可继续生成 3D');
  };
  const acceptProject = (next: Project) => {if(currentRef.current?.id===next.id)currentRef.current=next;setData(old => ({ ...old, projects: old.projects.map(p => p.id === next.id ? next : p) }));};
  const saveGuide = async (guide: ClayGuide) => {
    if (!api || !project) throw new Error('找不到当前作品。');
    const next = await api.saveProject(project.id, { clayGuide: guide }); acceptProject(next); notify('配色与基础黏土设置已保存');
  };
  const colorModel = (referenceId: string, config: TextureConfig) => perform(async () => {
    if (!project || !model || !viewer.current) return;
    await save();
    const bytes = await viewer.current.texture(assetUrl(project, project.assets.find(a => a.id === referenceId)!), config.swatches, config.projection);
    const next = await api!.saveTexture(project.id, model.id, referenceId, bytes, config);
    acceptProject(next); setModelId(next.assets.at(-1)!.id); notify('彩色模型已保存，可旋转检查并导出带贴图 GLB');
  });
  const exportGuide = (guide: ClayGuide, grams: number) => perform(async () => {
    if (!project) return;
    const bytes = await claySheet(guide, project.name, grams);
    if (await api!.exportBytes({ name: `${project.name}-黏土调色指引.png`, bytes })) notify('黏土调色指引已导出');
  });
  return <div className="app-shell" data-page={page}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Box size={25} strokeWidth={1.6}/></span><div>Q Character<span>让想象，变得可爱一点。</span></div></div>
      <div className="nav-label">创作空间</div>
      <nav><button className={page === 'design' ? 'active' : ''} onClick={() => setPage('design')}><WandSparkles size={19}/>角色设计<span>01</span></button><button className={page === 'workbench' ? 'active' : ''} onClick={() => setPage('workbench')}><Box size={19}/>3D 工作台<span>02</span></button><button className={page === 'library' ? 'active' : ''} onClick={() => setPage('library')}><Layers3 size={19}/>我的作品<span>{data.projects.length.toString().padStart(2, '0')}</span></button></nav>
      <div className="sidebar-divider"/>
      <div className="nav-label projects-label">最近的作品<button title="新建作品" disabled={disabled} onClick={createProject}><Plus size={16}/></button></div>
      <div className="recent-projects">{data.projects.slice(0, 6).map(p => <button className={p.id === currentId ? 'current' : ''} key={p.id} onClick={() => void perform(() => selectProject(p.id))}><span className="project-dot"/>{p.name}</button>)}{!data.projects.length && <p>小小的灵感，从这里开始。</p>}</div>
      <div className="sidebar-bottom"><div className="craft-note"><Palette size={20}/><strong>为手作而设计</strong><p>从一个灵感，到掌心里的<br/>小小角色。</p><span>MADE FOR YOUR LITTLE WORLD</span></div><button className="settings-link" disabled={disabled} onClick={() => { setSettingsDraft(data.settings); setShowSettings(true); }}><Settings2 size={18}/>生成服务设置</button><div className="version">Q CHARACTER STUDIO <span>v{data.version}</span></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">我的创作空间<span>/</span><strong>{page === 'design' ? '角色设计' : page === 'workbench' ? '3D 工作台' : '我的作品'}</strong></div><div className="top-actions">{api?.syncStatus&&<button className="sync-top-button" disabled={disabled} onClick={openSync}><RefreshCw size={16}/>作品同步</button>}<button className={`connection ${connection}`} onClick={() => void connect()} disabled={connection === 'checking'}><span/>{connection === 'online' ? 'ComfyUI 已连接' : connection === 'checking' ? '正在连接…' : '连接 ComfyUI'}</button><button className="icon-button" onClick={() => setShowHelp(true)} title="使用指南"><CircleHelp size={19}/></button></div></header>
      {!api && <div className="browser-notice">这是界面预览。生成、保存和导出功能请使用 Windows 桌面应用。</div>}
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">YOUR LITTLE CHARACTER LAB</div><h1>{page === 'design' ? '把灵感，捏成小可爱。' : page === 'workbench' ? '换个角度，认识你的小角色。' : '收藏每一次小小的创造。'}</h1><p>{page === 'design' ? '从一句描述或一张照片开始，设计专属于你的 Q 版手办。' : page === 'workbench' ? '旋转观察体积，导出三视图，让下一次手作更有把握。' : (android ? '设计图、模型和生成记录，都保存在手机里。' : '设计图、模型和生成记录，都保存在你的电脑里。')}</p></div><button className="secondary new-project" disabled={disabled} onClick={createProject}><Plus size={16}/>新建作品</button></div>
        {error && <div className="message error"><TriangleAlert size={18}/><span>{error}</span><button onClick={() => setError('')} title="关闭提示"><X size={16}/></button></div>}
        {job && <div className={`job-strip ${job.status}`}><div className="job-icon">{busy ? <LoaderCircle className="spin" size={19}/> : job.status === 'completed' ? <Check size={19}/> : <TriangleAlert size={19}/>}</div><div><strong>{job.kind === 'shape' ? '3D 模型生成' : job.kind === 'matte' ? '人物自动抠图' : '角色设计图生成'}</strong><span>{job.message}</span>{job.promptId && <small>任务 {job.promptId.slice(0, 8)} · 随机种子 {job.seed}</small>}</div>{busy && job.progress !== undefined && <span>{job.progress}%</span>}{!busy && job.status === 'interrupted' && job.promptId && api?.resumeJob && <button disabled={working} onClick={() => void perform(async () => { setJob(await api.resumeJob!(job.projectId, job.id)); })}>继续接收</button>}{busy ? <button onClick={() => void perform(async () => { await api!.cancel(); })} disabled={working}>取消任务</button> : <button onClick={() => setJob(null)} title="隐藏任务提示"><X size={16}/></button>}</div>}

        {page === 'library' ? <div className="library-grid">{data.projects.map(p => { const cover = [...p.assets].reverse().find(x => !['model', 'mask', 'prepared'].includes(x.kind)); return <button className="project-card" key={p.id} onClick={() => void perform(async () => { await selectProject(p.id); setPage('design'); })}><div className="project-cover">{cover ? <img src={assetUrl(p, cover)}/> : <Box size={58} strokeWidth={1}/>}<span>{p.assets.filter(x => x.kind === 'model').length} 个模型</span></div><div><h3>{p.name}</h3><p>{new Date(p.updatedAt).toLocaleDateString('zh-CN')} · {p.assets.length} 个素材<ArrowUpRight size={18}/></p></div></button>; })}<button className="project-card add-card" onClick={createProject} disabled={disabled}><Plus size={30}/><span>开始一个新角色</span></button></div> : !project ? <div className="welcome-panel"><div><span className="pill">每一个可爱，都值得被创造</span><h2>你的第一个角色，<br/>会是什么样子？</h2><p>上传人物图片，或描述脑海中的小角色。<br/>先确认设计，再把它变成可旋转的 3D 泥模。</p><button className="primary" onClick={createProject} disabled={disabled}><Plus size={18}/>创建我的第一个作品</button></div><div className="welcome-model"><Viewer/></div></div> : <>
          <div className="project-title"><span className="project-dot"/><input aria-label="作品名称" value={project.name} disabled={disabled} onChange={e => update({ name: e.target.value })}/><span className="autosave">本机保存</span><button title="保存作品" onClick={() => void perform(async () => { await save(); notify('作品已保存'); })}><Save size={16}/></button>{!android && <button title="打开作品文件夹" onClick={() => void perform(async () => { await api!.openFolder(project.id); })}><FolderOpen size={17}/></button>}</div>
          <div className="studio-grid">
            <section className="design-panel panel">
              <div className="panel-heading"><span className="step-number">01</span><h2>设计你的小角色</h2><span className="subtle">CHARACTER</span></div>
              <div className="input-tabs"><button className={inputMode === 'text' ? 'selected' : ''} onClick={() => setInputMode('text')} disabled={disabled}><Sparkles size={16}/>文字灵感</button><button className={inputMode === 'image' ? 'selected' : ''} onClick={() => setInputMode('image')} disabled={disabled}><ImagePlus size={16}/>图片参考</button></div>
              {inputMode === 'image' && <div className="image-engine-note"><strong>{data.settings.imageEngine === 'qwen21' ? 'Qwen 2.1 · 人物参考编辑' : 'SDXL · 基础图片重绘'}</strong><span>{data.settings.imageEngine === 'qwen21' ? '参考原图引导身份特征、发型和服装，支持中文补充要求。' : '基础重绘较容易改变人物身份，可在设置中切换 Qwen。'}</span></div>}{inputMode === 'image' && <button className={`upload-box ${source ? 'has-image' : ''}`} onClick={() => importAsset('reference')} disabled={disabled}>{source ? <><img src={assetUrl(project, source)}/><span>点击更换参考图片</span></> : <><ImagePlus size={27}/><strong>选择一张人物图片</strong><span>PNG、JPG、WebP · 建议全身、背景简洁</span></>}</button>}
              <label className="field-label">{inputMode === 'text' ? '描述你的角色' : '希望怎样变可爱？'}<span>灵感由你，细节交给想象</span></label>
              <textarea value={project.description} disabled={disabled} onChange={e => update({ description: e.target.value })} placeholder="例如：一个棕色短发的女孩，穿绿色背带裙，抱着一只橘猫，圆圆的脸，温柔的微笑……" maxLength={6000}/>
              <div className="prompt-hint"><Sparkles size={13}/>{inputMode === 'image' ? (data.settings.imageEngine === 'qwen21' ? 'Qwen 会参考人物特征；仍请检查五官、衣服和配饰。' : '基础图生图会改变人物特征，请先确认设计图。') : 'SDXL 建议使用英文描述，中文提示词效果取决于模型。'}</div>
              <div className="suggestions">{suggestions.map(s => <button key={s} disabled={disabled} onClick={() => update({ description: s === suggestions[0] ? 'a young girl with short brown hair, wearing a green apron dress, holding a small orange cat, round face, gentle smile' : s === suggestions[1] ? 'a little wizard wearing a cozy scarf and a star-patterned pointed hat, holding a tiny magic wand' : 'a round-faced boy wearing a white astronaut suit, holding a small planet, cheerful smile' })}>{s}<Plus size={12}/></button>)}</div>
              <div className="field-row"><label>头身比例 <span>用于设计图引导</span></label><div className="ratio-options">{['2', '2.5', '3'].map(value => <button className={project.ratio === value ? 'selected' : ''} key={value} disabled={disabled} onClick={() => update({ ratio: value })}><span className={`ratio-icon ratio-${value.replace('.', '')}`}><i/><b/></span><strong>{value} 头身</strong><small>{value === '2' ? '软萌团子' : value === '2.5' ? '经典 Q 版' : '灵动可爱'}</small>{project.ratio === value && <Check size={12}/>}</button>)}</div></div>
              <div className="field-row"><label>外观风格</label><div className="style-options"><button className={project.style === 'clay' ? 'selected' : ''} disabled={disabled} onClick={() => update({ style: 'clay' })}><span className="style-swatch clay"/>黏土手作{project.style === 'clay' && <Check size={14}/>}</button><button className={project.style === 'anime' ? 'selected' : ''} disabled={disabled} onClick={() => update({ style: 'anime' })}><span className="style-swatch anime"/>动漫手办{project.style === 'anime' && <Check size={14}/>}</button></div></div>
              {inputMode === 'image' && data.settings.imageEngine === 'sdxl' && <label className="range-field">重绘强度 <strong>{denoise.toFixed(2)}</strong><input type="range" min="0.2" max="0.95" step="0.05" disabled={disabled} value={denoise} onChange={e => setDenoise(Number(e.target.value))}/><small>越高越容易改变外观，人物相似度可能降低。</small></label>}
              <button className="primary generate-button" disabled={disabled} onClick={() => generate('design')}>{busy && job?.kind === 'design' ? <LoaderCircle size={18} className="spin"/> : <WandSparkles size={18}/>}生成 Q 版设计图<ArrowRight size={17}/></button><div className="model-caption">{(inputMode === 'image' && data.settings.imageEngine === 'qwen21' ? data.settings.qwenModel : data.settings.designCheckpoint).replace('.safetensors', '')}<button onClick={() => { setSettingsDraft(data.settings); setShowSettings(true); }} disabled={disabled}>更换<ChevronDown size={12}/></button></div>
            </section>

            <section className="preview-panel panel"><div className="panel-heading"><span className="step-number">02</span><h2>{page === 'workbench' ? '3D 模型工作台' : '你的角色，逐渐成形'}</h2><div className="preview-tabs"><button className={page === 'design' ? 'selected' : ''} onClick={() => setPage('design')}>设计图</button><button className={page === 'workbench' ? 'selected' : ''} onClick={() => setPage('workbench')}>3D 预览</button></div></div>
              {page === 'workbench' ? <Viewer ref={viewer} url={model ? assetUrl(project, model) : undefined} filename={model?.filename} onLoaded={setModelInfo}/> : <div className={`design-preview ${source?.kind === 'cutout' ? 'cutout-container' : ''}`}>{source?.kind === 'cutout' ? <CutoutPreview key={source.id} cutout={assetUrl(project, source)} original={original ? assetUrl(project, original) : undefined} mask={mask ? assetUrl(project, mask) : undefined} disabled={disabled} onEdit={() => setEditingMask(true)}/> : source ? <><img src={assetUrl(project, source)} alt="当前角色设计参考"/><span className="image-kind">{source.kind === 'design' ? 'Q 版设计图' : '参考图片'}</span><button className="image-save" title="导出图片" onClick={() => void perform(async () => { if (await api!.exportAsset(project.id, source.id)) notify('图片已导出'); })}><Download size={17}/></button></> : <><div className="empty-design"><span className="sketch-circle"><Palette size={42} strokeWidth={1.2}/></span><h3>给想象一个轮廓</h3><p>写下角色描述，或导入一张喜欢的图片。<br/>生成后，在这里确认你的 Q 版设计。</p><span>先设计 · 再建模 · 慢慢捏出喜欢的样子</span></div><div className="preview-corner">YOUR IMAGINATION STARTS HERE</div></>}</div>}
              <div className="asset-strip">{(page === 'workbench' ? models : images).map((asset, index) => <button key={asset.id} className={(page === 'workbench' ? model?.id : source?.id) === asset.id ? 'selected' : ''} onClick={() => page === 'workbench' ? setModelId(asset.id) : setSourceId(asset.id)} title={asset.label}>{asset.kind === 'model' ? <><Box size={21}/><small>{index + 1}</small></> : <img src={assetUrl(project, asset)} alt={asset.label}/>}</button>)}<button className="asset-add" onClick={() => importAsset(page === 'workbench' ? 'model' : 'reference')} disabled={disabled} title={page === 'workbench' ? '导入模型' : '导入图片'}><Plus size={19}/></button><span>{page === 'workbench' ? `${models.length} 个模型版本` : `${images.length} 张角色图片`}</span></div>
              <div className="shape-input-options semantic-matte"><div><strong>BiRefNet 语义抠图</strong><span>根据人物轮廓分离背景，保留浅色衣服；已有透明通道会直接保留。</span></div><button className="secondary" disabled={disabled || !source} onClick={() => generate('matte')}>{source?.kind === 'cutout' ? '重新抠图' : '自动抠图'}</button>{source?.kind === 'cutout' && <button className="secondary" disabled={disabled} onClick={() => void perform(async () => { await api!.exportAsset(project.id, source.id); })}><Download size={13}/>透明 PNG</button>}</div><div className="generation-footer"><div><strong>{page === 'workbench' ? (model ? `${modelInfo.faces.toLocaleString()} 个三角面` : '等待你的第一个模型') : (source?.kind === 'cutout' ? '检查抠图轮廓，再让它立体起来。' : '先抠出角色，再确认 3D 输入。')}</strong><p>{page === 'workbench' ? '泥模用于体积参考，可在 Blender 继续修形。' : (source?.kind === 'cutout' ? '重点检查衣服、发梢、配饰与脚边阴影。' : '自动生成透明前景与蒙版，可切换原图对照。')}</p></div><div className="shape-actions"><select aria-label="模型精度" value={quality} onChange={e => setQuality(e.target.value)} disabled={disabled}><option value="draft">快速草模</option><option value="standard">标准泥模</option></select><button className="dark-button" disabled={disabled || !source} onClick={() => generate(source?.kind === 'cutout' ? 'shape' : 'matte')}><Box size={17}/>{source?.kind === 'cutout' ? '生成 3D' : '先自动抠图'}<ArrowRight size={15}/></button></div></div>
            </section>
          </div>

          {page === 'workbench' && <ColorWorkbench key={`${project.id}-${syncReload}`} onDirtyChange={setPaletteDirty} project={project} model={model} disabled={disabled} onTexture={colorModel} onSave={saveGuide} onExport={exportGuide}/>}
          {page === 'workbench' && <section className="export-panel panel"><div><span className="eyebrow">READY FOR YOUR WORKBENCH</span><h3>带到你的手作台</h3><p>GLB 使用米，STL 使用毫米；按目标高度缩放导出。</p></div><label>目标高度<div><input type="number" min="10" max="500" value={project.heightMm} disabled={disabled} onChange={e => update({ heightMm: Math.min(500, Math.max(10, Number(e.target.value) || 80)) })}/><span>mm</span></div></label><div className="export-buttons"><button className="secondary" disabled={disabled || !model} onClick={exportSheet}><BookOpen size={17}/>三视图参考</button><button className="secondary" disabled={disabled || !model} onClick={() => exportModel('stl')}><FileBox size={17}/>STL</button><button className="primary" disabled={disabled || !model} onClick={() => exportModel('glb')}><Download size={17}/>导出 GLB</button></div></section>}
          <div className="bottom-notes"><span><span className="live-dot"/>{android ? '远程生成 · 手机保存 · 复用你的 ComfyUI' : '本机生成 · 本机保存 · 复用你的 ComfyUI'}</span><button onClick={() => setShowHelp(true)}>关于黏土手办的设计建议<ArrowUpRight size={14}/></button></div>
          {project.jobs.length > 0 && <details className="history"><summary>生成记录 <span>{project.jobs.length}</span></summary>{[...project.jobs].reverse().slice(0, 10).map(item => <div key={item.id}><span>{item.kind === 'shape' ? '3D 模型' : item.kind === 'matte' ? '自动抠图' : '设计图'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span><code title={item.promptId}>种子 {item.seed}{item.promptId ? ` · ${item.promptId.slice(0, 8)}` : ''}</code><span>{({ completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '需找回' } as Record<string, string>)[item.status] || '处理中'}</span><p>{item.message}</p>{item.status === 'interrupted' && item.promptId && api?.resumeJob && <button className="secondary" disabled={disabled} onClick={() => void perform(async () => { setJob(await api.resumeJob!(project.id, item.id)); })}>继续接收此任务</button>}</div>)}</details>}
        </>}
      </div>
    </main>
    {editingMask && project && source && original && <MaskEditor key={source.id} original={assetUrl(project, original)} mask={mask ? assetUrl(project, mask) : undefined} cutout={assetUrl(project, source)} onSave={saveMask} onClose={() => setEditingMask(false)}/>}
    {showSync && api && <SyncPanel api={api} projectId={project?.id} onClose={()=>setShowSync(false)} onSynced={async()=>{await refresh();}}/>}
    {showSettings && <div className="modal-backdrop"><section className="modal"><div className="modal-heading"><div><span className="eyebrow">LOCAL GENERATION SERVICE</span><h2>连接你的 ComfyUI</h2></div><button onClick={() => setShowSettings(false)} title="关闭设置"><X size={21}/></button></div><p>{android ? '填写远程 ComfyUI 的完整地址（含 http:// 或 https://、端口和代理路径）。生成在远程电脑执行，作品保存到手机。' : '先在绘世启动器启动 ComfyUI，然后填写服务地址。连接时会检查当前模型和节点。'}</p><label>服务地址<input value={settingsDraft.server} onChange={e => setSettingsDraft({ ...settingsDraft, server: e.target.value, ...(android ? { certificateFingerprint: undefined, hasCredentials: false, authToken: '', authPassword: '' } : {}) })}/></label>{!android && <label>ComfyUI 所在目录<input value={settingsDraft.comfyPath} onChange={e => setSettingsDraft({ ...settingsDraft, comfyPath: e.target.value })}/><small>用于记录环境位置；应用通过上面的服务地址执行生成。</small></label>}{android && api && <AndroidSettings value={settingsDraft} onChange={setSettingsDraft} api={api}/>}<label>设计图模型 · SDXL<input list="design-models" value={settingsDraft.designCheckpoint} onChange={e => setSettingsDraft({ ...settingsDraft, designCheckpoint: e.target.value })}/><datalist id="design-models">{cap?.checkpoints.map(x => <option key={x} value={x}/>)}</datalist></label><label>3D 模型 · 混元 3D 整合检查点<input list="shape-models" value={settingsDraft.shapeCheckpoint} onChange={e => setSettingsDraft({ ...settingsDraft, shapeCheckpoint: e.target.value })}/><datalist id="shape-models">{cap?.shapeCheckpoints.map(x => <option key={x} value={x}/>)}</datalist></label><QwenSettings value={settingsDraft} onChange={setSettingsDraft} capabilities={cap}/>{cap && <div className="capabilities"><Check size={16}/><span>{cap.stats.devices[0]?.name} · ComfyUI {cap.stats.system.comfyui_version}{cap.missingShapeNodes.length ? ` · 缺少：${cap.missingShapeNodes.join('、')}` : ' · 原生 3D 节点已就绪'}</span></div>}<div className="modal-tip">图片参考默认使用 Qwen 2.1 专用编辑流程；自动抠图使用 BiRefNet 前景蒙版。文字设计仍使用 SDXL，3D 先生成几何泥模，可在工作台按设计图上色。</div><div className="modal-actions"><button className="secondary" onClick={() => void api?.openComfy()}><ExternalLink size={16}/>打开当前服务</button><button className="secondary" disabled={working || connection === 'checking'} onClick={() => void connect()}>检查已保存的连接</button><button className="primary" disabled={disabled} onClick={saveSettings}>保存设置</button></div><small className="data-location">作品目录：{data.dataPath || 'Windows 应用数据目录'}</small></section></div>}
    {showHelp && <div className="modal-backdrop"><section className="modal help-modal"><div className="modal-heading"><h2>从灵感到掌心里的角色</h2><button onClick={() => setShowHelp(false)} title="关闭使用指南"><X size={21}/></button></div><ol><li><strong>先准备清晰的角色设计。</strong>全身、单人、正面、浅色背景。头部和四肢尽量不互相遮挡；照片也可以直接生成模型，但不会自动变成 Q 版。</li><li><strong>先确认 Q 版，再生成 3D。</strong>头身比例与风格通过提示词引导，不能精确保证。图片参考默认走 Qwen 2.1 人物编辑，但仍不能保证精确相似度。生成设计后先自动抠图，用透明轮廓、白底、前景蒙版和原图对照检查衣服与配饰，再生成 3D。</li><li><strong>用泥模观察体积和轮廓。</strong>单图无法确定背面，模型会推测不可见部分。自动网格可能需要在 Blender 修补；不会自动分出头发、衣服或手臂。</li><li><strong>导出参考与模型。</strong>三视图来自同一个模型，便于对照。GLB 可在 Blender 通过“文件 → 导入 → glTF 2.0”打开；STL 是没有颜色的几何网格。在工作台下方可按设计图上色，保存后导出内嵌贴图的 GLB；也能编辑角色配色并导出黏土调色指引。侧背面按色块延展，完成后请旋转检查。</li></ol><div className="modal-tip">BiRefNet 按前景语义抠图，不按白色删除衣服；复杂背景仍可能有误差。轮廓不满意时，点击“手动修正”，用恢复与擦除画笔修正蒙版，保存后再生成 3D。用于黏土时，优先选择稳固站姿、圆润发块、简化手指和较粗配饰。每次生成都会保留素材、种子与工作流，方便回溯。</div><button className="primary" onClick={() => setShowHelp(false)}>开始创作<ArrowRight size={16}/></button></section></div>}
    {toast && <div className="toast"><Check size={18}/>{toast}</div>}
  </div>;
}
