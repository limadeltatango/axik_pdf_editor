import {
  clamp, isPoint, isRect, type Point, type Rect
} from "./geometry";

export interface AnnotationBase {
  id: string;
  pageIndex: number; // zero-based; page identity remapping comes with page operations
  author?: string;
  createdAt: string;
  updatedAt: string;
  /** Existing native PDF /NM key. Never infer one for a new draft. */
  sourceName?: string;
}

export interface AnnotationStyle {
  stroke: string; // 6-digit hex only in this foundation
  fill: string;   // 6-digit hex only
  opacity: number;
  lineWidth: number; // PDF user units
  fontSize: number;  // PDF user units
}

export interface CalloutAnnotation extends AnnotationBase {
  kind: "callout";
  /** PDF standard mapping: /Subtype /FreeText, /IT /FreeTextCallout. */
  intent: "FreeTextCallout";
  text: string;
  box: Rect;
  /** PDF /CL: two or three points, first is arrow target, last joins text box. */
  leader: readonly Point[];
  arrowHead: "none" | "open" | "closed";
  style: AnnotationStyle;
}

export interface StickyNoteAnnotation extends AnnotationBase {
  kind: "note";
  text: string;
  position: Point;
}

/** Native PDF /Subtype /FreeText without callout leader. */
export interface TextBoxAnnotation extends AnnotationBase {
  kind: "text";
  intent: "FreeText";
  text: string;
  box: Rect;
  style: AnnotationStyle;
}

export type Annotation = CalloutAnnotation | StickyNoteAnnotation | TextBoxAnnotation;
export type AnnotationKind = Annotation["kind"];

const MAX_ANNOTATION_TEXT = 20_000;
const MAX_ID = 128;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_CALLOUT_STYLE: AnnotationStyle = Object.freeze({
  stroke: "#ce5638",
  fill: "#fffce8",
  opacity: 1,
  lineWidth: 1.5,
  fontSize: 12
});

/** Validation belongs at every trust boundary, including journal restore and future IPC. */
export function validateAnnotation(value: Annotation): Annotation {
  if (!value.id || value.id.length > MAX_ID ||
      !Number.isSafeInteger(value.pageIndex) || value.pageIndex < 0) {
    throw new RangeError("Invalid annotation identity.");
  }
  if (value.author && value.author.length > 200) throw new RangeError("Author too long.");
  if(value.sourceName !== undefined && (
    typeof value.sourceName !== "string" ||
    value.sourceName.length < 1 || value.sourceName.length > 128 ||
    value.sourceName !== value.id
  )) {
    throw new RangeError("Imported annotation identifier must match its PDF /NM name.");
  }
  if (!Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new RangeError("Annotation timestamps must be valid ISO dates.");
  }
  if (value.text.length > MAX_ANNOTATION_TEXT) throw new RangeError("Annotation text too long.");
  if (value.kind === "note") {
    if (!isPoint(value.position)) throw new RangeError("Invalid note position.");
    return value;
  }
  if (value.kind === "text") {
    if (value.intent !== "FreeText" || !isRect(value.box)) {
      throw new RangeError("Invalid editable text box.");
    }
  } else if (value.kind !== "callout" || value.intent !== "FreeTextCallout" ||
      !isRect(value.box) || ![2, 3].includes(value.leader.length) ||
      !value.leader.every(isPoint) ||
      !["none", "open", "closed"].includes(value.arrowHead)) {
    throw new RangeError("Invalid native callout geometry.");
  }
  const style = value.style;
  if (!HEX.test(style.stroke) || !HEX.test(style.fill) ||
      !Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1 ||
      !Number.isFinite(style.lineWidth) || style.lineWidth <= 0 || style.lineWidth > 100 ||
      !Number.isFinite(style.fontSize) || style.fontSize < 4 || style.fontSize > 200) {
    throw new RangeError("Invalid callout style.");
  }
  return value;
}

