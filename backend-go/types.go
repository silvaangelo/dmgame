package main

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WeaponType represents the weapon a player is holding.
type WeaponType string

const (
	WeaponMachinegun WeaponType = "machinegun"
	WeaponShotgun    WeaponType = "shotgun"
	WeaponKnife      WeaponType = "knife"
	WeaponMinigun    WeaponType = "minigun"
	WeaponSniper     WeaponType = "sniper"
)

// GameMode for the match.
type GameMode string

const (
	GameModeDeathmatch GameMode = "deathmatch"
)

// Keys tracks WASD input state.
type Keys struct {
	W bool `msgpack:"w"`
	A bool `msgpack:"a"`
	S bool `msgpack:"s"`
	D bool `msgpack:"d"`
}

// Player represents a connected player in the game.
type Player struct {
	ID       string          `msgpack:"id"`
	ShortID  uint16          `msgpack:"shortId"`
	Username string          `msgpack:"username"`
	Conn     *websocket.Conn `msgpack:"-"`
	ConnMu   sync.Mutex      `msgpack:"-"`

	Team             int        `msgpack:"team"`
	X                float64    `msgpack:"x"`
	Y                float64    `msgpack:"y"`
	HP               int        `msgpack:"hp"`
	Shots            int        `msgpack:"shots"`
	Reloading        bool       `msgpack:"reloading"`
	LastShotTime     int64      `msgpack:"-"` // ms timestamp
	Keys             Keys       `msgpack:"-"`
	LastProcessedInput int      `msgpack:"lastProcessedInput"`
	Kills            int        `msgpack:"kills"`
	Deaths           int        `msgpack:"deaths"`
	Score            int        `msgpack:"score"`
	Ready            bool       `msgpack:"ready"`
	AimAngle         float64    `msgpack:"aimAngle"`
	Weapon           WeaponType `msgpack:"weapon"`
	Skin             int        `msgpack:"skin"`

	SpeedBoostUntil int64 `msgpack:"-"`
	MinigunUntil    int64 `msgpack:"-"`
	KillStreak      int   `msgpack:"-"`
	LastKilledBy    string `msgpack:"-"`

	// Powerup states
	ShieldUntil    int64 `msgpack:"-"`
	InvisibleUntil int64 `msgpack:"-"`
	RegenUntil     int64 `msgpack:"-"`
	LastRegenTick  int64 `msgpack:"-"`

	// Armor
	Armor int `msgpack:"armor"`

	// Respawn
	WaitingForRespawn bool `msgpack:"-"`

	// Dash
	DashCooldownUntil int64   `msgpack:"-"`
	DashUntil         int64   `msgpack:"-"`
	DashDirX          float64 `msgpack:"-"`
	DashDirY          float64 `msgpack:"-"`

	// Anti-cheat
	MsgCount         int   `msgpack:"-"`
	MsgWindowStart   int64 `msgpack:"-"`
	Violations       int   `msgpack:"-"`
	LastWeaponSwitch int64 `msgpack:"-"`

	// Reload timer
	ReloadTimer *time.Timer `msgpack:"-"`
}

// Bullet represents a projectile in flight.
type Bullet struct {
	ID        string     `msgpack:"id"`
	ShortID   uint16     `msgpack:"shortId"`
	X         float64    `msgpack:"x"`
	Y         float64    `msgpack:"y"`
	DX        float64    `msgpack:"dx"`
	DY        float64    `msgpack:"dy"`
	Team      int        `msgpack:"team"`
	PlayerID  string     `msgpack:"playerId"`
	Damage    int        `msgpack:"damage"`
	Weapon    WeaponType `msgpack:"weapon"`
	CreatedAt int64      `msgpack:"createdAt"`
}

// Obstacle represents a wall block or tree.
type Obstacle struct {
	ID        string `msgpack:"id"`
	X         float64 `msgpack:"x"`
	Y         float64 `msgpack:"y"`
	Size      float64 `msgpack:"size"`
	Destroyed bool   `msgpack:"destroyed"`
	Type      string `msgpack:"type,omitempty"`
	GroupID   string `msgpack:"groupId,omitempty"`
}

// Bomb represents a timed explosive.
type Bomb struct {
	ID        string  `msgpack:"id"`
	X         float64 `msgpack:"x"`
	Y         float64 `msgpack:"y"`
	CreatedAt int64   `msgpack:"createdAt"`
}

