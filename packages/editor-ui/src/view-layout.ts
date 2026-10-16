export type ViewMode = "single"|"continuous"|"two-up"|"two-up-continuous";
export type ZoomMode = "custom"|"fit-page"|"fit-width";

export interface ViewPreferences {
  mode: ViewMode;
  zoomMode: ZoomMode;
  zoom: number;
  coverAlone: boolean;
}

export const DEFAULT_VIEW_PREFERENCES:ViewPreferences={
  mode:"single",zoomMode:"custom",zoom:1,coverAlone:true
};

export const VIEW_MODES:ReadonlyArray<{id:ViewMode;label:string}>=[
  {id:"single",label:"Single Page"},
  {id:"continuous",label:"Continuous Scroll"},
  {id:"two-up",label:"Two-Page Spread"},
  {id:"two-up-continuous",label:"Two-Page Continuous"}
];

export function isTwoUp(mode:ViewMode):boolean{
  return mode==="two-up"||mode==="two-up-continuous";
}
export function isContinuous(mode:ViewMode):boolean{
  return mode==="continuous"||mode==="two-up-continuous";
}

/** Stable (1-based) user-facing spreads; first page is optionally cover-alone. */
export function groupVisiblePages(
  count:number,mode:ViewMode,coverAlone:boolean
):number[][]{
  if(!Number.isSafeInteger(count)||count<0||count>20000){
    throw new RangeError("Unsupported document page count.");
  }
  const groups:number[][]=[];
  if(!isTwoUp(mode)){
    for(let index=1;index<=count;index++)groups.push([index]);
    return groups;
  }
  let index=1;
  if(coverAlone && count){groups.push([1]);index=2;}
  for(;index<=count;index+=2){
    const pair=[index];
    if(index+1<=count)pair.push(index+1);
    groups.push(pair);
  }
  return groups;
}
export function spreadForPage(
  page:number,count:number,mode:ViewMode,coverAlone:boolean
):number[]{
  const groups=groupVisiblePages(count,mode,coverAlone);
  return groups.find(group=>group.includes(page))??groups[0]??[];
}
export function adjacentPage(
  page:number,count:number,mode:ViewMode,coverAlone:boolean,direction:-1|1
):number{
  if(!Number.isSafeInteger(count)||count<=0)return 1;
  const groups=groupVisiblePages(count,mode,coverAlone);
  const i=groups.findIndex(group=>group.includes(page));
  const next=Math.min(groups.length-1,Math.max(0,(i<0?0:i)+direction));
  return groups[next]?.[0]??1;
}
/** Maintain the actual page on layout changes rather than restarting at page one. */
export function pageGroupIndex(
  page:number,count:number,mode:ViewMode,coverAlone:boolean
):number{
  const groups=groupVisiblePages(count,mode,coverAlone);
  return Math.max(0,groups.findIndex(group=>group.includes(page)));
}
/** Zoom in PDF.js scale units; the Chrome UI still sets a per-page raster cap. */
export function zoomToFit(
  pageWidth:number,pageHeight:number,
  availableWidth:number,availableHeight:number,
  mode:ZoomMode,twoUp:boolean
):number{
  if(mode==="custom")return 1;
  for(const value of [pageWidth,pageHeight,availableWidth,availableHeight]){
    if(!Number.isFinite(value)||value<=0)return 1;
  }
  const width=Math.max(100,(availableWidth-70)/(twoUp?2:1)-(twoUp?14:0));
  const height=Math.max(100,availableHeight-105);
  const scale=mode==="fit-width"
    ?width/pageWidth
    :Math.min(width/pageWidth,height/pageHeight);
  return Math.round(Math.min(3,Math.max(.1,scale))*100)/100;
}
export function normalizedViewPreferences(value:unknown):ViewPreferences{
  const raw=(value&&typeof value==="object")?value as Partial<ViewPreferences>:{};
  const known=VIEW_MODES.some(e=>e.id===raw.mode);
  const zoom=raw.zoom;
  return {
    mode:known?raw.mode!:DEFAULT_VIEW_PREFERENCES.mode,
    zoomMode:["custom","fit-width","fit-page"].includes(raw.zoomMode??"")
      ?raw.zoomMode!:DEFAULT_VIEW_PREFERENCES.zoomMode,
    zoom:typeof zoom==="number"&&Number.isFinite(zoom)&&zoom>=.1&&zoom<=8
      ?zoom:1,
    coverAlone:typeof raw.coverAlone==="boolean"?raw.coverAlone:true
  };
}

export const MAX_ACTIVE_VIEW_PAGES = 10;
