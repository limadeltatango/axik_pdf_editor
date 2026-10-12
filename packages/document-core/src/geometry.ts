/**
 * Geometry stays in PDF user space. PDF points have their origin at bottom-left,
 * whereas the screen generally has its origin at top-left.
 * A renderer-supplied affine transform handles CropBox/Rotate/UserUnit exactly.
 */
export type Point = Readonly<{ x: number; y: number }>;
export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type PdfBox = readonly [number, number, number, number];
export type Rotation = 0 | 90 | 180 | 270;
/** PDF's six-number transform: x' = ax + cy + e, y' = bx + dy + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export interface PageGeometry {
  mediaBox: PdfBox;
  cropBox?: PdfBox;
  rotate: Rotation;
  userUnit: number;
}

const MAX_COORDINATE = 1e9;

export function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new RangeError(label + " must be a finite, bounded number.");
  }
  return value;
}

export function normalizeRotation(degrees: number): Rotation {
  finiteNumber(degrees, "Rotation");
  if (!Number.isInteger(degrees) || degrees % 90 !== 0) {
    throw new RangeError("PDF page rotation must be an integer multiple of 90.");
  }
  return (((degrees % 360) + 360) % 360) as Rotation;
}

export function normalizedBox(box: PdfBox): PdfBox {
  const [x1, y1, x2, y2] = box;
  for (const value of box) finiteNumber(value, "PDF box coordinate");
  if (x2 <= x1 || y2 <= y1) throw new RangeError("PDF box must have a positive area.");
  return [x1, y1, x2, y2];
}

export function visibleBox(geometry: PageGeometry): PdfBox {
  const [mx1, my1, mx2, my2] = normalizedBox(geometry.mediaBox);
  if (!geometry.cropBox) return [mx1, my1, mx2, my2];
  const [cx1, cy1, cx2, cy2] = normalizedBox(geometry.cropBox);
  const box: PdfBox = [
    Math.max(mx1, cx1), Math.max(my1, cy1),
    Math.min(mx2, cx2), Math.min(my2, cy2)
  ];
  return normalizedBox(box);
}

/** Oriented visible size in physical PDF points (72 points/inch). */
export function visiblePageSize(geometry: PageGeometry): { width: number; height: number } {
  const [x1, y1, x2, y2] = visibleBox(geometry);
  finiteNumber(geometry.userUnit, "UserUnit");
  if (geometry.userUnit <= 0) throw new RangeError("UserUnit must be positive.");
  const width = (x2 - x1) * geometry.userUnit;
  const height = (y2 - y1) * geometry.userUnit;
  return geometry.rotate === 90 || geometry.rotate === 270
    ? { width: height, height: width }
    : { width, height };
}

export function isPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE;
}

export function isRect(rect: Rect): boolean {
  return isPoint(rect) && Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width > 0 && rect.height > 0 &&
    rect.width <= MAX_COORDINATE && rect.height <= MAX_COORDINATE;
}

export function applyMatrix([a, b, c, d, e, f]: Matrix, point: Point): Point {
  if (!isPoint(point)) throw new RangeError("Invalid input point.");
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

export function invertMatrix([a, b, c, d, e, f]: Matrix): Matrix {
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new RangeError("The page viewport has a singular transform.");
  }
  const inverse: Matrix = [
    d / determinant, -b / determinant,
    -c / determinant, a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ];
  inverse.forEach((number) => finiteNumber(number, "Inverse transform"));
  return inverse;
}

export function viewportToPdf(viewport: Matrix, screenPoint: Point): Point {
  return applyMatrix(invertMatrix(viewport), screenPoint);
}

export function pdfToViewport(viewport: Matrix, pdfPoint: Point): Point {
  return applyMatrix(viewport, pdfPoint);
}

export function transformedRect(viewport: Matrix, rect: Rect): Rect {
  if (!isRect(rect)) throw new RangeError("Invalid PDF annotation rectangle.");
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ].map((corner) => applyMatrix(viewport, corner));
  const x = Math.min(...corners.map((point) => point.x));
  const y = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return { x, y, width: right - x, height: bottom - y };
}

export function clamp(value: number, lower: number, upper: number): number {
  if (lower > upper) throw new RangeError("Invalid clamp bounds.");
  return Math.min(upper, Math.max(lower, value));
}
