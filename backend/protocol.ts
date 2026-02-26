import { encode, decode } from "@msgpack/msgpack";

/**
 * Serialize a message for WebSocket transmission (MessagePack binary).
 */
export function serialize(data: unknown): Uint8Array {
  return encode(data);
}

/**
 * Deserialize a WebSocket message from binary (MessagePack) to an object.
 * Accepts Buffer, ArrayBuffer, or Uint8Array.
 */
export function deserialize(msg: Buffer | ArrayBuffer | Uint8Array): unknown {
  if (msg instanceof ArrayBuffer) {
    return decode(new Uint8Array(msg));
  }
  return decode(msg);
}
