/**
 * Reconstruct editable Axik-native PDF annotations from PDF dictionaries.
 * Foreign/unknown annotation types remain untouched and are not imported into
 * the editing model until independently qualified.
 */
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,
        PDFNumber,PDFString} from "pdf-lib";
import {
  DEFAULT_CALLOUT_STYLE,validateAnnotation,
  type Annotation,type AnnotationStyle,type Point,type Rect
} from "@axik/document-core";

function str(dict:PDFDict,key:string):string|undefined {
  const object=dict.lookup(PDFName.of(key));
  try {
    return object instanceof PDFHexString || object instanceof PDFString
      ? object.decodeText() : undefined;
  } catch {return undefined}
}
function nums(dict:PDFDict,key:string,count?:number):number[]|undefined{
  let array:PDFArray|undefined;
  try {array=dict.lookupMaybe(PDFName.of(key),PDFArray)}
  catch{return undefined}
  if(!array || (count!==undefined && array.size()!==count))return undefined;
  const out:number[]=[];
  for(let i=0;i<array.size();i++){
    const v=array.get(i);
    if(!(v instanceof PDFNumber) || !Number.isFinite(v.asNumber()) ||
       Math.abs(v.asNumber())>1e9)return undefined;
    out.push(v.asNumber());
  }
  return out;
}
function rectangle(coords?:readonly number[]):Rect|undefined{
  if(!coords || coords.length!==4)return undefined;
  const [x=0,y=0,right=0,top=0]=coords;
  if(right<=x||top<=y)return undefined;
  return {x,y,width:right-x,height:top-y};
}
function dateValue(raw?:string):string{
  const parts=/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(raw??"");
  if(!parts)return new Date().toISOString();
  const date=new Date(
    parts[1]+"-"+parts[2]+"-"+parts[3]+"T"+
    parts[4]+":"+parts[5]+":"+parts[6]+"Z"
  );
  return Number.isFinite(date.getTime())?date.toISOString():new Date().toISOString();
}
function style(dict:PDFDict):AnnotationStyle{
  const da=str(dict,"DA")??"";
  const sizeMatch=/\s(\d+(?:\.\d+)?)\s+Tf/.exec(da);
  let size=Number(sizeMatch?.[1]??12);
  if(!Number.isFinite(size))size=12;
  let stroke="#17212c";
  const rgb=nums(dict,"C",3);
  if(rgb)stroke="#"+rgb.map(v=>
    Math.round(Math.max(0,Math.min(1,v))*255)
      .toString(16).padStart(2,"0")
  ).join("");
  let width=1.5,opacity=1;
  try{
    const bs=dict.lookupMaybe(PDFName.of("BS"),PDFDict);
    const w=bs?.lookupMaybe(PDFName.of("W"),PDFNumber)?.asNumber();
    if(w!==undefined && w>0 && w<=100)width=w;
    const alpha=dict.lookupMaybe(PDFName.of("CA"),PDFNumber)?.asNumber();
    if(alpha!==undefined && alpha>=0 && alpha<=1)opacity=alpha;
  }catch{/* safe defaults */}
  return {
    ...DEFAULT_CALLOUT_STYLE,stroke,fill:"#fffce8",
    fontSize:Math.max(4,Math.min(200,size)),lineWidth:width,opacity
  };
}
function parse(dict:PDFDict,pageIndex:number):Annotation|undefined{
  const name=str(dict,"NM");
  const author=str(dict,"T");
  if(author!=="Axik PDF" || !name || name.length>128)return undefined;
  const rawSubtype=dict.lookup(PDFName.of("Subtype"));
  if(!(rawSubtype instanceof PDFName))return undefined;
  const subtype=rawSubtype.asString();
  if(subtype!=="/FreeText" && subtype!=="/Text")return undefined;
  const text=str(dict,"Contents")??"";
  if(text.length>20000)return undefined;
  const rect=rectangle(nums(dict,"Rect",4));
  if(!rect)return undefined;
  const timestamp=dateValue(str(dict,"M"));
  const common={
    id:name,sourceName:name,author,createdAt:timestamp,
    updatedAt:timestamp,pageIndex,text
  };

  if(subtype==="/Text"){
    return validateAnnotation({
      ...common,kind:"note",position:{x:rect.x,y:rect.y}
    });
  }
  const intent=dict.lookup(PDFName.of("IT"));
  if(intent instanceof PDFName && intent.asString()==="/FreeTextCallout"){
    const coords=nums(dict,"CL");
    if(!coords || ![4,6].includes(coords.length))return undefined;
    const rd=nums(dict,"RD",4)??[0,0,0,0];
    const box=rectangle([
      rect.x+rd[0]!,rect.y+rd[1]!,
      rect.x+rect.width-rd[2]!,rect.y+rect.height-rd[3]!
    ]);
    if(!box)return undefined;
    const leader:Point[]=[];
    for(let i=0;i<coords.length;i+=2){
      leader.push({x:coords[i]!,y:coords[i+1]!});
    }
    const ending=dict.lookup(PDFName.of("LE"));
    const arrowHead=ending instanceof PDFName && ending.asString()==="/OpenArrow"
      ? "open" as const : ending instanceof PDFName && ending.asString()==="/None"
        ? "none" as const : "closed" as const;
    return validateAnnotation({
      ...common,kind:"callout",intent:"FreeTextCallout",
      box,leader,arrowHead,style:style(dict)
    });
  }
  return validateAnnotation({
    ...common,kind:"text",intent:"FreeText",box:rect,style:style(dict)
  });
}

/** Throws for large/malformed PDFs; caller should keep the ordinary viewer open. */
export async function readEditableAnnotations(bytes:Uint8Array):Promise<Annotation[]>{
  if(bytes.byteLength<100 || bytes.byteLength>100*1024*1024){
    throw new RangeError("Importing editable annotations requires a PDF <=100 MiB.");
  }
  const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
  const out:Annotation[]=[];
  const used=new Set<string>();
  for(const [pageIndex,page] of doc.getPages().entries()){
    let array:PDFArray|undefined;
    try{array=page.node.lookupMaybe(PDFName.of("Annots"),PDFArray)}
    catch{continue}
    if(!array)continue;
    if(array.size()>5000)throw new RangeError("Too many annotations on a page.");
    for(let i=0;i<array.size();i++){
      let dict:PDFDict;
      try{dict=doc.context.lookup(array.get(i),PDFDict)}
      catch{continue}
      let annotation:Annotation|undefined;
      try{annotation=parse(dict,pageIndex)}catch{continue}
      if(!annotation || used.has(annotation.id))continue;
      used.add(annotation.id);
      out.push(annotation);
      if(out.length>1000)throw new RangeError("Too many editable annotations.");
    }
  }
  return out;
}
