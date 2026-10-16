package com.lumi.qcharacter.android;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;

final class RemoteService {
    private final File settingsFile,pinsFile;
    private final boolean syncService;
    private JSONObject settings,pins;
    private final Map<String,Session> sessions=new ConcurrentHashMap<>();
    private final Map<String,Inspection> inspections=new ConcurrentHashMap<>();
    private final X509TrustManager systemTrust;
    static class Session { String base,auth,origin; byte[] pin; volatile boolean revoked; Set<HttpURLConnection> connections=ConcurrentHashMap.newKeySet(); }
    static class Inspection { String origin,base; X509Certificate cert; long inspectedAt; }
    RemoteService(Context context) throws Exception {this(context,false);}
    RemoteService(Context context,boolean sync) throws Exception {
        syncService=sync;
        settingsFile=new File(context.getFilesDir(),sync?"sync-settings.json":"settings.json");pinsFile=new File(context.getFilesDir(),sync?"sync-tls-pins.json":"tls-pins.json");
        try{settings=ProjectStore.readJson(settingsFile);}catch(Exception e){settings=defaults();}try{pins=ProjectStore.readJson(pinsFile);}catch(Exception e){pins=new JSONObject();}
        TrustManagerFactory factory=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());factory.init((KeyStore)null);systemTrust=(X509TrustManager)factory.getTrustManagers()[0];
    }
    static JSONObject defaults() throws Exception { return new JSONObject().put("server","").put("comfyPath","").put("designCheckpoint","sdXL_v10VAEFix.safetensors").put("shapeCheckpoint","hunyuan_3d_v2.1.safetensors").put("imageEngine","qwen21").put("qwenModel","qwen_image_2.1_int8_convrot.safetensors").put("qwenEncoder","qwen3vl_8b_int8_convrot.safetensors").put("qwenVae","qwen_image_2.1_vae_bf16.safetensors").put("backgroundModel","birefnet.safetensors").put("shapeEngine","pixal3d").put("pixalModel","pixal3d_int8_convrot.safetensors").put("pixalMultiModel","pixal3d_multiview_int8_convrot.safetensors").put("pixalEncoder","dino_v3_L_naf_fp32.safetensors").put("pixalShapeVae","trellis_2_shape_vae_bf16.safetensors").put("pixalTextureVae","trellis_2_texture_vae_bf16.safetensors").put("visionModel","qwen3.6:35b-a3b").put("authType","none"); }
    static String normalize(String value) throws Exception {
        URI uri=new URI(value.trim());String scheme=uri.getScheme();
        if(!("http".equals(scheme)||"https".equals(scheme))||uri.getHost()==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||uri.getPort()==0||uri.getPort()>65535)throw new IOException("请输入完整 HTTP(S) 地址，可包含端口和反向代理路径。");
        String path=uri.getRawPath();if(path==null)path="";if(path.contains("%")||path.contains("\\")||!uri.normalize().getRawPath().equals(uri.getRawPath()))throw new IOException("服务路径不能包含转义或上级目录。");
        while(path.endsWith("/"))path=path.substring(0,path.length()-1);
        return scheme+"://"+uri.getRawAuthority()+path;
    }
    static String origin(String base) throws Exception {URI u=new URI(base);return u.getScheme()+"://"+u.getHost().toLowerCase(Locale.ROOT)+":"+(u.getPort()>0?u.getPort():u.getScheme().equals("https")?443:80);}
    static String fingerprint(X509Certificate cert) throws Exception {byte[] bytes=MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());StringBuilder s=new StringBuilder();for(byte b:bytes){if(s.length()>0)s.append(':');s.append(String.format(Locale.US,"%02X",b&255));}return s.toString();}
    synchronized JSONObject publicSettings() throws Exception {JSONObject result=new JSONObject(settings.toString());result.remove("credentialCipher");result.put("hasCredentials",settings.has("credentialCipher"));String server=settings.optString("server");if(!server.isEmpty()){String pin=pins.optString(origin(server));if(!pin.isEmpty()){X509Certificate c=(X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(Base64.decode(pin,Base64.NO_WRAP)));result.put("certificateFingerprint",fingerprint(c));}}return result;}
    private SecretKey key() throws Exception {KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="qcharacter-remote-credentials";if(ks.containsAlias(alias))return(SecretKey)ks.getKey(alias,null);KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();}
    private String encrypt(String value) throws Exception {Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());byte[] bytes=c.doFinal(value.getBytes(StandardCharsets.UTF_8)),iv=c.getIV();byte[] all=new byte[iv.length+bytes.length];System.arraycopy(iv,0,all,0,iv.length);System.arraycopy(bytes,0,all,iv.length,bytes.length);return Base64.encodeToString(all,Base64.NO_WRAP);}
    private String decrypt(String value) throws Exception {byte[] bytes=Base64.decode(value,Base64.NO_WRAP);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOf(bytes,12)));return new String(c.doFinal(Arrays.copyOfRange(bytes,12,bytes.length)),StandardCharsets.UTF_8);}
    synchronized JSONObject save(JSONObject next) throws Exception {
        String base=normalize(next.getString("server")),type=next.optString("authType","none");if(!Arrays.asList("none","bearer","basic").contains(type))throw new IOException("认证方式无效。");
        JSONObject clean=defaults();for(String field:new String[]{"visionModel","designCheckpoint","shapeCheckpoint","imageEngine","qwenModel","qwenEncoder","qwenVae","backgroundModel","shapeEngine","pixalModel","pixalMultiModel","pixalEncoder","pixalShapeVae","pixalTextureVae"})clean.put(field,next.optString(field,clean.getString(field)));
        clean.put("server",base).put("authType",type).put("authUsername",next.optString("authUsername"));
        String secret=type.equals("bearer")?next.optString("authToken"):next.optString("authPassword");
        if(!type.equals("none")){if(!secret.isEmpty()){String auth=type.equals("bearer")?"Bearer "+secret:"Basic "+Base64.encodeToString((next.optString("authUsername")+":"+secret).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP);if(auth.contains("\n")||auth.contains("\r"))throw new IOException("认证内容无效。");clean.put("credentialCipher",encrypt(auth));}
            else if(base.equals(settings.optString("server"))&&type.equals(settings.optString("authType"))&&next.optString("authUsername").equals(settings.optString("authUsername")))clean.put("credentialCipher",settings.optString("credentialCipher"));else throw new IOException("地址或认证方式变化后，请重新填写认证信息。");}
        ProjectStore.writeJson(settingsFile,clean);settings=clean;invalidate();return publicSettings();
    }
    synchronized String begin() throws Exception {Session s=new Session();s.base=normalize(settings.getString("server"));s.origin=origin(s.base);s.auth=settings.has("credentialCipher")?decrypt(settings.getString("credentialCipher")):"";String pin=pins.optString(s.origin);s.pin=pin.isEmpty()?null:Base64.decode(pin,Base64.NO_WRAP);String id=ProjectStore.id();sessions.put(id,s);return id;}
    Session get(String id) throws Exception {Session s=sessions.get(id);if(s==null||s.revoked)throw new IOException("连接授权已变化，请重新连接后找回任务。");return s;}
    void end(String id){Session s=sessions.remove(id);if(s!=null){s.revoked=true;for(HttpURLConnection c:s.connections)c.disconnect();}}
    private void invalidate(){for(String id:new ArrayList<>(sessions.keySet()))end(id);}
    synchronized void shutdown(){invalidate();}
    synchronized void clear()throws Exception{settings=defaults();ProjectStore.writeJson(settingsFile,settings);invalidate();}
    synchronized <T> T commit(String sid,Callable<T> operation) throws Exception {get(sid);return operation.call();}
    synchronized String describe(String receipt) throws Exception {Inspection i=inspections.get(receipt);if(i==null||System.currentTimeMillis()-i.inspectedAt>300000)throw new IOException("证书检查已过期，请重新检查。");return i.base+"\n"+i.cert.getSubjectX500Principal().getName()+"\n有效期："+i.cert.getNotBefore()+" 至 "+i.cert.getNotAfter()+"\nSHA256："+fingerprint(i.cert);}
    synchronized void revoke(String base) throws Exception {pins.remove(origin(normalize(base)));ProjectStore.writeJson(pinsFile,pins);invalidate();}
    synchronized void approve(String receipt) throws Exception {Inspection i=inspections.remove(receipt);if(i==null||System.currentTimeMillis()-i.inspectedAt>5*60*1000)throw new IOException("证书检查已过期，请重新检查。");i.cert.checkValidity();pins.put(i.origin,Base64.encodeToString(i.cert.getEncoded(),Base64.NO_WRAP));ProjectStore.writeJson(pinsFile,pins);invalidate();}
    JSONObject inspect(String value) throws Exception {
        String base=normalize(value);URI uri=new URI(base);if(!uri.getScheme().equals("https"))throw new IOException("HTTP 地址不使用 TLS 证书。");
        final X509Certificate[] observed=new X509Certificate[1];TrustManager capture=new X509TrustManager(){public void checkClientTrusted(X509Certificate[] c,String a) throws CertificateException {throw new CertificateException();}public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}public void checkServerTrusted(X509Certificate[] c,String a) throws CertificateException {if(c.length==0)throw new CertificateException();observed[0]=c[0];}};
        SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(null,new TrustManager[]{capture},null);boolean match;
        try(SSLSocket socket=(SSLSocket)ctx.getSocketFactory().createSocket()){socket.connect(new InetSocketAddress(uri.getHost(),uri.getPort()>0?uri.getPort():443),15000);socket.setSoTimeout(15000);SSLParameters params=socket.getSSLParameters();if(!uri.getHost().matches("[0-9.]+")&&!uri.getHost().contains(":"))params.setServerNames(Collections.singletonList(new SNIHostName(uri.getHost())));socket.setSSLParameters(params);socket.startHandshake();match=HttpsURLConnection.getDefaultHostnameVerifier().verify(uri.getHost(),socket.getSession());}
        X509Certificate cert=observed[0];if(cert==null)throw new IOException("未收到服务器证书。");cert.checkValidity();if(!match)throw new IOException("证书域名与地址不匹配，不能授权。");
        Inspection i=new Inspection();i.base=base;i.origin=origin(base);i.cert=cert;i.inspectedAt=System.currentTimeMillis();String receipt=ProjectStore.id();inspections.put(receipt,i);
        return new JSONObject().put("receipt",receipt).put("server",base).put("subject",cert.getSubjectX500Principal().getName()).put("issuer",cert.getIssuerX500Principal().getName()).put("fingerprint",fingerprint(cert)).put("validFrom",cert.getNotBefore().toString()).put("validTo",cert.getNotAfter().toString());
    }
    private SSLSocketFactory ssl(Session s) throws Exception {
        X509TrustManager trust=new X509TrustManager(){public X509Certificate[] getAcceptedIssuers(){return systemTrust.getAcceptedIssuers();}public void checkClientTrusted(X509Certificate[] c,String a)throws CertificateException{systemTrust.checkClientTrusted(c,a);}public void checkServerTrusted(X509Certificate[] chain,String auth)throws CertificateException{try{systemTrust.checkServerTrusted(chain,auth);}catch(CertificateException e){try{if(s.revoked||s.pin==null||chain.length==0||!Arrays.equals(chain[0].getEncoded(),s.pin))throw e;chain[0].checkValidity();}catch(Exception x){throw new CertificateException("证书未授权或已改变，请重新检查指纹。",x);}}}};
        SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(null,new TrustManager[]{trust},null);return ctx.getSocketFactory();
    }
    private synchronized HttpURLConnection open(String sid,String route,String method) throws Exception {
        boolean permitted=syncService?route.matches("/qsync/v1/(info|pair|projects|projects/[a-f0-9-]{36}/(manifest|missing|commit|files/[a-f0-9]{64}))"):route.matches("/(system_stats|object_info|prompt|queue|interrupt|history/[a-zA-Z0-9_-]+|upload/image|view(?:\\?.*)?)");
        if(!permitted)throw new IOException("不支持的服务接口。");
        Session s=get(sid);HttpURLConnection c=(HttpURLConnection)new URL(s.base+route).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");if(!s.auth.isEmpty())c.setRequestProperty("Authorization",s.auth);if(c instanceof HttpsURLConnection)((HttpsURLConnection)c).setSSLSocketFactory(ssl(s));s.connections.add(c);return c;
    }
    private InputStream response(HttpURLConnection c) throws Exception {int code=c.getResponseCode();if(code>=300&&code<400)throw new IOException("服务返回重定向，请填写直接访问 API 的地址；认证不会转发到其他地址。");if(code<200||code>=300)throw new IOException((syncService?"同步服务":"ComfyUI")+" 返回 HTTP "+code+"，请检查地址、配对状态，或重试同步。");return c.getInputStream();}
    private void close(String sid,HttpURLConnection c){Session s=sessions.get(sid);if(s!=null)s.connections.remove(c);c.disconnect();}
    JSONObject json(String sid,String route,JSONObject body) throws Exception {
        HttpURLConnection c=open(sid,route,body==null?"GET":"POST");try{if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] b=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){out.write(b);}}
            ByteArrayOutputStream out=new ByteArrayOutputStream();ProjectStore.copy(response(c),out);get(sid);String text=out.toString("UTF-8");if(!text.trim().startsWith("{"))throw new IOException("地址返回的不是 ComfyUI JSON，可能是穿透登录页。");return new JSONObject(text);
        }catch(SSLException e){throw new IOException("HTTPS 证书验证失败，请在设置中检查证书与指纹。",e);}finally{close(sid,c);}
    }
    JSONObject upload(String sid,File file) throws Exception {
        String boundary="QCharacter"+ProjectStore.id();HttpURLConnection c=open(sid,"/upload/image","POST");try{c.setDoOutput(true);c.setChunkedStreamingMode(65536);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
            try(OutputStream out=c.getOutputStream()){String first="--"+boundary+"\r\nContent-Disposition: form-data; name=\"image\"; filename=\"qcharacter-"+ProjectStore.id()+".png\"\r\nContent-Type: image/png\r\n\r\n";out.write(first.getBytes(StandardCharsets.UTF_8));try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){get(sid);out.write(b,0,n);}}out.write(("\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\nfalse\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));}
            ByteArrayOutputStream out=new ByteArrayOutputStream();ProjectStore.copy(response(c),out);get(sid);return new JSONObject(out.toString("UTF-8"));
        }finally{close(sid,c);}
    }
    void download(String sid,JSONObject output,File target) throws Exception {
        if(!output.optString("type").equals("output"))throw new IOException("只能下载任务正式输出。");
        String route="/view?filename="+URLEncoder.encode(output.getString("filename"),"UTF-8")+"&subfolder="+URLEncoder.encode(output.optString("subfolder"),"UTF-8")+"&type=output";HttpURLConnection c=open(sid,route,"GET");
        try{if(c.getContentLengthLong()>ProjectStore.LIMIT)throw new IOException("生成文件超过手机端 64 MB，请降低精度。");ProjectStore.copy(response(c),new FileOutputStream(target));get(sid);}finally{close(sid,c);}
    }
    void syncUpload(String sid,String route,File file) throws Exception {
        if(!syncService||file.length()<1||file.length()>ProjectStore.LIMIT)throw new IOException("同步素材大小无效。");
        HttpURLConnection c=open(sid,route,"PUT");try{c.setDoOutput(true);c.setRequestProperty("Content-Type","application/octet-stream");c.setFixedLengthStreamingMode(file.length());try(OutputStream out=c.getOutputStream();InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){get(sid);out.write(b,0,n);}}ProjectStore.copy(response(c),new ByteArrayOutputStream());get(sid);}finally{close(sid,c);}
    }
    void syncDownload(String sid,String route,File target) throws Exception {
        if(!syncService)throw new IOException("同步连接无效。");HttpURLConnection c=open(sid,route,"GET");
        try{if(c.getContentLengthLong()>ProjectStore.LIMIT)throw new IOException("同步素材超过 64 MiB。");ProjectStore.copy(response(c),new FileOutputStream(target));get(sid);}finally{close(sid,c);}
    }
}
