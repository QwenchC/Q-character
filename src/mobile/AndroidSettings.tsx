import { useState } from 'react';
import type { Settings, ServerCertificate, StudioBridge } from '../types';

export function AndroidSettings({ value, onChange, api }: { value: Settings; onChange: (value: Settings) => void; api: StudioBridge }) {
  const [certificate, setCertificate] = useState<ServerCertificate | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } };
  return <div className="android-connection">
    <label>服务认证<select value={value.authType || 'none'} onChange={e => onChange({ ...value, authType: e.target.value as Settings['authType'], authToken: '', authPassword: '' })}><option value="none">无需认证</option><option value="bearer">Bearer Token</option><option value="basic">账号与密码（Basic）</option></select></label>
    {value.authType === 'basic' && <label>账号<input autoComplete="off" value={value.authUsername || ''} onChange={e => onChange({ ...value, authUsername: e.target.value })}/></label>}
    {value.authType && value.authType !== 'none' && <label>{value.authType === 'bearer' ? 'Token' : '密码'}<input type="password" autoComplete="new-password" placeholder={value.hasCredentials ? '留空保留该地址已保存的认证' : '填写访问凭据'} value={(value.authType === 'bearer' ? value.authToken : value.authPassword) || ''} onChange={e => onChange({ ...value, [value.authType === 'bearer' ? 'authToken' : 'authPassword']: e.target.value })}/><small>凭据加密保存在手机上。更换地址后需重新填写。</small></label>}
    {value.server.startsWith('http:') && <p className="certificate-note">当前使用 HTTP，图片和认证信息会经明文连接传输。可填写穿透服务提供的 HTTPS 地址。</p>}
    <details className="certificate-panel"><summary>HTTPS 证书与信任管理</summary><p>普通 HTTPS 自动校验。自签名证书需要先核对地址、有效期与 SHA256 指纹；授权仅限当前地址和这张证书。</p><button className="secondary" disabled={busy} onClick={() => void action(async () => { setCertificate(await api.inspectCertificate!(value.server)); })}>检查服务器证书</button>
      {certificate && certificate.server === value.server.replace(/\/+$/, '') && <div className="certificate-details"><strong>{certificate.server}</strong><p>{certificate.subject}</p><small>{certificate.validFrom} — {certificate.validTo}</small><code>{certificate.fingerprint}</code><button className="secondary" disabled={busy} onClick={() => void action(async () => { if (await api.trustCertificate!(certificate)) { onChange({ ...value, certificateFingerprint: certificate.fingerprint }); setMessage('已仅信任该地址的这张证书，可保存设置后连接。'); } })}>核对并授权证书</button></div>}
      {value.certificateFingerprint && <p className="certificate-details">已保存指纹：<code>{value.certificateFingerprint}</code></p>}
      <button className="secondary" disabled={busy} onClick={() => void action(async () => { await api.revokeCertificate!(value.server); onChange({ ...value, certificateFingerprint: undefined }); setCertificate(null); setMessage('已撤销该地址的证书授权，相关连接已关闭。'); })}>撤销此地址的证书授权</button>
      {message && <p role="status">{message}</p>}
    </details>
  </div>;
}