export function newCallout({
  id, pageIndex, tip, pageBounds, text = "New callout", now = new Date()
}: {
  id: string;
  pageIndex: number;
  tip: Point;
  pageBounds: Rect;
  text?: string;
  now?: Date;
}): CalloutAnnotation {
  if (!isRect(pageBounds) || !isPoint(tip)) throw new RangeError("Invalid page placement.");
  const width = Math.min(192, pageBounds.width);
  const height = Math.min(64, pageBounds.height);
  const preferRight = tip.x < pageBounds.x + pageBounds.width / 2;
  const offsetX = preferRight ? 48 : -48 - width;
  const box: Rect = {
    x: clamp(tip.x + offsetX, pageBounds.x, pageBounds.x + pageBounds.width - width),
    y: clamp(tip.y + 32, pageBounds.y, pageBounds.y + pageBounds.height - height),
    width,
    height
  };
  const attachment: Point = {
    x: preferRight ? box.x : box.x + box.width,
    y: box.y + box.height / 2
  };
  const elbow: Point = { x: (tip.x + attachment.x) / 2, y: tip.y };
  const timestamp = now.toISOString();
  const annotation: CalloutAnnotation = {
    id, pageIndex, kind: "callout", intent: "FreeTextCallout", text,
    box, leader: [tip, elbow, attachment],
    arrowHead: "closed", style: { ...DEFAULT_CALLOUT_STYLE },
    createdAt: timestamp, updatedAt: timestamp
  };
  validateAnnotation(annotation);
  return annotation;
}

export interface StandardCalloutPayload {
  subtype: "FreeText";
  intent: "FreeTextCallout";
  /** Serialization to PDF /CL is ordered (arrow target, optional elbow, text attachment). */
  calloutLine: readonly number[];
  text: string;
  /** Full annotation bounds including the arrow and leader. */
  rect: readonly [number, number, number, number];
  /** Inner free-text box, for a future /RD and /AP implementation. */
  textBoxRect: readonly [number, number, number, number];
}

/**
 * This is a well-defined interchange *input contract*, NOT PDF serialization.
 * PDF dictionary construction, valid /AP streams, font resources and cross-editor
 * round-tripping are deferred until a safe writer is qualified.
 */
export function calloutToStandardPayload(callout: CalloutAnnotation): StandardCalloutPayload {
  validateAnnotation(callout);
  const textBoxRect = [
    callout.box.x, callout.box.y,
    callout.box.x + callout.box.width,
    callout.box.y + callout.box.height
  ] as const;
  const allX = [textBoxRect[0], textBoxRect[2], ...callout.leader.map((point) => point.x)];
  const allY = [textBoxRect[1], textBoxRect[3], ...callout.leader.map((point) => point.y)];
  const padding = Math.max(4, callout.style.lineWidth * 3);
  return {
    subtype: "FreeText",
    intent: "FreeTextCallout",
    calloutLine: callout.leader.flatMap((point) => [point.x, point.y]),
    text: callout.text,
    rect: [
      Math.min(...allX) - padding, Math.min(...allY) - padding,
      Math.max(...allX) + padding, Math.max(...allY) + padding
    ],
    textBoxRect
  };
}


/** Create a plain, movable FreeText markup box; this does NOT rewrite existing text streams. */
export function newTextBox({
  id, pageIndex, location, pageBounds, text="New text",
  now=new Date()
}:{
  id:string;pageIndex:number;location:Point;pageBounds:Rect;
  text?:string;now?:Date
}):TextBoxAnnotation {
  if(!isRect(pageBounds)||!isPoint(location)){
    throw new RangeError("Invalid text box placement.");
  }
  const width=Math.min(240,pageBounds.width);
  const height=Math.min(70,pageBounds.height);
  const box:Rect={
    x:clamp(location.x,pageBounds.x,pageBounds.x+pageBounds.width-width),
    y:clamp(location.y-height,pageBounds.y,pageBounds.y+pageBounds.height-height),
    width,height
  };
  const time=now.toISOString();
  const annotation:TextBoxAnnotation={
    id,pageIndex,kind:"text",intent:"FreeText",text,box,
    style:{
      ...DEFAULT_CALLOUT_STYLE,
      stroke:"#152539",fill:"#ffffff",
      fontSize:14,lineWidth:0.5
    },
    createdAt:time,updatedAt:time
  };
  validateAnnotation(annotation);
  return annotation;
}


export function newStickyNote({
  id,pageIndex,position,text="Add a note",now=new Date()
}:{
  id:string;pageIndex:number;position:Point;text?:string;now?:Date
}):StickyNoteAnnotation{
  if(!isPoint(position))throw new RangeError("Invalid comment position.");
  const time=now.toISOString();
  const note:StickyNoteAnnotation={
    id,pageIndex,position,text,kind:"note",
    createdAt:time,updatedAt:time
  };
  validateAnnotation(note);
  return note;
}
