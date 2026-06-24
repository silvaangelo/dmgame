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
	GrenadeCooldown      int64   // ms between throws (2s)
	MaxGrenades          int     // max grenades of each type a player can hold
	GrenadeRechargeTime  int64   // ms to recharge one grenade after throwing
	GrenadeFuseMin       int64   // minimum fuse time ms (short press)
	GrenadeFuseMax       int64   // maximum fuse time ms (long press)
	GrenadeSpeed         float64 // initial throw speed
	GrenadeThrowSpeedMin float64 // speed multiplier at zero charge (quick tap)
	GrenadeThrowSpeedMax float64 // speed multiplier at full charge (long hold)
	GrenadeFriction      float64 // velocity multiplier per tick (deceleration)
	GrenadeDamage        int     // HE grenade max damage
	GrenadeRadius        float64 // explosion radius
	FlashbangRadius      float64 // flashbang effect radius
	GrenadeChargeRate    float64 // ms per charge unit (longer press = more fuse)
	// Username
	UsernameMinLen int
	UsernameMaxLen int
	UsernamePattern *regexp.Regexp
	// Movement physics (acceleration/deceleration)
	PlayerAcceleration    float64
	PlayerFriction        float64
	// Dodge roll
	DodgeRollSpeed        float64
	DodgeRollDuration     int64
	DodgeRollCooldown     int64
	// Crouch
	CrouchSpeedMult       float64
	CrouchSpreadMult      float64
	// Tagging (slow on hit)
	TagDuration           int64
	TagSpeedMult          float64
	// Counter-strafe
	CounterStrafeFrames   int
	// Bullet penetration
	PenetrationDamageMult float64
	// Respawn shimmer
	RespawnShimmerDuration int64
	// Grim Reaper random event
	ReaperMinMatchTime     int64   // ms into match before the event can trigger
	ReaperSpawnChanceBase  float64 // per-second spawn probability right after MinMatchTime
	ReaperSpawnChanceRamp  float64 // added to probability for each extra second elapsed
	ReaperSpawnChanceMax   float64 // cap on per-second spawn probability
	ReaperMinPlayers       int     // minimum alive players required to trigger
	ReaperBaseHP           int     // base HP (1 player)
	ReaperHPPerPlayer      int     // extra HP per additional alive player
	ReaperSpeed            float64 // movement speed per tick (much faster than players)
	ReaperRadius           float64 // collision/body radius
	ReaperAttackRange      float64 // distance within which it can melee
	ReaperAttackBaseDamage int     // base melee damage (1 player)
	ReaperAttackDmgPerPlr  int     // extra melee damage per additional alive player
	ReaperAttackCooldown   int64   // ms between melee swings
	ReaperAttackWindup     int64   // ms telegraph before a swing lands
	ReaperSpawnDuration    int64   // ms telegraph/fade-in before it becomes active
	ReaperDeathDuration    int64   // ms death animation before cleanup
	ReaperKnockbackPerHit  float64 // velocity added per bullet hit
	ReaperKnockbackMax     float64 // cap on accumulated knockback velocity
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
	GrenadeCooldown:      2000,
	MaxGrenades:          2,
	GrenadeRechargeTime:  15000,
	GrenadeFuseMin:       600,
	GrenadeFuseMax:       3000,
	GrenadeSpeed:         30.0,
	GrenadeThrowSpeedMin: 0.3,
	GrenadeThrowSpeedMax: 1.4,
	GrenadeFriction:      0.94,
	GrenadeDamage:        70,
	GrenadeRadius:        350.0,
	FlashbangRadius:      350.0,
	GrenadeChargeRate:    1.0,
	// Username
	UsernameMinLen: 2,
	UsernameMaxLen: 16,
	UsernamePattern: regexp.MustCompile(`^[a-zA-Z0-9_]+$`),
	// Movement physics
	PlayerAcceleration:     0.50,
	PlayerFriction:         0.70,
	// Dodge roll
	DodgeRollSpeed:         21.0,
	DodgeRollDuration:      150,
	DodgeRollCooldown:      3000,
	// Crouch
	CrouchSpeedMult:        0.4,
	CrouchSpreadMult:       0.5,
	// Tagging
	TagDuration:            400,
	TagSpeedMult:           0.7,
	// Counter-strafe
	CounterStrafeFrames:    2,
	// Bullet penetration
	PenetrationDamageMult:  0.4,
	// Respawn shimmer
	RespawnShimmerDuration: 1500,
	// Grim Reaper random event
	ReaperMinMatchTime:     15000, // 15s
	ReaperSpawnChanceBase:  0.025, // ~2.5% per second right after 15s
	ReaperSpawnChanceRamp:  0.0015, // grows the longer the round runs
	ReaperSpawnChanceMax:   0.20,  // capped at 20% per second
	ReaperMinPlayers:       2,
	ReaperBaseHP:           1000,
	ReaperHPPerPlayer:      750,
	ReaperSpeed:            15.0, // ~1.5x player speed
	ReaperRadius:           30,
	ReaperAttackRange:      62,
	ReaperAttackBaseDamage: 55,
	ReaperAttackDmgPerPlr:  12,
	ReaperAttackCooldown:   850,
	ReaperAttackWindup:     260,
	ReaperSpawnDuration:    2500, // matches the start sound length
	ReaperDeathDuration:    1200,
	ReaperKnockbackPerHit:  2.2,
	ReaperKnockbackMax:     14.0,
}

// WeaponCycle is the order of weapons when cycling.
var WeaponCycle = []WeaponType{WeaponMachinegun, WeaponShotgun, WeaponSniper}

// CurrentMapName holds the name of the active map (sent to clients for display).
var CurrentMapName = ""
