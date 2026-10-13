import {validateAnnotation,type Annotation} from "@axik/document-core";

export interface PlannedAnnotationEdits {
  /** New or changed native annotations only; untouched imports remain unmodified. */
  changes: Annotation[];
  /** Names of imported Axik annotations deliberately removed in this edit. */
  removeNames: string[];
}

/**
 * Calculate mutations against the source PDF snapshot, NOT against arbitrary
 * PDF annotation dictionaries. Unrecognized or foreign annotations stay intact.
 * This also prevents repeatedly exporting the same imported native object.
 */
export function planAnnotationEdits(
  imported:readonly Annotation[],
  current:readonly Annotation[]
):PlannedAnnotationEdits {
  const original=new Map<string,Annotation>();
  for(const a of imported){
    validateAnnotation(a);
    if(!a.sourceName)throw new RangeError("Baseline contains a non-imported draft.");
    if(original.has(a.id))throw new RangeError("Baseline annotation ID is duplicated.");
    original.set(a.id,a);
  }
  const present=new Set<string>();
  const changes:Annotation[]=[];
  for(const item of current){
    validateAnnotation(item);
    if(present.has(item.id))throw new RangeError("Current annotation ID is duplicated.");
    present.add(item.id);
    const old=original.get(item.id);
    if(old){
      if(item.sourceName !== old.sourceName || item.kind !== old.kind){
        throw new RangeError("Imported annotation origin or subtype changed.");
      }
      if(JSON.stringify(item)!==JSON.stringify(old))changes.push(item);
    }else{
      if(item.sourceName){
        throw new RangeError("A draft cannot impersonate an imported PDF annotation.");
      }
      changes.push(item);
    }
  }
  const removeNames=[...original.values()]
    .filter(a=>!present.has(a.id))
    .map(a=>a.sourceName!);
  return {changes,removeNames};
}
