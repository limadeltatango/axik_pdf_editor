import {
  kitchenLinearLightTemplate,validateSymbolTemplate,
  type SymbolTemplate
} from "@axik/document-core";

const STORAGE_KEY="axik-pdf-editor-symbols-v1";
const MAX_TEMPLATES=70;

export function readSymbolLibrary():SymbolTemplate[]{
  const builtIn=kitchenLinearLightTemplate();
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw)return [builtIn];
    const parsed:unknown=JSON.parse(raw);
    if(!Array.isArray(parsed) || parsed.length>MAX_TEMPLATES)throw new Error("Invalid library.");
    const templates=parsed.map(item=>
      validateSymbolTemplate(item as SymbolTemplate)
    );
    return [builtIn,...templates.filter(t=>t.id!==builtIn.id)];
  }catch{
    return [builtIn];
  }
}
export function saveSymbolTemplate(template:SymbolTemplate):SymbolTemplate[]{
  validateSymbolTemplate(template);
  const builtIn=kitchenLinearLightTemplate().id;
  if(template.id===builtIn){
    throw new Error("Use Save as new to customize the built-in fixture example.");
  }
  const current=readSymbolLibrary().filter(t=>t.id!==builtIn);
  const next=[...current.filter(t=>t.id!==template.id),
    structuredClone(template)];
  if(next.length>MAX_TEMPLATES)throw new RangeError("Symbol library is full.");
  localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
  return readSymbolLibrary();
}
export function deleteSymbolTemplate(id:string):SymbolTemplate[]{
  if(id===kitchenLinearLightTemplate().id){
    throw new Error("Built-in symbols cannot be deleted.");
  }
  const next=readSymbolLibrary().filter(t=>
    t.id!==id && t.id!==kitchenLinearLightTemplate().id
  );
  localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
  return readSymbolLibrary();
}
