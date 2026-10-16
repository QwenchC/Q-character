import type { MultiView, ViewRole } from './multiview.mjs';
export type ReviewPart='hair'|'clothes'|'accessories';
export interface ReviewRow {role:ViewRole;part:ReviewPart;status:'pending'|'consistent'|'occluded'|'repair';note:string;distance:number|null;colors:string[]}
export interface ConsistencyReport {version:1;createdAt:string;views:MultiView['views'];rows:ReviewRow[]}
export const REVIEW_PARTS:ReviewPart[];
export const PART_LABELS:Record<ReviewPart,string>;
interface Pixels {width:number;height:number;data:Uint8Array|Uint8ClampedArray}
export function analyzeConsistency(project:any,images:Record<string,Pixels>,now?:string):ConsistencyReport;
export function normalizeConsistency(value:unknown,assets:any[]):ConsistencyReport;
export function consistencyState(project:any):'unchecked'|'stale'|'confirmed'|'pending';
export function assertConsistencyReady(project:any):void;
export function validateRepairMask(source:Pixels,mask:Pixels):number;
export function compositeRepair(source:Pixels,generated:Pixels,mask:Pixels):{width:number;height:number;data:Uint8ClampedArray};
export function repairPrompt(role:ViewRole,instruction:string):string;
