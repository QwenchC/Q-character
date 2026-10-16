import type { ViewRole, MultiView } from './multiview.mjs';
export type VisionBox=[number,number,number,number];
export interface Observation {role:ViewRole;part:'hair'|'clothes'|'accessories';name:string;visible_count:number|null;description:string}
export interface VisionFinding {assessmentIndex?:number;id:string;role:ViewRole;part:Observation['part'];kind:'structure'|'count';title:string;evidence:string;suggestion:string;confidence:number;reference_count:number|null;target_count:number|null;bbox:VisionBox;reference_bbox:VisionBox|null;decision:'pending'|'accepted'|'dismissed';note:string}
export interface VisionReview {version:1|2;analysis?:VisionAnalysis;id:string;createdAt:string;model:string;elapsedMs:number;views:MultiView['views'];confirmed:boolean;summary:string;observations:Observation[];findings:VisionFinding[];uncertainties:string[]}
export const DEFAULT_VISION_MODEL:string;
export function normalizeBox(value:unknown):VisionBox;
export function normalizeVisionReview(value:unknown,assets:any[]):VisionReview;
export function createVisionReview(raw:any,project:any,job:any):VisionReview;
export function visionState(project:any):'unchecked'|'stale'|'pending'|'confirmed';
export function assertVisionReady(project:any):void;
export function acceptedFinding(project:any,id:string,role:ViewRole,assetId:string):VisionFinding;
export function readVisionOutput(entry:any):any[];
export function buildVisionWorkflow(params:{views:Partial<Record<ViewRole,string>>;model?:string;description?:string}):Record<string,unknown>;
export function boxSelection(width:number,height:number,box:VisionBox):Uint8ClampedArray;

export interface VisionCheck {
 candidate_index:number;role:ViewRole;part:Observation['part'];kind:'structure'|'count';title:string;reason:string;reference_evidence:string;target_evidence:string;suggestion:string;confidence:number;
 reference_count:number|null;target_count:number|null;bbox:VisionBox;reference_bbox:VisionBox|null;
 verdict:'structural'|'perspective'|'occluded'|'uncertain';model_verdict:VisionCheck['verdict'];gates:string[];
 reference_visibility:'clear'|'partial'|'hidden'|'unknown';target_visibility:VisionCheck['reference_visibility'];correspondence:'same_component'|'different_surface'|'unknown';basis:'component_type'|'connection'|'count'|'outline'|'surface_detail';alternative:'none'|'perspective'|'occlusion'|'different_surface'|'unknown';count_unit:'per_component'|'whole_character'|'unknown';
}
export interface VisionAnalysis {policy:'visibility-v2';candidateCount:number;overviewMs:number;verificationMs:number;checks:VisionCheck[]}
export const VISION_POLICY:'visibility-v2';
export const CLASS_LABELS:Record<VisionCheck['verdict'],string>;
export const VISIBILITY_LABELS:Record<VisionCheck['reference_visibility'],string>;
export function visionPolicy(info:any):string|null;
export function assertVisionPolicy(info:any):void;
