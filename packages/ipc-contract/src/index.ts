/**
 * Versioned envelope for an OPTIONAL, future Chromium native-messaging bridge.
 * This module grants no filesystem, print, or other native privileges.
 * A host must reject every message unless schema and user authorization pass.
 */
export const BRIDGE_PROTOCOL_VERSION = 1;
export const MAX_BRIDGE_JSON_BYTES = 256 * 1024;
export type NativeCapability =
  | "handshake" | "print-preview" | "redaction-review" | "document-handoff";

export interface BridgeRequest {
  protocol: 1;
  id: string;
  kind: "capabilities" | "ping";
}

export interface BridgeResponse {
  protocol: 1;
  id: string;
  ok: boolean;
  capabilities?: NativeCapability[];
  error?: { code: string; message: string };
}
export type BridgeEnvelope = BridgeRequest | BridgeResponse;

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BridgeRequest>;
  return candidate.protocol === BRIDGE_PROTOCOL_VERSION &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0 && candidate.id.length <= 96 &&
    (candidate.kind === "ping" || candidate.kind === "capabilities");
}

/** Count actual encoded bytes, not JavaScript UTF-16 characters. */
export function parseBridgeRequest(json: string): BridgeRequest {
  if (new TextEncoder().encode(json).byteLength > MAX_BRIDGE_JSON_BYTES) {
    throw new RangeError("Native bridge message exceeds the size limit.");
  }
  const raw: unknown = JSON.parse(json);
  if (!isBridgeRequest(raw)) throw new TypeError("Invalid native bridge request.");
  // Reject unexpected fields until explicitly supported in a new version.
  const keys = Object.keys(raw);
  if (keys.some((key) => !["protocol", "id", "kind"].includes(key))) {
    throw new TypeError("Unexpected bridge request fields.");
  }
  return raw;
}

export function unsupportedBridgeResponse(id: string): BridgeResponse {
  return {
    protocol: BRIDGE_PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code: "NOT_IMPLEMENTED", message: "Native companion not implemented." }
  };
}
