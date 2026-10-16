package com.lumi.qcharacter.android;

import android.content.Context;
import android.graphics.*;
import androidx.exifinterface.media.ExifInterface;
import android.net.Uri;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

final class ProjectStore {
    static final long LIMIT = 64L * 1024 * 1024;
    final File root;
    final Context context;
    ProjectStore(Context context) { this.context = context; root = new File(context.getFilesDir(), "projects"); root.mkdirs(); }
    static String id() { return UUID.randomUUID().toString(); }
    static String now() { SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US); f.setTimeZone(TimeZone.getTimeZone("UTC")); return f.format(new Date()); }
    static String uuid(String id) { if (id == null || !id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IllegalArgumentException("作品编号无效。"); return id; }
    static JSONObject readJson(File file) throws Exception { ByteArrayOutputStream bytes=new ByteArrayOutputStream();copy(new FileInputStream(file),bytes);return new JSONObject(bytes.toString("UTF-8")); }
    static void writeJson(File file, JSONObject value) throws Exception {
        file.getParentFile().mkdirs(); AtomicFile atomic = new AtomicFile(file); FileOutputStream out = null;
        try { out = atomic.startWrite(); out.write(value.toString(2).getBytes(StandardCharsets.UTF_8)); atomic.finishWrite(out); }
        catch (Exception e) { if (out != null) atomic.failWrite(out); throw e; }
    }
    synchronized JSONObject read(String id) throws Exception { return readJson(new File(new File(root, uuid(id)), "project.json")); }
    synchronized JSONArray list() throws Exception {
        List<JSONObject> projects = new ArrayList<>(); File[] dirs = root.listFiles();
        if (dirs != null) for (File dir : dirs) if (dir.isDirectory()) try { projects.add(read(dir.getName())); } catch (Exception ignored) { }
        projects.sort((a,b) -> b.optString("updatedAt").compareTo(a.optString("updatedAt"))); return new JSONArray(projects);
    }
    synchronized JSONObject create(String name) throws Exception {
        JSONObject p = new JSONObject().put("id", id()).put("name", name.trim().isEmpty()?"我的小角色":name.substring(0, Math.min(80,name.length()))).put("createdAt", now()).put("updatedAt", now()).put("description", "").put("ratio", "2.5").put("style", "clay").put("heightMm", 80).put("assets", new JSONArray()).put("jobs", new JSONArray());
        new File(new File(root, p.getString("id")), "assets").mkdirs(); save(p); return p;
    }
    private void save(JSONObject p) throws Exception { writeJson(new File(new File(root, uuid(p.getString("id"))), "project.json"), p); }
    synchronized JSONObject fields(String id, JSONObject fields) throws Exception {
        JSONObject p = read(id);
        for (String key : new String[]{"name","description","ratio","style","heightMm","clayGuide","workspace"}) if (fields.has(key)) p.put(key, fields.get(key));
        if(fields.has("multiView"))p.put("multiView",validateMultiView(fields.getJSONObject("multiView"),p.getJSONArray("assets")));
        p.put("updatedAt", now()); save(p); return p;
    }
    static JSONObject validateMultiView(JSONObject value, JSONArray assets) throws Exception {
        if(!(value.get("enabled") instanceof Boolean))throw new IOException("多视图配置无效。");
        double fov=value.optDouble("fov",20);if(!Double.isFinite(fov)||fov<1||fov>170)throw new IOException("多视图相机视角无效。");
        JSONObject views=value.getJSONObject("views"),clean=new JSONObject();Set<String> used=new HashSet<>();
        for(Iterator<String> it=views.keys();it.hasNext();){String role=it.next();if(!Arrays.asList("front","left","back","right").contains(role))throw new IOException("视图方向无效。");String aid=views.getString(role);if(aid.isEmpty())continue;JSONObject a=null;for(int i=0;i<assets.length();i++)if(assets.getJSONObject(i).getString("id").equals(aid))a=assets.getJSONObject(i);if(a==null||!Arrays.asList("reference","design","cutout").contains(a.getString("kind")))throw new IOException("视图缺少对应设计图或抠图。");if(!used.add(aid))throw new IOException("不同方向不能使用同一张图片。");clean.put(role,aid);}
        return new JSONObject().put("enabled",value.getBoolean("enabled")).put("fov",fov).put("views",clean);
    }
    synchronized JSONObject setView(String projectId,String role,String assetId,String expected) throws Exception {
        if(!Arrays.asList("front","left","back","right").contains(role))throw new IOException("视图方向无效。");
        JSONObject p=read(projectId),m=p.optJSONObject("multiView");if(m==null)m=new JSONObject().put("enabled",false).put("fov",20).put("views",new JSONObject());
        JSONObject views=m.getJSONObject("views");if(expected!=null&&!views.optString(role).equals(expected))return p;
        views.put(role,assetId);p.put("multiView",validateMultiView(m,p.getJSONArray("assets")));p.put("updatedAt",now());save(p);return p;
    }
    synchronized JSONObject job(String id, JSONObject job) throws Exception {
        JSONObject p = read(id); JSONArray jobs = p.getJSONArray("jobs"); int index = -1;
        for (int i=0;i<jobs.length();i++) if (jobs.getJSONObject(i).getString("id").equals(job.getString("id"))) index=i;
        if(index<0) jobs.put(job); else jobs.put(index,job); p.put("updatedAt",now()); save(p); return p;
    }
    JSONObject asset(JSONObject project, String id) throws Exception { JSONArray assets=project.getJSONArray("assets"); for(int i=0;i<assets.length();i++) if(assets.getJSONObject(i).getString("id").equals(id)) return assets.getJSONObject(i); throw new IOException("找不到对应素材。"); }
    File assetFile(String projectId, String assetId) throws Exception { JSONObject a=asset(read(projectId),assetId); return file(projectId,a.getString("filename")); }
    File file(String projectId,String filename) throws Exception {
        if(!filename.matches("[a-zA-Z0-9_.-]+") || filename.equals(".") || filename.equals("..")) throw new IOException("素材路径无效。");
        return new File(new File(new File(root,uuid(projectId)),"assets"),filename);
    }
    synchronized JSONObject add(String projectId, File input, String extension, String kind, String label, JSONObject metadata) throws Exception {
        if(!Arrays.asList(".png",".glb",".stl",".obj").contains(extension) || !Arrays.asList("reference","design","mask","cutout","prepared","model").contains(kind)) throw new IOException("素材类型无效。");
        if(input.length()>LIMIT) throw new IOException("手机端单个素材不能超过 64 MB，请降低生成精度。");
        if(extension.equals(".glb")) validateGlb(input, metadata.optString("textureMethod").startsWith("pixal3d-pbr"));
        JSONObject p=read(projectId), a=new JSONObject().put("id",id()).put("filename",id()+extension).put("kind",kind).put("label",label).put("createdAt",now());
        for(String key:new String[]{"sourceAssetId","maskAssetId","parentCutoutId","revisionType","parentModelId","textureSourceId","textureMethod","textureConfig","jobId","viewRole","inputViewIds","viewFov"}) if(metadata.has(key)) a.put(key,metadata.get(key));
        File target=file(projectId,a.getString("filename"));
        try { copy(new FileInputStream(input),new FileOutputStream(target)); p.getJSONArray("assets").put(a); p.put("updatedAt",now()); save(p); }
        catch(Exception e){target.delete();throw e;} return p;
    }
    synchronized JSONObject maskRevision(String projectId,String parentId,File mask,File cutout) throws Exception {
        JSONObject p=read(projectId), parent=asset(p,parentId); if(!parent.getString("kind").equals("cutout")) throw new IOException("请选择抠图版本。");
        String sourceId=parent.getString("sourceAssetId"); asset(p,sourceId);
        JSONObject metadata=new JSONObject().put("sourceAssetId",sourceId).put("parentCutoutId",parentId);
        JSONObject m=new JSONObject(metadata.toString()).put("id",id()).put("filename",id()+".png").put("kind","mask").put("label","手动修正前景蒙版").put("createdAt",now());
        JSONObject c=new JSONObject(metadata.toString()).put("id",id()).put("filename",id()+".png").put("kind","cutout").put("label","手动修正抠图").put("createdAt",now()).put("maskAssetId",m.getString("id")).put("revisionType","manual");
        File mf=file(projectId,m.getString("filename")),cf=file(projectId,c.getString("filename"));
        try{copy(new FileInputStream(mask),new FileOutputStream(mf));copy(new FileInputStream(cutout),new FileOutputStream(cf));p.getJSONArray("assets").put(m).put(c);if(p.has("multiView")){JSONObject v=p.getJSONObject("multiView").getJSONObject("views");for(String role:new String[]{"front","left","back","right"})if(v.optString(role).equals(parentId))v.put(role,c.getString("id"));}p.put("updatedAt",now());save(p);}catch(Exception e){mf.delete();cf.delete();throw e;} return p;
    }
    static void copy(InputStream input,OutputStream output) throws Exception { try(InputStream in=input;OutputStream out=output){byte[] b=new byte[65536];int n;long total=0;while((n=in.read(b))!=-1){total+=n;if(total>LIMIT)throw new IOException("文件超过手机端 64 MB 限制。");out.write(b,0,n);}} }
    void normalizeImage(Uri uri,File output) throws Exception {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        try(InputStream in=context.getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,options);}
        if(options.outWidth<=0||options.outHeight<=0)throw new IOException("无法读取图片。");
        options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>4096)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;Bitmap bitmap;try(InputStream in=context.getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(in,null,options);}
        if(bitmap==null)throw new IOException("图片解码失败。");
        try {
            int orientation=1;try(InputStream in=context.getContentResolver().openInputStream(uri)){orientation=new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION,1);}catch(Exception ignored){}
            Matrix matrix=new Matrix();switch(orientation){case 2:matrix.setScale(-1,1);break;case 3:matrix.setRotate(180);break;case 4:matrix.setScale(1,-1);break;case 5:matrix.setRotate(90);matrix.postScale(-1,1);break;case 6:matrix.setRotate(90);break;case 7:matrix.setRotate(270);matrix.postScale(-1,1);break;case 8:matrix.setRotate(270);break;}
            if(!matrix.isIdentity()){Bitmap rotated=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),matrix,true);if(rotated!=bitmap){bitmap.recycle();bitmap=rotated;}}
            double scale=Math.min(1,2048.0/Math.max(bitmap.getWidth(),bitmap.getHeight()));
            if(scale<1){Bitmap scaled=Bitmap.createScaledBitmap(bitmap,Math.max(1,(int)Math.round(bitmap.getWidth()*scale)),Math.max(1,(int)Math.round(bitmap.getHeight()*scale)),true);bitmap.recycle();bitmap=scaled;}
            try(OutputStream out=new FileOutputStream(output)){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("图片保存失败。");}
        }finally{bitmap.recycle();}
    }
    static void validateGlb(File file,boolean textured) throws Exception {
        try(RandomAccessFile in=new RandomAccessFile(file,"r")){
            byte[] head=new byte[20];in.readFully(head);ByteBuffer h=ByteBuffer.wrap(head).order(ByteOrder.LITTLE_ENDIAN);
            if(h.getInt()!=0x46546c67||h.getInt()!=2||Integer.toUnsignedLong(h.getInt())!=file.length())throw new IOException("GLB 文件不完整。");
            int len=h.getInt();if(len<2||len>8*1024*1024||h.getInt()!=0x4e4f534a||20L+len>file.length())throw new IOException("GLB 内容无效。");
            byte[] bytes=new byte[len];in.readFully(bytes);JSONObject json=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
            if(!json.getJSONObject("asset").getString("version").equals("2.0"))throw new IOException("仅支持 glTF 2.0 模型。");
            long binLength=0;while(in.getFilePointer()<in.length()){if(in.length()-in.getFilePointer()<8)throw new IOException("GLB 分块被截断。");byte[] ch=new byte[8];in.readFully(ch);ByteBuffer chunk=ByteBuffer.wrap(ch).order(ByteOrder.LITTLE_ENDIAN);long size=Integer.toUnsignedLong(chunk.getInt());int type=chunk.getInt();if(size%4!=0||size>in.length()-in.getFilePointer())throw new IOException("GLB 分块大小无效。");if(type==0x004e4942)binLength=size;in.seek(in.getFilePointer()+size);}
            for(String key:new String[]{"buffers","images"}){JSONArray arr=json.optJSONArray(key);if(arr!=null)for(int i=0;i<arr.length();i++){String uri=arr.getJSONObject(i).optString("uri");if(!uri.isEmpty()&&!uri.startsWith("data:"))throw new IOException("请导入内嵌贴图的 GLB，不能引用外部资源。");}}
            JSONArray buffers=json.getJSONArray("buffers"),views=json.optJSONArray("bufferViews");for(int i=0;i<buffers.length();i++){JSONObject b=buffers.getJSONObject(i);long declared=b.getLong("byteLength");if(declared<0||(!b.has("uri")&&declared>binLength))throw new IOException("GLB 几何或贴图数据被截断。");}
            if(views!=null)for(int i=0;i<views.length();i++){JSONObject v=views.getJSONObject(i);long start=v.optLong("byteOffset",0),size=v.getLong("byteLength");if(start<0||size<0||start+size>buffers.getJSONObject(v.getInt("buffer")).getLong("byteLength"))throw new IOException("GLB 数据范围无效。");}
            if(textured){JSONArray images=json.optJSONArray("images"),meshes=json.optJSONArray("meshes");if(images==null||images.length()==0||meshes==null)throw new IOException("模型没有内嵌颜色贴图。");for(int i=0;i<meshes.length();i++){JSONArray p=meshes.getJSONObject(i).getJSONArray("primitives");for(int j=0;j<p.length();j++){JSONObject primitive=p.getJSONObject(j);if(!primitive.getJSONObject("attributes").has("TEXCOORD_0"))throw new IOException("模型缺少 UV 坐标。");JSONObject material=json.getJSONArray("materials").getJSONObject(primitive.getInt("material"));int texture=material.getJSONObject("pbrMetallicRoughness").getJSONObject("baseColorTexture").getInt("index");JSONObject image=images.getJSONObject(json.getJSONArray("textures").getJSONObject(texture).getInt("source"));if(!image.has("uri"))views.getJSONObject(image.getInt("bufferView"));}}}
        }
    }
    synchronized void seed() throws Exception {
        if(list().length()>0)return;JSONObject p=create("示例 · 绿色围裙女孩");String pid=p.getString("id"),designId=null,maskId=null;
        for(String name:new String[]{"design.png","mask.png","cutout.png","model.glb"}){
            File temp=File.createTempFile("seed",".tmp",context.getCacheDir());copy(context.getAssets().open("www/examples/"+name),new FileOutputStream(temp));
            String kind=name.startsWith("design")?"design":name.startsWith("mask")?"mask":name.startsWith("cutout")?"cutout":"model";JSONObject meta=new JSONObject();if(designId!=null)meta.put("sourceAssetId",designId);if(kind.equals("cutout"))meta.put("maskAssetId",maskId);
            p=add(pid,temp,name.endsWith("glb")?".glb":".png",kind,"示例 · "+kind,meta);temp.delete();String aid=p.getJSONArray("assets").getJSONObject(p.getJSONArray("assets").length()-1).getString("id");if(kind.equals("design"))designId=aid;if(kind.equals("mask"))maskId=aid;
        }
    }
}
