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
	playerBytes   = 29
	bulletBytes   = 7
	pickupBytes   = 7
	orbBytes      = 6
	crateBytes    = 7
	zoneBytes     = 8
)

// Weapon code mapping
var weaponCodes = map[WeaponType]uint8{
	WeaponMachinegun: 0,
	WeaponShotgun:    1,
	WeaponKnife:      2,
	WeaponMinigun:    3,
	WeaponSniper:     4,
}

// Pickup type code mapping
var pickupTypeCodes = map[PickupType]uint8{
	PickupHealth:       0,
	PickupAmmo:         1,
	PickupSpeed:        2,
	PickupMinigun:      3,
	PickupShield:       4,
	PickupInvisibility: 5,
	PickupRegen:        6,
	PickupArmor:        7,
}

// BinaryStateInput holds the data needed to encode a binary state message.
type BinaryStateInput struct {
	Seq     uint32
	IsDelta bool
	Players []*Player
	Bullets []*Bullet
	Pickups []*Pickup
	Orbs    []*Orb
	Crates  []*LootCrate
	Zone    *Zone // nil if no zone
}

// EncodeBinaryState encodes a per-player state snapshot into compact binary.
func EncodeBinaryState(input *BinaryStateInput) []byte {
	now := nowMs()
	hasZone := input.Zone != nil

	totalSize := headerBytes +
		len(input.Players)*playerBytes +
		2 + len(input.Bullets)*bulletBytes +
		2 + len(input.Pickups)*pickupBytes +
		2 + len(input.Orbs)*orbBytes +
		2 + len(input.Crates)*crateBytes
	if hasZone {
		totalSize += zoneBytes
	}

	buf := make([]byte, totalSize)
	off := 0

	// Header
	buf[off] = binaryMarker
	off++
	flags := uint8(0)
	if input.IsDelta {
		flags |= 1
	}
	if hasZone {
		flags |= 2
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

		// Powerup flags
		var pflags uint8
		if now < p.SpeedBoostUntil {
			pflags |= 1
		}
		if now < p.ShieldUntil {
			pflags |= 2
		}
		if now < p.InvisibleUntil {
			pflags |= 4
		}
		if now < p.RegenUntil {
			pflags |= 8
		}
		if now < p.DashUntil {
			pflags |= 16
		}
		buf[off] = pflags
		off++
		buf[off] = byte(p.Armor)
		off++
		binary.LittleEndian.PutUint16(buf[off:], uint16(p.Score))
		off += 2
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
	}

	// Pickups
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Pickups)))
	off += 2
	for _, pk := range input.Pickups {
		binary.LittleEndian.PutUint16(buf[off:], pk.ShortID)
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(pk.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(pk.Y))))
		off += 2
		ptc, ok := pickupTypeCodes[pk.Type]
		if !ok {
			ptc = 0
		}
		buf[off] = ptc
		off++
	}

	// Orbs
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Orbs)))
	off += 2
	for _, o := range input.Orbs {
		binary.LittleEndian.PutUint16(buf[off:], o.ShortID)
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(o.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(o.Y))))
		off += 2
	}

	// Crates
	binary.LittleEndian.PutUint16(buf[off:], uint16(len(input.Crates)))
	off += 2
	for _, c := range input.Crates {
		binary.LittleEndian.PutUint16(buf[off:], c.ShortID)
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(c.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(c.Y))))
		off += 2
		buf[off] = byte(c.HP)
		off++
	}

	// Zone
	if hasZone {
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(input.Zone.X))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(input.Zone.Y))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(input.Zone.W))))
		off += 2
		binary.LittleEndian.PutUint16(buf[off:], uint16(int16(math.Round(input.Zone.H))))
		off += 2
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
