package main

import "regexp"

// GameConfig holds all game constants.
var GameConfig = struct {
	TickRate        int
	MaxPlayers      int
	MinPlayers      int
	QueueCountdown  int
	ReadyCountdown  int
	PlayerHP        int
	LMSPlayerHP     int
	PlayerSpeed     float64
	PlayerRadius    float64
	ShotsPerMag     int
	ShotCooldown    int64 // ms
	ReloadTime      int64
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
	// Knife
	KnifeCooldown   int64
	KnifeDamage     int
	KnifeRange      float64
	KnifeSpeedBonus float64
	// Sniper
	SniperCooldown    int64
	SniperDamage      int
	SniperBulletSpeed float64
	SniperAmmo        int
	// Headshot
	HeadshotMultiplier float64
	HeadshotZone       float64 // fraction of radius from center considered head (top portion)
	// Accuracy
	MachinegunBaseSpread float64
	MachinegunMoveSpread float64
	ShotgunMoveSpread    float64
	SniperBaseSpread     float64
	SniperMoveSpread     float64
	// Round
	KillsToWin    int
	GameDuration  int64
	RoundDuration int64
	RoundRestartDelay int64
	// Respawn
	RespawnTime int64
	// Obstacle spawn (legacy — unused)
	ObstacleSpawnInterval int64
	// Room
	RoomMaxPlayers   int
	RoomReadyTimeout int
	PreGameReadyTimeout int
	// Username
	UsernameMinLen int
	UsernameMaxLen int
	UsernamePattern *regexp.Regexp
}{
	TickRate:        40,
	MaxPlayers:      10,
	MinPlayers:      2,
	QueueCountdown:  10,
	ReadyCountdown:  3,
	PlayerHP:        100,
	LMSPlayerHP:     150,
	PlayerSpeed:     9,
	PlayerRadius:    20,
	ShotsPerMag:     35,
	ShotCooldown:    90,
	ReloadTime:      1950,
	MachinegunReloadTime: 1800,
	ShotgunReloadTime:    2200,
	SniperReloadTime:     2800,
	BulletSpeed:     30,
	BulletLifetime:  2500,
	ArenaWidth:      1600,
	ArenaHeight:     1600,
	// Machinegun (M4A4-like)
	MachinegunCooldown: 90,
	MachinegunDamage:   27,
	MachinegunRecoil:   0.06,
	// Shotgun (Nova-like)
	ShotgunCooldown: 900,
	ShotgunDamage:   26,
	ShotgunPellets:  5,
	ShotgunSpread:   0.35,
	ShotgunAmmo:     8,
	ShotgunBulletSpeed: 0.85,
	// Knife (CS2-style)
	KnifeCooldown:   400,
	KnifeDamage:     40,
	KnifeRange:      70,
	KnifeSpeedBonus: 1.6,
	// Sniper (AWP-like)
	SniperCooldown:    1500,
	SniperDamage:      115,
	SniperBulletSpeed: 48,
	SniperAmmo:        5,
	// Headshot
	HeadshotMultiplier: 2.0,  // double damage on headshot
	HeadshotZone:       0.35, // legacy — headshots now use sprite head position + 5px radius
	// Accuracy (radians of spread)
	MachinegunBaseSpread: 0.02,
	MachinegunMoveSpread: 0.06,
	ShotgunMoveSpread:    0.15,
	SniperBaseSpread:     0.002,
	SniperMoveSpread:     0.12,
	// Round
	KillsToWin:    999,
	GameDuration:  0,
	RoundDuration: 300000,
	RoundRestartDelay: 10000,
	// Respawn
	RespawnTime: 5000,
	// Obstacle spawn
	ObstacleSpawnInterval: 8000,
	// Room
	RoomMaxPlayers:   10,
	RoomReadyTimeout: 45,
	PreGameReadyTimeout: 15,
	// Username
	UsernameMinLen: 2,
	UsernameMaxLen: 16,
	UsernamePattern: regexp.MustCompile(`^[a-zA-Z0-9_]+$`),
}

// WeaponCycle is the order of weapons when cycling.
var WeaponCycle = []WeaponType{WeaponMachinegun, WeaponShotgun, WeaponSniper}

// CurrentMapName holds the name of the active map (sent to clients for display).
var CurrentMapName = ""
