package main

import (
	"encoding/binary"
	"math"

	"github.com/vmihailenco/msgpack/v5"
)

// Serialize encodes data as MessagePack.
func Serialize(data interface{}) ([]byte, error) {
	return msgpack.Marshal(data)
}

// Deserialize decodes MessagePack data.
func Deserialize(raw []byte) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := msgpack.Unmarshal(raw, &result)
	return result, err
}

/* ================= BINARY STATE PROTOCOL ================= */

const (
	binaryMarker = 0x42
	headerBytes  = 8
	playerBytes  = 35 // +9 bytes: VX(4) + VY(4) + flags(1)
	bulletBytes  = 11
	grenadeBytes = 12 // shortId(2) + x(2) + y(2) + type(1) + aimAngle(4) + fuseProgress(1)
)

// Weapon code mapping
var weaponCodes = map[WeaponType]uint8{
	WeaponMachinegun: 0,
	WeaponShotgun:    1,
	WeaponSniper:     4,
}

// Grenade type codes for binary protocol
var grenadeTypeCodes = map[GrenadeType]uint8{
	GrenadeHE:    0,
	GrenadeFlash: 1,
}

// BinaryStateInput holds the data needed to encode a binary state message.
type BinaryStateInput struct {
	Seq      uint32
	Players  []*Player
	Bullets  []*Bullet
	Grenades []*Grenade
}

// EncodeBinaryState encodes a per-player state snapshot into compact binary.
func EncodeBinaryState(input *BinaryStateInput) []byte {
	totalSize := headerBytes +
		len(input.Players)*playerBytes +
		2 + len(input.Bullets)*bulletBytes +
		2 + len(input.Grenades)*grenadeBytes

	buf := make([]byte, totalSize)
	off := 0

	// Header
	buf[off] = binaryMarker
	off++
	buf[off] = 0 // flags (reserved)
	off++
	binary.LittleEndian.PutUint32(buf[off:], input.Seq)
	off += 4
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Players)))
	off += 2

	// Players
	for _, p := range input.Players {
		binary.LittleEndian.PutUint16(buf[off:], p.ShortID)
		off += 2
		putFloat32LE(buf[off:], float32(p.X))
		off += 4
		putFloat32LE(buf[off:], float32(p.Y))
		off += 4
		buf[off] = byte(int8(p.HP))
		off++
		buf[off] = byte(p.Shots)
		off++
		if p.Reloading {
			buf[off] = 1
		} else {
			buf[off] = 0
		}
		off++
		binary.LittleEndian.PutUint32(buf[off:], uint32(p.LastProcessedInput))
		off += 4
		putFloat32LE(buf[off:], float32(p.AimAngle))
		off += 4
		wc, ok := weaponCodes[p.Weapon]
		if !ok {
			wc = 0
		}
		buf[off] = wc
		off++
		binary.LittleEndian.PutUint16(buf[off:], uint16(p.Kills))
		off += 2
		buf[off] = byte(p.Skin)
		off++
		// Charging state: 0=none, 1=charging grenade, 2=charging flashbang
		var chargeByte uint8 = 0
		if p.ChargingGrenade == GrenadeHE {
			chargeByte = 1
		} else if p.ChargingGrenade == GrenadeFlash {
			chargeByte = 2
		}
		buf[off] = chargeByte
		off++
		// Velocity (for client-side extrapolation and reconciliation)
		putFloat32LE(buf[off:], float32(p.VX))
		off += 4
		putFloat32LE(buf[off:], float32(p.VY))
		off += 4
		// Flags byte: bit0=dodgeRolling, bit1=crouching, bit2=respawnShimmer, bit3=tagged
		var flags uint8 = 0
		if p.DodgeRolling {
			flags |= 0x01
		}
		if p.Crouching {
			flags |= 0x02
		}
		now := unixMs()
		if p.RespawnShimmerEnd > now {
			flags |= 0x04
		}
		if p.TaggedUntil > now {
			flags |= 0x08
		}
		buf[off] = flags
		off++
	}

	// Bullets
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Bullets)))
	off += 2
	for _, b := range input.Bullets {
		binary.LittleEndian.PutUint16(buf[off:], b.ShortID)
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(b.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(b.Y))))
		off += 2
		bwc, ok := weaponCodes[b.Weapon]
		if !ok {
			bwc = 0
		}
		buf[off] = bwc
		off++
		bAngle := float32(math.Atan2(b.DY, b.DX))
		binary.LittleEndian.PutUint32(buf[off:], math.Float32bits(bAngle))
		off += 4
	}

	// Grenades
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Grenades)))
	off += 2
	for _, g := range input.Grenades {
		binary.LittleEndian.PutUint16(buf[off:], g.ShortID)
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(g.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(g.Y))))
		off += 2
		gtc, ok := grenadeTypeCodes[g.GType]
		if !ok {
			gtc = 0
		}
		buf[off] = gtc
		off++
		// Encode direction angle for rendering
		gAngle := float32(math.Atan2(g.DY, g.DX))
		binary.LittleEndian.PutUint32(buf[off:], math.Float32bits(gAngle))
		off += 4
		// Fuse progress (0-255)
		now := unixMs()
		elapsed := now - g.CreatedAt
		progress := float64(elapsed) / float64(g.FuseTime)
		if progress > 1 {
			progress = 1
		}
		buf[off] = byte(progress * 255)
		off++
	}

	return buf[:off]
}

// putFloat32LE writes a float32 in little-endian format.
func putFloat32LE(buf []byte, v float32) {
	binary.LittleEndian.PutUint32(buf, math.Float32bits(v))
}
