package main

import "regexp"

// GameConfig holds all game constants.
var GameConfig = struct {
	TickRate        int
	MaxPlayers      int
	PlayerHP        int
	PlayerSpeed     float64
	PlayerRadius    float64
	ShotsPerMag     int
	MachinegunReloadTime int64
	ShotgunReloadTime    int64
	SniperReloadTime     int64
	BulletSpeed     float64
	BulletLifetime  int64
	ArenaWidth      float64
	ArenaHeight     float64
	// Machinegun
	MachinegunCooldown int64
	MachinegunDamage   int
	MachinegunRecoil   float64
	// Shotgun
	ShotgunCooldown int64
	ShotgunDamage   int
	ShotgunPellets  int
	ShotgunSpread   float64
	ShotgunAmmo     int
	ShotgunBulletSpeed float64
	// Sniper
	SniperCooldown    int64
	SniperDamage      int
	SniperBulletSpeed float64
	SniperAmmo        int
	// Headshot
	HeadshotMultiplier float64
	// Accuracy
	MachinegunBaseSpread float64
	MachinegunMoveSpread float64
	ShotgunMoveSpread    float64
	SniperBaseSpread     float64
	SniperMoveSpread     float64
	// Round
	RoundDuration     int64
	RoundRestartDelay int64
	// Respawn
	RespawnTime int64
	// Grenades
	GrenadeCooldown      int64   // ms between throws (15s)
	GrenadeFuseMin       int64   // minimum fuse time ms (short press)
	GrenadeFuseMax       int64   // maximum fuse time ms (long press)
	GrenadeSpeed         float64 // initial throw speed
	GrenadeFriction      float64 // velocity multiplier per tick (deceleration)
	GrenadeDamage        int     // HE grenade max damage
	GrenadeRadius        float64 // explosion radius
	FlashbangRadius      float64 // flashbang effect radius
	GrenadeChargeRate    float64 // ms per charge unit (longer press = more fuse)
	// Username
	UsernameMinLen int
	UsernameMaxLen int
	UsernamePattern *regexp.Regexp
}{
	TickRate:        40,
	MaxPlayers:      10,
	PlayerHP:        100,
	PlayerSpeed:     10.5,
	PlayerRadius:    20,
	ShotsPerMag:     35,
	MachinegunReloadTime: 1800,
	ShotgunReloadTime:    2200,
	SniperReloadTime:     2800,
	BulletSpeed:     30,
	BulletLifetime:  2500,
	ArenaWidth:      1600,
	ArenaHeight:     1600,
	// Machinegun (M4A4-like)
	MachinegunCooldown: 90,
	MachinegunDamage:   29,
	MachinegunRecoil:   0.06,
	// Shotgun (Nova-like)
	ShotgunCooldown: 900,
	ShotgunDamage:   26,
	ShotgunPellets:  5,
	ShotgunSpread:   0.35,
	ShotgunAmmo:     8,
	ShotgunBulletSpeed: 0.85,
	// Sniper (AWP-like)
	SniperCooldown:    1500,
	SniperDamage:      115,
	SniperBulletSpeed: 48,
	SniperAmmo:        5,
	// Headshot
	HeadshotMultiplier: 2.0,
	// Accuracy (radians of spread)
	MachinegunBaseSpread: 0.02,
	MachinegunMoveSpread: 0.06,
	ShotgunMoveSpread:    0.15,
	SniperBaseSpread:     0.002,
	SniperMoveSpread:     0.12,
	// Round
	RoundDuration:     300000,
	RoundRestartDelay: 10000,
	// Respawn
	RespawnTime: 5000,
	// Grenades
	GrenadeCooldown:      15000,
	GrenadeFuseMin:       600,
	GrenadeFuseMax:       2000,
	GrenadeSpeed:         18.0,
	GrenadeFriction:      0.94,
	GrenadeDamage:        70,
	GrenadeRadius:        250.0,
	FlashbangRadius:      200.0,
	GrenadeChargeRate:    1.0,
	// Username
	UsernameMinLen: 2,
	UsernameMaxLen: 16,
	UsernamePattern: regexp.MustCompile(`^[a-zA-Z0-9_]+$`),
}

// WeaponCycle is the order of weapons when cycling.
var WeaponCycle = []WeaponType{WeaponMachinegun, WeaponShotgun, WeaponSniper}

// CurrentMapName holds the name of the active map (sent to clients for display).
var CurrentMapName = ""
