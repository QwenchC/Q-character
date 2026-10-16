import { useEffect, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { ServerCertificate, StudioBridge, SyncResult, SyncStatus } from './types';
import './sync.css';

export function SyncPanel({ api, projectId, onClose, onSynced }: { api: StudioBridge; projectId?: string; onClose: () => void; onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatus | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<SyncResult | null>(null);
  const [server, setServer] = useState(''), [code, setCode] = useState(''), [port, setPort] = useState(8790), [publicUrl, setPublicUrl] = useState(''), [certificate, setCertificate] = useState<ServerCertificate | null>(null);
  const load = async () => { const s = await api.syncStatus!(); setStatus(s); setServer(s.server || ''); setPort(s.port || 8790); setPublicUrl(s.publicUrl || ''); };
  useEffect(() => { void load().catch(e => setError(e.message)); return api.onSync?.(event => { if (event.type === 'progress') setMessage(event.message || ''); }); }, [api]);
  useEffect(()=>{if(status?.platform!=='desktop')return;const timer=setInterval(()=>{if(!busy)void api.syncStatus!().then(setStatus).catch(e=>setError(e.message));},5000);return()=>clearInterval(timer);},[api,status?.platform,busy]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setBusy(false); } };
  const run = (all: boolean) => action(async () => { setResult(null); setMessage('正在比较两端作品…'); const r = await api.syncRun!(all ? undefined : projectId ? [projectId] : undefined); setResult(r); setMessage('本轮同步结束'); await onSynced(); });
  return <div className="modal-backdrop"><section className="modal sync-modal" role="dialog" aria-modal="true" aria-label="电脑与手机作品同步"><div className="modal-heading"><div><span className="eyebrow">CONTINUE YOUR LITTLE WORLD</span><h2>电脑与手机作品同步</h2></div><button title="关闭同步" disabled={busy} onClick={onClose}><X size={21}/></button></div>
    {!status ? <p>正在读取同步设置…</p> : status.platform === 'desktop' ? <>
      <p>开启后，已配对的手机可访问作品库，并双向同步设计图、蒙版、模型和调色方案。电脑应用需要保持运行。</p>
      <label>同步端口<input aria-label="同步端口" type="number" min="1024" max="65535" disabled={busy || status.enabled} value={port} onChange={e => setPort(Number(e.target.value))}/></label>
      <label>外网同步地址（可选）<input aria-label="外网同步地址" placeholder="https://your-host.example:port" disabled={busy || status.enabled} value={publicUrl} onChange={e => setPublicUrl(e.target.value)}/><small>为同步服务单独配置 TCP 穿透，转发至此端口。SakuraFrp 请关闭此隧道的“自动 HTTPS”，透传应用自身的 HTTPS。它与 ComfyUI 地址分开；同一 Wi-Fi 可直接使用下方局域网地址。</small></label>
      <div className="sync-actions"><button className="primary" disabled={busy} onClick={() => void action(async () => { const s = await api.syncConfigure!({enabled: !status.enabled, port, publicUrl}); setStatus(s); })}>{status.enabled ? '关闭同步服务' : '开启 HTTPS 同步服务'}</button><button className="secondary" disabled={busy || !status.enabled} onClick={() => void action(async () => setStatus(await api.syncPairCode!()))}>生成手机配对码</button></div>
      {status.enabled && <div className="sync-details"><strong>在手机填写其中一个可访问地址</strong>{status.urls?.map(url => <code key={url}>{url}</code>)}<p>首次连接时，核对手机证书指纹与这里一致：</p><code>{status.fingerprint}</code>{status.pairing && <div className="pair-code"><span>配对码</span><strong>{status.pairing.code}</strong><small>有效至 {new Date(status.pairing.expiresAt).toLocaleTimeString()}，只可成功配对一次。</small></div>}</div>}
      {status.error && <p className="sync-error">{status.error}</p>}
      <h3>已配对手机</h3>{!status.devices?.length && <p>尚无配对设备。</p>}{status.devices?.map(d => <div className="sync-device" key={d.id}><span>{d.name}<small>{new Date(d.pairedAt).toLocaleString()}</small></span><button className="secondary" disabled={busy} onClick={() => void action(async () => setStatus(await api.syncRevoke!(d.id)))}>撤销访问</button></div>)}
      <p>手机点击“立即同步”，或开启前台自动同步。收到更新后，电脑作品库会自动刷新。修正蒙版或有未保存配色时，该作品暂停接收同步。</p>
    </> : <>
      <p>在 Windows 的“作品同步”中开启服务并生成配对码。手机与电脑同一 Wi-Fi 时使用局域网地址；外网使用单独配置的穿透地址。</p>
      <label>电脑同步地址<input aria-label="电脑同步地址" value={server} disabled={busy} placeholder="https://192.168.1.10:8790" onChange={e => { setServer(e.target.value); setCertificate(null); }}/></label>
      <div className="sync-actions"><button className="secondary" disabled={busy || !server.startsWith('https://')} onClick={() => void action(async () => { setCertificate(await api.syncInspectCertificate!(server)); })}>检查同步证书</button></div>
      {certificate && <div className="sync-details"><strong>{certificate.server}</strong><p>{certificate.subject}</p><small>{certificate.validFrom} — {certificate.validTo}</small><code>{certificate.fingerprint}</code><button className="secondary" disabled={busy} onClick={() => void action(async () => { if (await api.syncTrustCertificate!(certificate)) setMessage('已授权这张同步证书。请填写电脑上的配对码。'); })}>与电脑指纹核对后授权</button></div>}
      <label>电脑显示的配对码<input aria-label="手机配对码" inputMode="numeric" maxLength={8} disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}/></label>
      <div className="sync-actions"><button className="primary" disabled={busy || code.length !== 8} onClick={() => void action(async () => { await api.syncPair!(server, code); setCode(''); await load(); setMessage('配对成功，可以双向同步。'); })}>配对此电脑</button>{status.paired && <button className="secondary" disabled={busy} onClick={() => void action(async () => { await api.syncForget!(); await load(); setMessage('已断开连接；本机作品保留。'); })}>断开配对</button>}</div>
      {status.paired && <div className="sync-ready"><strong>已配对：{status.server}</strong><div className="sync-actions"><button className="primary" disabled={busy} onClick={() => void run(true)}><RefreshCw size={16}/>双向同步全部作品</button><button className="secondary" disabled={busy || !projectId} onClick={() => void run(false)}>只同步当前作品</button></div><label className="sync-auto"><input type="checkbox" checked={!!status.auto} disabled={busy} onChange={e => void action(async () => { await api.syncAuto!(e.target.checked); await load(); })}/>应用在前台时每 30 秒自动同步</label></div>}
    </>}
    {busy && status?.platform === 'android' && <button className="secondary" onClick={() => void api.syncCancel?.()}>取消本次同步</button>}
    {message && <p role="status">{message}</p>}{error && <p className="sync-error" role="alert">{error}</p>}
    {result && <div className="sync-details"><strong>{result.changed} 个作品更新 · {result.conflicts} 个冲突副本</strong><p>发送 {result.uploadedFiles} 个文件，接收 {result.downloadedFiles} 个文件。其余文件已复用。</p>{result.errors.map(e => <p className="sync-error" key={e.id}>{e.message}</p>)}</div>}
    <div className="modal-tip">原图和已有素材不会因同步删除。两端同时修改同一份描述或调色方案时，会保留“同步冲突副本”，可分别继续编辑。未保存的画笔与配色请先保存。同步过程中正在生成的作品会暂时跳过，稍后可重试。</div>
  </section></div>;
}
