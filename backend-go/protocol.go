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
	binaryMarker  = 0x42
	headerBytes   = 8
	playerBytes   = 25
	bulletBytes   = 11
)

// Weapon code mapping
var weaponCodes = map[WeaponType]uint8{
	WeaponMachinegun: 0,
	WeaponShotgun:    1,
	WeaponKnife:      2,
	WeaponSniper:     4,
}

// BinaryStateInput holds the data needed to encode a binary state message.
type BinaryStateInput struct {
	Seq     uint32
	IsDelta bool
	Players []*Player
	Bullets []*Bullet
}

// EncodeBinaryState encodes a per-player state snapshot into compact binary.
func EncodeBinaryState(input *BinaryStateInput) []byte {
	totalSize := headerBytes +
		len(input.Players)*playerBytes +
		2 + len(input.Bullets)*bulletBytes

	buf := make([]byte, totalSize)
	off := 0

	// Header
	buf[off] = binaryMarker
	off++
	flags := uint8(0)
	if input.IsDelta {
		flags |= 1
	}
	buf[off] = flags
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

	return buf[:off]
}

// putFloat32LE writes a float32 in little-endian format.
func putFloat32LE(buf []byte, v float32) {
	binary.LittleEndian.PutUint32(buf, math.Float32bits(v))
}

// nowMs returns current time in milliseconds.
func nowMs() int64 {
	return unixMs()
}