// Lightning represents a lightning strike warning.
type Lightning struct {
	ID        string  `msgpack:"id"`
	X         float64 `msgpack:"x"`
	Y         float64 `msgpack:"y"`
	CreatedAt int64   `msgpack:"createdAt"`
}

// PickupType for collectible items.
type PickupType string

const (
	PickupHealth       PickupType = "health"
	PickupAmmo         PickupType = "ammo"
	PickupSpeed        PickupType = "speed"
	PickupMinigun      PickupType = "minigun"
	PickupShield       PickupType = "shield"
	PickupInvisibility PickupType = "invisibility"
	PickupRegen        PickupType = "regen"
	PickupArmor        PickupType = "armor"
)

// Pickup represents a collectible item on the map.
type Pickup struct {
	ID        string     `msgpack:"id"`
	ShortID   uint16     `msgpack:"shortId"`
	X         float64    `msgpack:"x"`
	Y         float64    `msgpack:"y"`
	Type      PickupType `msgpack:"type"`
	CreatedAt int64      `msgpack:"createdAt"`
}

// Orb represents a score orb (slither-style).
type Orb struct {
	ID        string  `msgpack:"id"`
	ShortID   uint16  `msgpack:"shortId"`
	X         float64 `msgpack:"x"`
	Y         float64 `msgpack:"y"`
	CreatedAt int64   `msgpack:"createdAt"`
}

// LootCrate represents a destructible crate.
type LootCrate struct {
	ID        string  `msgpack:"id"`
	ShortID   uint16  `msgpack:"shortId"`
	X         float64 `msgpack:"x"`
	Y         float64 `msgpack:"y"`
	HP        int     `msgpack:"hp"`
	CreatedAt int64   `msgpack:"createdAt"`
}

// Zone represents the shrinking play area.
type Zone struct {
	X float64
	Y float64
	W float64
	H float64
}

// Game holds all state for a game instance.
type Game struct {
	mu sync.Mutex // protects all game state

	ID          string
	NextShortID uint16
	Players     []*Player
	Bullets     []*Bullet
	Obstacles   []*Obstacle
	Pickups     []*Pickup
	Orbs        []*Orb
	Bombs       []*Bomb
	Lightnings  []*Lightning
	LootCrates  []*LootCrate

	Started    bool
	RoundEnded bool
	GameMode   GameMode

	StateSequence uint32
	MatchStartTime int64

	// Zone
	Zone         Zone
	ZoneShrinking bool

	// Spawn timing (checked in game tick)
	LastObstacleSpawn  int64
	LastPickupSpawn    int64
	LastOrbSpawn       int64
	LastBombSpawn      int64
	LastLightningSpawn int64
	LastCrateSpawn     int64
	NextBombDelay      int64 // randomized
	NextLightningDelay int64 // randomized

	// Round timer
	RoundStartTime int64
	LastTimerBroadcast int64

	// Tick control
	ticker     *time.Ticker
	stopCh     chan struct{}
}

// Room for lobby/matchmaking (largely unused in persistent mode).
type Room struct {
	ID               string
	Name             string
	Players          []*Player
	CountdownStarted bool
	TimeRemaining    int
	GameModeVotes    map[string]string
}

// TrackedPlayer for the online players list.
type TrackedPlayer struct {
	ID       string
	Username string
	Status   string // "online", "in-room", "in-game"
	Conn     *websocket.Conn
	ConnMu   *sync.Mutex
}

// PlayerStats for persistent stats.
type PlayerStats struct {
	Username    string `json:"username"`
	Kills       int    `json:"kills"`
	Deaths      int    `json:"deaths"`
	Wins        int    `json:"wins"`
	Losses      int    `json:"losses"`
	GamesPlayed int    `json:"gamesPlayed"`
	MMR         int    `json:"mmr"`
}

// MatchHistoryEntry for match records.
type MatchHistoryEntry struct {
	Timestamp int64                  `json:"timestamp"`
	Players   []MatchHistoryPlayer   `json:"players"`
	WinnerName string               `json:"winnerName"`
}

// MatchHistoryPlayer for per-player match data.
type MatchHistoryPlayer struct {
	Username string `json:"username"`
	Kills    int    `json:"kills"`
	Deaths   int    `json:"deaths"`
	IsWinner bool   `json:"isWinner"`
}

// RegisteredUser for user accounts.
type RegisteredUser struct {
	Username  string `json:"username"`
	Token     string `json:"token"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
}
