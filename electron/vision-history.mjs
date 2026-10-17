export function repairHistory(assets,views){
  const result={};
  for(const [role,id]of Object.entries(views)){
    const a=assets.find(a=>a.id===id);if(a?.revisionType!=='repair')continue;
    const before=assets.find(b=>b.id===a.parentCutoutId&&b.kind==='cutout'),mask=assets.find(b=>b.id===a.repairMaskId&&b.kind==='mask');
    if(!before||!mask||before.id===id)throw new Error('修正前图或选区缺失，无法进行修补痕迹复核。');
    result[role]={viewId:id,beforeId:before.id,maskId:mask.id};
  }
  return result;
}
