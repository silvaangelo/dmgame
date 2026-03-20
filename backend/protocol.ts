import { encode, decode } from "@msgpack/msgpack";
import type { Player, Bullet, Pickup, Orb, LootCrate } from "./types.js";

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

/* ================= BINARY STATE PROTOCOL ================= */
/**
 * High-frequency state broadcasts (35 Hz) use a raw binary format
 * instead of msgpack. This avoids per-field type tags and string keys,
 * cutting payload size by ~5x and eliminating encode/decode CPU overhead.
 *
 * Format (all multi-byte values are little-endian):
 *
 * Header (8 bytes):
 *   [0]     u8   marker = 0x42 ('B' for Binary state)
 *   [1]     u8   flags (bit0=delta, bit1=hasZone)
 *   [2..5]  u32  sequence number
 *   [6..7]  u16  player count
 *
 * Per player (29 bytes):
 *   [0..1]  u16  shortId
 *   [2..5]  f32  x
 *   [6..9]  f32  y
 *   [10]    i8   hp
 *   [11]    u8   shots
 *   [12]    u8   reloading (0/1)
 *   [13..16] u32 lastProcessedInput
 *   [17..20] f32 aimAngle
 *   [21]    u8   weaponCode
 *   [22..23] u16 kills
 *   [24]    u8   skin
 *   [25]    u8   powerup flags (bit0=speed,bit1=shield,bit2=invis,bit3=regen,bit4=dash)
 *   [26]    u8   armor
 *   [27..28] u16 score
 *
 * After players:
 *   [0..1]  u16  bullet count
 *   Per bullet (7 bytes):
 *     [0..1] u16 shortId
 *     [2..3] i16 x
 *     [4..5] i16 y
 *     [6]    u8  weaponCode
 *
 *   [0..1]  u16  pickup count
 *   Per pickup (7 bytes):
 *     [0..1] u16 shortId
 *     [2..3] i16 x
 *     [4..5] i16 y
 *     [6]    u8  type
 *
 *   [0..1]  u16  orb count
 *   Per orb (6 bytes):
 *     [0..1] u16 shortId
 *     [2..3] i16 x
 *     [4..5] i16 y
 *
 *   [0..1]  u16  crate count
 *   Per crate (7 bytes):
 *     [0..1] u16 shortId
 *     [2..3] i16 x
 *     [4..5] i16 y
 *     [6]    u8  hp
 *
 * If hasZone flag (16 bytes):
 *   [0..3]  i16  zoneX
 *   [4..7]  i16  zoneY
 *   [8..11] i16  zoneW
 *   [12..15] i16 zoneH
 */

const PLAYER_BYTES = 29;
const BULLET_BYTES = 7;
const PICKUP_BYTES = 7;
const ORB_BYTES = 6;
const CRATE_BYTES = 7;
const HEADER_BYTES = 8;
const ZONE_BYTES = 8; // 4 × i16

const WEAPON_CODES: Record<string, number> = {
  machinegun: 0, shotgun: 1, knife: 2, minigun: 3, sniper: 4,
};
const PICKUP_TYPE_CODES: Record<string, number> = {
  health: 0, ammo: 1, speed: 2, minigun: 3, shield: 4, invisibility: 5, regen: 6, armor: 7,
};

/** Pre-allocated buffer — resized when needed. Avoids GC per tick. */
let sharedBuf = new ArrayBuffer(16384);
let sharedView = new DataView(sharedBuf);

function ensureCapacity(needed: number) {
  if (sharedBuf.byteLength >= needed) return;
  const newSize = Math.max(needed, sharedBuf.byteLength * 2);
  sharedBuf = new ArrayBuffer(newSize);
  sharedView = new DataView(sharedBuf);
}

