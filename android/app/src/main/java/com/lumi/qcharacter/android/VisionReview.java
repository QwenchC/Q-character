package com.lumi.qcharacter.android;

import org.json.*;
import java.io.IOException;
import java.util.*;

/** Validate imported reports as data, never as instructions or automatic edit approval. */
final class VisionReview {
    private static void require(boolean condition) throws IOException {if(!condition)throw new IOException("视觉检查记录无效，请重新检测。");}
    private static String text(JSONObject o,String key,int max) throws Exception {Object v=o.get(key);require(v instanceof String&&!((String)v).trim().isEmpty()&&((String)v).length()<=max);return(String)v;}
    private static void number(JSONObject o,String key,double min,double max) throws Exception {Object v=o.get(key);require(v instanceof Number);double d=((Number)v).doubleValue();require(Double.isFinite(d)&&d>=min&&d<=max);}
    private static void count(JSONObject o,String key) throws Exception {if(o.get(key)==JSONObject.NULL)return;number(o,key,0,32);require(o.getDouble(key)==Math.floor(o.getDouble(key)));}
    private static void box(Object value) throws Exception {require(value instanceof JSONArray);JSONArray a=(JSONArray)value;require(a.length()==4);for(int i=0;i<4;i++){Object v=a.get(i);require(v instanceof Number);double d=((Number)v).doubleValue();require(Double.isFinite(d)&&d>=0&&d<=1000);}require(a.getDouble(0)<a.getDouble(2)&&a.getDouble(1)<a.getDouble(3));}
    private static String choice(JSONObject o,String key,String... values) throws Exception {String v=text(o,key,40);require(Arrays.asList(values).contains(v));return v;}
    private static boolean sameBox(Object a,Object b) throws Exception {if(a==JSONObject.NULL||b==JSONObject.NULL)return a==b;JSONArray x=(JSONArray)a,y=(JSONArray)b;for(int i=0;i<4;i++)if(x.getDouble(i)!=y.getDouble(i))return false;return true;}
    private static void analysis(JSONObject value,JSONArray findings,JSONObject views) throws Exception {
        require(value.getString("policy").equals("visibility-v2"));number(value,"candidateCount",0,6);int count=value.getInt("candidateCount");require(value.getDouble("candidateCount")==count);number(value,"overviewMs",0,3600000);number(value,"verificationMs",0,3600000);
        JSONArray checks=value.getJSONArray("checks");require(checks.length()<=12);Set<Integer> seen=new HashSet<>();int findingIndex=0;
        for(int i=0;i<checks.length();i++){
            JSONObject c=checks.getJSONObject(i);number(c,"candidate_index",-1,count-1);int index=c.getInt("candidate_index");require(c.getDouble("candidate_index")==index);if(index>=0)require(seen.add(index));
            String role=c.getString("role");require(!role.equals("front")&&views.has(role));choice(c,"part","hair","clothes","accessories");String kind=choice(c,"kind","structure","count");
            String verdict=choice(c,"verdict","structural","perspective","occluded","uncertain"),model=choice(c,"model_verdict","structural","perspective","occluded","uncertain");
            String rv=choice(c,"reference_visibility","clear","partial","hidden","unknown"),tv=choice(c,"target_visibility","clear","partial","hidden","unknown"),co=choice(c,"correspondence","same_component","different_surface","unknown"),basis=choice(c,"basis","component_type","connection","count","outline","surface_detail"),alt=choice(c,"alternative","none","perspective","occlusion","different_surface","unknown"),unit=choice(c,"count_unit","per_component","whole_character","unknown");
            text(c,"title",120);for(String key:new String[]{"reason","reference_evidence","target_evidence","suggestion"})text(c,key,1000);number(c,"confidence",0,1);count(c,"reference_count");count(c,"target_count");box(c.get("bbox"));if(!c.isNull("reference_bbox"))box(c.get("reference_bbox"));JSONArray gates=c.getJSONArray("gates");require(gates.length()<=7);for(int g=0;g<gates.length();g++)require(gates.get(g) instanceof String&&!gates.getString(g).trim().isEmpty()&&gates.getString(g).length()<=120);
            if(!verdict.equals(model))require(verdict.equals("uncertain")&&model.equals("structural")&&gates.length()>0);
            if(verdict.equals("structural")){
                require(model.equals("structural")&&gates.length()==0&&rv.equals("clear")&&tv.equals("clear")&&co.equals("same_component")&&alt.equals("none")&&!basis.equals("outline")&&!c.isNull("reference_bbox"));
                require(kind.equals("count")?basis.equals("count")&&unit.equals("per_component")&&!c.isNull("reference_count")&&!c.isNull("target_count")&&c.getInt("reference_count")!=c.getInt("target_count"):!basis.equals("count"));
                require(findingIndex<findings.length());JSONObject f=findings.getJSONObject(findingIndex++);number(f,"assessmentIndex",0,11);require(f.getDouble("assessmentIndex")==i);for(String key:new String[]{"role","part","kind"})require(f.getString(key).equals(c.getString(key)));for(String key:new String[]{"reference_count","target_count"})require(f.isNull(key)==c.isNull(key)&&(f.isNull(key)||f.getInt(key)==c.getInt(key)));require(sameBox(f.get("bbox"),c.get("bbox"))&&sameBox(f.get("reference_bbox"),c.get("reference_bbox")));
            }
        }
        require(seen.size()==count&&findingIndex==findings.length());
    }
    static JSONObject validate(JSONObject r,JSONArray assets) throws Exception {
        require(r.getInt("version")==1||r.getInt("version")==2);String id=ProjectStore.uuid(r.getString("id"));text(r,"model",200);text(r,"summary",2000);String date=text(r,"createdAt",80);require(date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z"));number(r,"elapsedMs",0,3600000);require(r.get("confirmed") instanceof Boolean);
        JSONObject views=ProjectStore.validateMultiView(new JSONObject().put("enabled",true).put("fov",20).put("views",r.getJSONObject("views")),assets).getJSONObject("views");
        require(views.has("front")&&views.has("back")&&(views.has("left")||views.has("right")));
        for(Iterator<String> it=views.keys();it.hasNext();){String aid=views.getString(it.next());boolean cutout=false;for(int i=0;i<assets.length();i++)if(assets.getJSONObject(i).getString("id").equals(aid))cutout=assets.getJSONObject(i).getString("kind").equals("cutout");require(cutout);}
        JSONArray obs=r.getJSONArray("observations"),findings=r.getJSONArray("findings"),uncertain=r.getJSONArray("uncertainties");require(obs.length()>0&&obs.length()<=64&&findings.length()<=24&&uncertain.length()<=16);
        Set<String> coverage=new HashSet<>(),ids=new HashSet<>();List<String> parts=Arrays.asList("hair","clothes","accessories");
        for(int i=0;i<obs.length();i++){JSONObject o=obs.getJSONObject(i);String role=o.getString("role"),part=o.getString("part");require(views.has(role)&&parts.contains(part));text(o,"name",120);text(o,"description",1000);count(o,"visible_count");coverage.add(role+":"+part);}
        for(Iterator<String> it=views.keys();it.hasNext();){String role=it.next();for(String part:parts)require(coverage.contains(role+":"+part));}
        for(int i=0;i<findings.length();i++){JSONObject f=findings.getJSONObject(i);String role=f.getString("role"),fid=f.getString("id"),decision=f.getString("decision");require(!role.equals("front")&&views.has(role)&&parts.contains(f.getString("part"))&&Arrays.asList("structure","count").contains(f.getString("kind")));text(f,"title",120);text(f,"evidence",1000);text(f,"suggestion",2000);number(f,"confidence",0,1);count(f,"reference_count");count(f,"target_count");box(f.get("bbox"));if(f.get("reference_bbox")!=JSONObject.NULL)box(f.get("reference_bbox"));require(fid.startsWith(id+":")&&fid.length()<=80&&ids.add(fid)&&Arrays.asList("pending","accepted","dismissed").contains(decision));require(f.get("note") instanceof String&&f.getString("note").length()<=1000);require(!decision.equals("dismissed")||!f.getString("note").trim().isEmpty());require(!r.getBoolean("confirmed")||decision.equals("dismissed"));}
        for(int i=0;i<uncertain.length();i++)require(uncertain.get(i) instanceof String&&!uncertain.getString(i).trim().isEmpty()&&uncertain.getString(i).length()<=1000);
        if(r.getInt("version")==2)analysis(r.getJSONObject("analysis"),findings,views);else require(!r.has("analysis"));
        return new JSONObject(r.toString());
    }
    static void linked(JSONObject r,JSONArray jobs) throws Exception {boolean found=false;for(int i=0;i<jobs.length();i++){JSONObject j=jobs.getJSONObject(i);if(j.getString("id").equals(r.getString("id"))&&j.optString("kind").equals("review"))found=true;}require(found);}
}
