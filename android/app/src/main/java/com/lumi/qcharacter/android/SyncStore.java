package com.lumi.qcharacter.android;

import android.content.Context;
import android.graphics.BitmapFactory;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;

final class SyncStore {
    private final ProjectStore store;
    private final File cache,baselines;
    SyncStore(Context context,ProjectStore store){this.store=store;cache=new File(context.getCacheDir(),"sync-files");baselines=new File(context.getFilesDir(),"sync-baselines");cache.mkdirs();baselines.mkdirs();}
    static String hash(File file)throws Exception{MessageDigest h=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)h.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:h.digest())s.append(String.format(Locale.US,"%02x",b&255));return s.toString();}
    File blob(String hash)throws Exception{if(!hash.matches("[a-f0-9]{64}"))throw new IOException("素材校验值无效。");return new File(cache,hash+".blob");}
    boolean has(String projectId,JSONObject f)throws Exception{
        try{JSONObject p=store.read(projectId);File file=store.assetFile(projectId,f.getString("assetId"));if(file.length()==f.getLong("size")&&hash(file).equals(f.getString("sha256")))return true;}catch(Exception ignored){}
        File file=blob(f.getString("sha256"));return file.isFile()&&file.length()==f.getLong("size")&&hash(file).equals(f.getString("sha256"));
    }
    JSONObject snapshot(String id)throws Exception{synchronized(store){ProjectStore.uuid(id);File metadata=new File(new File(store.root,id),"project.json");if(!metadata.exists())return null;JSONObject p=store.read(id);JSONArray files=new JSONArray();for(int i=0;i<p.getJSONArray("assets").length();i++){JSONObject a=p.getJSONArray("assets").getJSONObject(i);File file=store.assetFile(id,a.getString("id"));files.put(new JSONObject().put("assetId",a.getString("id")).put("filename",a.getString("filename")).put("size",file.length()).put("sha256",hash(file)));}return new JSONObject().put("protocol",1).put("project",p).put("files",files).put("stamp",hash(metadata));}}
    JSONObject baseline(String serverId,String projectId)throws Exception{File f=baselineFile(serverId,projectId);return f.exists()?ProjectStore.readJson(f):null;}
    void baseline(String serverId,String projectId,JSONObject manifest)throws Exception{validate(manifest);ProjectStore.writeJson(baselineFile(serverId,projectId),manifest);}
    private File baselineFile(String serverId,String projectId){return new File(new File(baselines,ProjectStore.uuid(serverId)),ProjectStore.uuid(projectId)+".json");}
    void download(RemoteService remote,String sid,String projectId,JSONObject f)throws Exception{
        ProjectStore.uuid(projectId);File target=blob(f.getString("sha256"));if(has(projectId,f))return;
        long occupied=0;File[] existing=cache.listFiles();if(existing!=null)for(File item:existing)if(item.isFile()){if(System.currentTimeMillis()-item.lastModified()>7L*86400000)item.delete();else occupied+=item.length();}
        if(occupied+f.getLong("size")>1024L*1024*1024)throw new IOException("手机同步暂存空间已满，请清理应用缓存后重试。");
        File temp=File.createTempFile("receive-",".tmp",cache);try{remote.syncDownload(sid,"/qsync/v1/projects/"+projectId+"/files/"+f.getString("sha256"),temp);if(temp.length()!=f.getLong("size")||!hash(temp).equals(f.getString("sha256")))throw new IOException("同步文件校验失败，原作品已保留。");remote.commit(sid,()->{Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);return true;});}finally{temp.delete();}
    }
    JSONObject commit(JSONObject manifest,String expected,String sourceProjectId)throws Exception{synchronized(store){
        validate(manifest);JSONObject p=manifest.getJSONObject("project");String id=p.getString("id");File metadata=new File(new File(store.root,id),"project.json");
        String current=metadata.exists()?hash(metadata):null;if(!Objects.equals(current,expected))throw new IOException("手机作品已在传输期间更新，请重试同步；现有内容已保留。");
        JSONObject old=metadata.exists()?store.read(id):null;Map<String,JSONObject> files=new HashMap<>();JSONArray entries=manifest.getJSONArray("files");for(int i=0;i<entries.length();i++)files.put(entries.getJSONObject(i).getString("assetId"),entries.getJSONObject(i));
        Set<String> oldIds=new HashSet<>();if(old!=null)for(int i=0;i<old.getJSONArray("assets").length();i++){JSONObject a=old.getJSONArray("assets").getJSONObject(i),f=files.get(a.getString("id"));JSONObject next=store.asset(p,a.getString("id"));if(f==null||!a.getString("filename").equals(next.getString("filename"))||!same(a,next)||!hash(store.assetFile(id,a.getString("id"))).equals(f.getString("sha256")))throw new IOException("同步不能删除或替换已有素材。");oldIds.add(a.getString("id"));}
        boolean fresh=old==null;File directory=new File(store.root,id),stage=fresh?new File(store.root,".sync-"+id+"-"+ProjectStore.id()):directory;
        List<File> created=new ArrayList<>();try{new File(stage,"assets").mkdirs();JSONArray assets=p.getJSONArray("assets");for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(oldIds.contains(a.getString("id")))continue;JSONObject f=files.get(a.getString("id"));File source=blob(f.getString("sha256"));
            if(!source.isFile()||source.length()!=f.getLong("size")||!hash(source).equals(f.getString("sha256"))){source=null;for(String candidate:new String[]{id,sourceProjectId}){if(candidate==null||candidate.isEmpty())continue;try{File possible=store.assetFile(candidate,a.getString("id"));if(possible.length()==f.getLong("size")&&hash(possible).equals(f.getString("sha256"))){source=possible;break;}}catch(Exception ignored){}}}
            if(source==null)throw new IOException("同步素材未接收完整，请重试。");validateFile(a,source);File target=new File(new File(stage,"assets"),a.getString("filename"));if(target.exists())throw new IOException("同步文件名冲突，原素材已保留。");ProjectStore.copy(new FileInputStream(source),new FileOutputStream(target));created.add(target);
        }
        p.put("updatedAt",ProjectStore.now());if(fresh){ProjectStore.writeJson(new File(stage,"project.json"),p);Files.move(stage.toPath(),directory.toPath());}else ProjectStore.writeJson(metadata,p);return p;
        }catch(Exception e){for(File file:created)file.delete();if(fresh){new File(stage,"project.json").delete();new File(stage,"assets").delete();stage.delete();}throw e;}
    }}
    private static boolean same(Object a,Object b)throws Exception{
        if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String> keys=x.keys();while(keys.hasNext()){String k=keys.next();if(!y.has(k)||!same(x.get(k),y.get(k)))return false;}return true;}
        if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!same(x.get(i),y.get(i)))return false;return true;}return Objects.equals(String.valueOf(a),String.valueOf(b));
    }
    private static void validateFile(JSONObject a,File file)throws Exception{
        String name=a.getString("filename").toLowerCase(Locale.ROOT);if(file.length()>ProjectStore.LIMIT)throw new IOException("同步文件超过 64 MiB。");
        if(name.endsWith(".glb"))ProjectStore.validateGlb(file,a.has("textureMethod"));
        if(name.matches(".*\\.(png|jpe?g|webp)$")){BitmapFactory.Options o=new BitmapFactory.Options();o.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getAbsolutePath(),o);if(o.outWidth<=0||o.outHeight<=0||(long)o.outWidth*o.outHeight>16000000)throw new IOException("同步图片无效或超过 1600 万像素。");}
    }
    static void validate(JSONObject m)throws Exception{
        if(m.getInt("protocol")!=1||m.toString().length()>4*1024*1024)throw new IOException("作品同步格式无效。");JSONObject p=m.getJSONObject("project");ProjectStore.uuid(p.getString("id"));
        if(p.getString("name").length()>100||p.getString("description").length()>6000||!Arrays.asList("2","2.5","3").contains(p.getString("ratio"))||!Arrays.asList("clay","anime").contains(p.getString("style"))||p.getDouble("heightMm")<10||p.getDouble("heightMm")>500)throw new IOException("作品信息无效。");
        JSONArray assets=p.getJSONArray("assets"),files=m.getJSONArray("files"),jobs=p.getJSONArray("jobs");if(assets.length()>2000||files.length()!=assets.length()||jobs.length()>2000)throw new IOException("作品素材数量无效。");
        Set<String> ids=new HashSet<>(),names=new HashSet<>(),fileIds=new HashSet<>();long total=0;Map<String,JSONObject> byId=new HashMap<>();
        for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);String id=ProjectStore.uuid(a.getString("id")),name=a.getString("filename");if(!ids.add(id)||!names.add(name)||!name.matches("[a-zA-Z0-9_-]+\\.(?i:png|jpe?g|webp|glb|stl|obj)")||!Arrays.asList("reference","design","mask","cutout","prepared","model").contains(a.getString("kind")))throw new IOException("素材编号或文件名无效。");byId.put(id,a);}
        for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i),a=byId.get(f.getString("assetId"));long size=f.getLong("size");if(a==null||!fileIds.add(f.getString("assetId"))||!a.getString("filename").equals(f.getString("filename"))||!f.getString("sha256").matches("[a-f0-9]{64}")||size<1||size>ProjectStore.LIMIT)throw new IOException("素材校验信息无效。");total+=size;}
        if(total>512L*1024*1024)throw new IOException("单个同步作品超过 512 MiB。");
        for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);for(String key:new String[]{"sourceAssetId","maskAssetId","parentCutoutId","parentModelId","textureSourceId","repairMaskId"})if(a.has(key)&&!byId.containsKey(a.getString(key)))throw new IOException("作品缺少原图、蒙版或模型版本。");}
        if(p.has("consistency"))ProjectStore.validateConsistency(p.getJSONObject("consistency"),assets);
        if(p.has("multiView"))ProjectStore.validateMultiView(p.getJSONObject("multiView"),assets);
        for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(a.has("inputViewIds"))ProjectStore.validateMultiView(new JSONObject().put("enabled",true).put("fov",a.optDouble("viewFov",20)).put("views",a.getJSONObject("inputViewIds")),assets);}
        if(p.has("clayGuide")){JSONObject g=p.getJSONObject("clayGuide");if(g.has("grams")&&(!Double.isFinite(g.getDouble("grams"))||g.getDouble("grams")<0.5||g.getDouble("grams")>50))throw new IOException("试配量必须为 0.5–50 克。");if(!byId.containsKey(g.getString("referenceId"))||!byId.get(g.getString("referenceId")).getString("kind").equals("cutout"))throw new IOException("调色方案缺少参考图。");JSONArray bases=g.getJSONArray("bases"),swatches=g.getJSONArray("swatches");if(bases.length()!=6||swatches.length()<1||swatches.length()>12)throw new IOException("调色方案无效。");for(int i=0;i<bases.length();i++)if(!bases.getJSONObject(i).getString("hex").matches("#[a-fA-F0-9]{6}"))throw new IOException("基础黏土颜色无效。");for(int i=0;i<swatches.length();i++)for(String k:new String[]{"original","target"})if(!swatches.getJSONObject(i).getString(k).matches("#[a-fA-F0-9]{6}"))throw new IOException("目标颜色无效。");}
        for(int i=0;i<jobs.length();i++){JSONObject j=jobs.getJSONObject(i);ProjectStore.uuid(j.getString("id"));if(!j.getString("projectId").equals(p.getString("id")))throw new IOException("任务所属作品无效。");}
    }
}