export interface BinaryStateInput {
  seq: number;
  isDelta: boolean;
  players: Player[];
  bullets: Bullet[];
  pickups: Pickup[];
  orbs: Orb[];
  crates: LootCrate[];
  zone: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Encode a per-player state message into a compact binary buffer.
 * Returns a Uint8Array slice (zero-copy from shared buffer).
 */
export function encodeBinaryState(input: BinaryStateInput): Uint8Array {
  const now = Date.now();
  const hasZone = input.zone !== null;
  const totalSize = HEADER_BYTES
    + input.players.length * PLAYER_BYTES
    + 2 + input.bullets.length * BULLET_BYTES
    + 2 + input.pickups.length * PICKUP_BYTES
    + 2 + input.orbs.length * ORB_BYTES
    + 2 + input.crates.length * CRATE_BYTES
    + (hasZone ? ZONE_BYTES : 0);

  ensureCapacity(totalSize);
  const dv = sharedView;
  let off = 0;

  // Header
  dv.setUint8(off, 0x42); off += 1;           // marker
  dv.setUint8(off, (input.isDelta ? 1 : 0) | (hasZone ? 2 : 0)); off += 1; // flags
  dv.setUint32(off, input.seq, true); off += 4; // sequence
  dv.setUint16(off, input.players.length, true); off += 2; // player count

  // Players
  for (const p of input.players) {
    dv.setUint16(off, p.shortId, true); off += 2;
    dv.setFloat32(off, p.x, true); off += 4;
    dv.setFloat32(off, p.y, true); off += 4;
    dv.setInt8(off, p.hp); off += 1;
    dv.setUint8(off, p.shots); off += 1;
    dv.setUint8(off, p.reloading ? 1 : 0); off += 1;
    dv.setUint32(off, p.lastProcessedInput, true); off += 4;
    dv.setFloat32(off, p.aimAngle, true); off += 4;
    dv.setUint8(off, WEAPON_CODES[p.weapon] ?? 0); off += 1;
    dv.setUint16(off, p.kills, true); off += 2;
    dv.setUint8(off, p.skin); off += 1;
    // Powerup flags packed into single byte
    let flags = 0;
    if (now < p.speedBoostUntil) flags |= 1;
    if (now < p.shieldUntil) flags |= 2;
    if (now < p.invisibleUntil) flags |= 4;
    if (now < p.regenUntil) flags |= 8;
    if (now < p.dashUntil) flags |= 16;
    dv.setUint8(off, flags); off += 1;
    dv.setUint8(off, p.armor); off += 1;
    dv.setUint16(off, p.score, true); off += 2;
  }

  // Bullets
  dv.setUint16(off, input.bullets.length, true); off += 2;
  for (const b of input.bullets) {
    dv.setUint16(off, b.shortId, true); off += 2;
    dv.setInt16(off, Math.round(b.x), true); off += 2;
    dv.setInt16(off, Math.round(b.y), true); off += 2;
    dv.setUint8(off, WEAPON_CODES[b.weapon] ?? 0); off += 1;
  }

  // Pickups
  dv.setUint16(off, input.pickups.length, true); off += 2;
  for (const pk of input.pickups) {
    dv.setUint16(off, pk.shortId, true); off += 2;
    dv.setInt16(off, Math.round(pk.x), true); off += 2;
    dv.setInt16(off, Math.round(pk.y), true); off += 2;
    dv.setUint8(off, PICKUP_TYPE_CODES[pk.type] ?? 0); off += 1;
  }

  // Orbs
  dv.setUint16(off, input.orbs.length, true); off += 2;
  for (const o of input.orbs) {
    dv.setUint16(off, o.shortId, true); off += 2;
    dv.setInt16(off, Math.round(o.x), true); off += 2;
    dv.setInt16(off, Math.round(o.y), true); off += 2;
  }

  // Crates
  dv.setUint16(off, input.crates.length, true); off += 2;
  for (const c of input.crates) {
    dv.setUint16(off, c.shortId, true); off += 2;
    dv.setInt16(off, Math.round(c.x), true); off += 2;
    dv.setInt16(off, Math.round(c.y), true); off += 2;
    dv.setUint8(off, c.hp); off += 1;
  }

  // Zone
  if (hasZone && input.zone) {
    dv.setInt16(off, Math.round(input.zone.x), true); off += 2;
    dv.setInt16(off, Math.round(input.zone.y), true); off += 2;
    dv.setInt16(off, Math.round(input.zone.w), true); off += 2;
    dv.setInt16(off, Math.round(input.zone.h), true); off += 2;
  }

  // Return a copy (WebSocket may not send before next tick overwrites shared buffer)
  return new Uint8Array(sharedBuf, 0, off).slice();
}
