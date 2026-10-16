package com.lumi.qcharacter.android;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.*;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private WebView web;
    private ProjectStore store;
    private RemoteService remote;
    private RemoteService syncRemote;
    private SyncStore syncStore;
    private final ExecutorService io=Executors.newSingleThreadExecutor(), network=Executors.newFixedThreadPool(3);
    private final Map<String,File> transfers=new ConcurrentHashMap<>();
    private Reply pickerReply;private JSONObject pickerArgs;private boolean importing;
    static final String ORIGIN="https://appassets.androidplatform.net";
    interface Reply {void send(Object result,Exception error);}
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
        io.execute(()->{try{store=new ProjectStore(this);remote=new RemoteService(this);syncRemote=new RemoteService(this,true);syncStore=new SyncStore(this,store);store.seed();runOnUiThread(this::showWeb);}catch(Exception e){runOnUiThread(()->new AlertDialog.Builder(this).setMessage("初始化失败："+e.getMessage()).setPositiveButton("关闭",(d,w)->finish()).show());}});
    }
    private void showWeb(){
        web=new WebView(this);android.widget.FrameLayout host=new android.widget.FrameLayout(this);host.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(host);getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);settings.setMediaPlaybackRequiresUserGesture(true);CookieManager.getInstance().setAcceptCookie(false);
        // Android 15 edge-to-edge: keep controls clear of system bars and the IME.
        host.setOnApplyWindowInsetsListener((view,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});host.requestApplyInsets();
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).addPathHandler("/projects/",new WebViewAssetLoader.InternalStoragePathHandler(this,store.root)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){WebResourceResponse r=loader.shouldInterceptRequest(request.getUrl());return r!=null?r:new WebResourceResponse("text/plain","utf-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.getUrl().toString().equals(ORIGIN+"/assets/www/index.html");}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();}
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){new AlertDialog.Builder(this).setMessage("请先更新 Android System WebView / Chrome 后使用本应用。").setPositiveButton("关闭",(d,w)->finish()).show();return;}
        WebViewCompat.addWebMessageListener(web,"QNative",Collections.singleton(ORIGIN),(view,message,source,mainFrame,reply)->{
            if(!mainFrame||!source.toString().equals(ORIGIN))return;
            try{JSONObject request=new JSONObject(message.getData());String id=request.getString("id"),method=request.getString("method");JSONObject args=request.optJSONObject("args");
                Reply callback=(result,error)->runOnUiThread(()->{try{JSONObject response=new JSONObject().put("id",id);if(error!=null)response.put("error",error.getMessage()==null?"操作失败，请重试。":error.getMessage());else response.put("result",result==null?JSONObject.NULL:result);reply.postMessage(response.toString());}catch(Exception ignored){}});
                ExecutorService executor=method.startsWith("remote")||method.startsWith("syncNet")||method.equals("inspectCertificate")?network:io;
                executor.execute(()->{try{Object result=dispatch(method,args==null?new JSONObject():args,callback);if(result!=PENDING)callback.send(result,null);}catch(Exception e){callback.send(null,e);}});
            }catch(Exception ignored){}
        });
        web.setWebChromeClient(new WebChromeClient());web.loadUrl(ORIGIN+"/assets/www/index.html");
    }
    private static final Object PENDING=new Object();
    private Object dispatch(String method,JSONObject a,Reply reply)throws Exception{
        switch(method){
            case "syncStatus":{JSONObject s=syncRemote.publicSettings();return new JSONObject().put("platform","android").put("server",s.optString("server")).put("paired",s.optBoolean("hasCredentials")).put("fingerprint",s.optString("certificateFingerprint")).put("auto",getSharedPreferences("sync-options",MODE_PRIVATE).getBoolean("auto",false));}
            case "syncAuto":getSharedPreferences("sync-options",MODE_PRIVATE).edit().putBoolean("auto",a.optBoolean("enabled")).apply();return true;
            case "syncForget":{String base=syncRemote.publicSettings().optString("server");if(!base.isEmpty())syncRemote.revoke(base);syncRemote.clear();return true;}
            case "syncNetPair":{String base=RemoteService.normalize(a.getString("server"));if(!base.startsWith("https://"))throw new IOException("作品同步请使用 HTTPS 地址。");syncRemote.save(new JSONObject().put("server",base).put("authType","none"));String sid=syncRemote.begin();try{JSONObject paired=syncRemote.json(sid,"/qsync/v1/pair",new JSONObject().put("code",a.getString("code")).put("name",android.os.Build.MODEL));if(paired.optInt("protocol")!=1||!paired.getString("token").matches("[a-zA-Z0-9_-]{43}"))throw new IOException("该地址不是 Q Character 同步服务。");ProjectStore.uuid(paired.getString("serverId"));syncRemote.save(new JSONObject().put("server",base).put("authType","bearer").put("authToken",paired.getString("token")));return true;}finally{syncRemote.end(sid);}}
            case "syncNetBegin":if(!syncRemote.publicSettings().optBoolean("hasCredentials"))throw new IOException("请先与电脑配对。");return syncRemote.begin();
            case "syncNetEnd":syncRemote.end(a.getString("session"));return true;
            case "syncCancel":syncRemote.shutdown();return true;
            case "syncNetJson":return syncRemote.json(a.getString("session"),a.getString("route"),a.optJSONObject("body"));
            case "syncSnapshot":return syncStore.snapshot(a.getString("id"));
            case "syncBaseGet":return syncStore.baseline(a.getString("serverId"),a.getString("id"));
            case "syncBasePut":return syncRemote.commit(a.getString("session"),()->{syncStore.baseline(a.getString("serverId"),a.getString("id"),a.getJSONObject("manifest"));return true;});
            case "syncHasFile":return syncStore.has(a.getString("id"),a.getJSONObject("file"));
            case "syncNetDownload":syncStore.download(syncRemote,a.getString("session"),a.getString("id"),a.getJSONObject("file"));return true;
            case "syncNetUpload":{JSONObject f=a.getJSONObject("file");File file=store.assetFile(a.getString("sourceId"),f.getString("assetId"));if(file.length()!=f.getLong("size")||!SyncStore.hash(file).equals(f.getString("sha256")))throw new IOException("手机素材已变化，请重新同步。");ProjectStore.uuid(a.getString("id"));if(!f.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("校验值无效。");syncRemote.syncUpload(a.getString("session"),"/qsync/v1/projects/"+a.getString("id")+"/files/"+f.getString("sha256"),file);return true;}
            case "syncCommit":return syncRemote.commit(a.getString("session"),()->syncStore.commit(a.getJSONObject("manifest"),a.isNull("expected")?null:a.getString("expected"),a.optString("sourceId")));
            case "bootstrap":return new JSONObject().put("settings",remote.publicSettings()).put("projects",store.list()).put("dataPath","手机应用私有存储 · 导出文件可通过系统文件选择器保存").put("version",BuildConfig.VERSION_NAME+" · Android").put("platform","android");
            case "settings":return remote.save(a.getJSONObject("value"));
            case "createProject":return store.create(a.optString("name","我的小角色"));
            case "saveProject":return store.fields(a.getString("id"),a.getJSONObject("fields"));
            case "saveJob":return store.job(a.getString("id"),a.getJSONObject("job"));
            case "beginTransfer":{String id=ProjectStore.id();File temp=File.createTempFile("transfer-",".tmp",getCacheDir());transfers.put(id,temp);return id;}
            case "appendTransfer":{File f=transfer(a.getString("id"));byte[] bytes=Base64.decode(a.getString("data"),Base64.NO_WRAP);if(bytes.length>262144||f.length()+bytes.length>ProjectStore.LIMIT)throw new IOException("文件超过手机端限制。");try(OutputStream out=new FileOutputStream(f,true)){out.write(bytes);}return true;}
            case "dropTransfer":{File f=transfers.remove(a.getString("id"));if(f!=null)f.delete();return true;}
            case "saveAsset":{File f=transfer(a.getString("transfer"));try{return store.add(a.getString("projectId"),f,a.optString("extension",".png"),a.getString("kind"),a.getString("label"),a.optJSONObject("metadata")==null?new JSONObject():a.getJSONObject("metadata"));}finally{transfers.remove(a.getString("transfer"));f.delete();}}
            case "saveMask":{File mask=transfer(a.getString("mask")),cutout=transfer(a.getString("cutout"));try{return store.maskRevision(a.getString("projectId"),a.getString("parentId"),mask,cutout);}finally{transfers.remove(a.getString("mask"));transfers.remove(a.getString("cutout"));mask.delete();cutout.delete();}}
            case "saveTexture":{File f=transfer(a.getString("transfer"));try{String pid=a.getString("projectId");JSONObject p=store.read(pid);if(!store.asset(p,a.getString("parentId")).getString("kind").equals("model")||!store.asset(p,a.getString("referenceId")).getString("kind").equals("cutout"))throw new IOException("请选择模型和透明参考图。");ProjectStore.validateGlb(f,true);JSONObject meta=new JSONObject().put("parentModelId",a.getString("parentId")).put("sourceAssetId",a.getString("referenceId")).put("textureSourceId",a.getString("referenceId")).put("textureMethod","reference-projection").put("textureConfig",a.getJSONObject("config"));return store.add(pid,f,".glb","model","彩色模型 · 设计图贴图",meta);}finally{transfers.remove(a.getString("transfer"));f.delete();}}
            case "importAsset":{store.read(a.getString("projectId"));runOnUiThread(()->openPicker(true,a,reply));return PENDING;}
            case "exportTransfer":{transfer(a.getString("transfer"));runOnUiThread(()->openPicker(false,a,reply));return PENDING;}
            case "exportAsset":{File source=store.assetFile(a.getString("projectId"),a.getString("assetId"));String id=ProjectStore.id();File temp=File.createTempFile("export-",".tmp",getCacheDir());ProjectStore.copy(new FileInputStream(source),new FileOutputStream(temp));transfers.put(id,temp);a.put("transfer",id).put("name",store.read(a.getString("projectId")).optString("name")+source.getName().substring(source.getName().lastIndexOf('.')));runOnUiThread(()->openPicker(false,a,reply));return PENDING;}
            case "openComfy":{String base=remote.publicSettings().getString("server");RemoteService.normalize(base);runOnUiThread(()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(base))));return true;}
            case "beginRemote":return remote.begin();
            case "endRemote":remote.end(a.getString("session"));return true;
            case "remoteJson":return remote.json(a.getString("session"),a.getString("route"),a.optJSONObject("body"));
            case "remoteUpload":return remote.upload(a.getString("session"),store.assetFile(a.getString("projectId"),a.getString("assetId")));
            case "remoteDownload":{String sid=a.getString("session");File temp=File.createTempFile("download-",".tmp",getCacheDir());try{JSONObject output=a.getJSONObject("output");remote.download(sid,output,temp);String ext=output.getString("filename").toLowerCase(Locale.ROOT).endsWith(".glb")?".glb":".png";return remote.commit(sid,()->store.add(a.getString("projectId"),temp,ext,a.getString("kind"),a.getString("label"),a.getJSONObject("metadata")));}finally{temp.delete();}}
            case "inspectCertificate":return (a.optString("scope").equals("sync")?syncRemote:remote).inspect(a.getString("server"));
            case "trustCertificate":{RemoteService target=a.optString("scope").equals("sync")?syncRemote:remote;String description=target.describe(a.getString("receipt"));runOnUiThread(()->new AlertDialog.Builder(this).setTitle("仅授权这张服务器证书").setMessage(description+"\n\n授权仅保存在本机，证书变化时需要重新检查。请核对指纹与服务提供者一致。").setNegativeButton("取消",(d,w)->reply.send(false,null)).setPositiveButton("信任此证书",(d,w)->io.execute(()->{try{target.approve(a.getString("receipt"));reply.send(true,null);}catch(Exception e){reply.send(null,e);}})).setOnCancelListener(d->reply.send(false,null)).show());return PENDING;}
            case "revokeCertificate":(a.optString("scope").equals("sync")?syncRemote:remote).revoke(a.getString("server"));return true;
            default:throw new IOException("不支持的手机端操作。");
        }
    }
    private File transfer(String id)throws Exception{File f=transfers.get(id);if(f==null)throw new IOException("文件传输已失效，请重试。");return f;}
    private void openPicker(boolean importing,JSONObject args,Reply reply){if(pickerReply!=null){reply.send(null,new IOException("请先完成当前文件选择。"));return;}this.importing=importing;pickerArgs=args;pickerReply=reply;
        Intent intent=new Intent(importing?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        if(importing)intent.setType(args.optString("kind").equals("model")?"*/*":"image/*");else{String name=args.optString("name","角色文件.png").replaceAll("[\\\\/:*?\"<>|]","_");intent.setType(name.endsWith(".png")?"image/png":name.endsWith(".glb")?"model/gltf-binary":"application/octet-stream");intent.putExtra(Intent.EXTRA_TITLE,name);}
        try{startActivityForResult(intent,11);}catch(Exception e){pickerReply=null;reply.send(null,e);}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=11||pickerReply==null)return;Reply reply=pickerReply;JSONObject args=pickerArgs;boolean isImport=importing;pickerReply=null;
        io.execute(()->{File temp=null;try{if(result!=RESULT_OK||data==null||data.getData()==null){if(!isImport){File f=transfers.remove(args.optString("transfer"));if(f!=null)f.delete();}reply.send(isImport?null:false,null);return;}Uri uri=data.getData();
            if(isImport){String name="参考图片.png";try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}String extension=".png";temp=File.createTempFile("import-",".tmp",getCacheDir());boolean model=args.optString("kind").equals("model");if(model){int dot=name.lastIndexOf('.');extension=dot<0?"":name.substring(dot).toLowerCase(Locale.ROOT);if(!Arrays.asList(".glb",".stl",".obj").contains(extension))throw new IOException("请选择 GLB、STL 或 OBJ 模型。");ProjectStore.copy(getContentResolver().openInputStream(uri),new FileOutputStream(temp));}else store.normalizeImage(uri,temp);reply.send(store.add(args.getString("projectId"),temp,extension,model?"model":"reference",name,new JSONObject()),null);
            }else{temp=transfer(args.getString("transfer"));ProjectStore.copy(new FileInputStream(temp),getContentResolver().openOutputStream(uri,"w"));transfers.remove(args.getString("transfer"));reply.send(true,null);}
        }catch(Exception e){reply.send(null,e);}finally{if(temp!=null)temp.delete();}});
    }
    private void handleBack(){if(web==null){finish();return;}web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.dispatchEvent(new Event('cancel',{cancelable:true}));return true;}if(document.querySelector('.modal-backdrop')){window.dispatchEvent(new Event('qcharacter-back'));return true;}return false;})()",value->{if(!"true".equals(value))finish();});}
    @android.annotation.SuppressLint("GestureBackNavigation") // Legacy devices only; API 33+ uses OnBackInvokedDispatcher above.
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onDestroy(){if(remote!=null)remote.shutdown();if(syncRemote!=null)syncRemote.shutdown();if(web!=null){if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))WebViewCompat.removeWebMessageListener(web,"QNative");web.destroy();}io.shutdown();network.shutdown();super.onDestroy();}
}
