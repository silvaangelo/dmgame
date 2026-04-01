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
	WeaponSniper     WeaponType = "sniper"
)

// GrenadeType represents grenade variants.
type GrenadeType string

const (
	GrenadeHE    GrenadeType = "grenade"
	GrenadeFlash GrenadeType = "flashbang"
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
	AimAngle         float64    `msgpack:"aimAngle"`
	Weapon           WeaponType `msgpack:"weapon"`
	Skin             int        `msgpack:"skin"`

	KillStreak   int    `msgpack:"-"`
	LastKilledBy string `msgpack:"-"`

	// Respawn
	WaitingForRespawn bool  `msgpack:"-"`
	DeathTime         int64 `msgpack:"-"`

	// Anti-cheat
	MsgCount         int   `msgpack:"-"`
	MsgWindowStart   int64 `msgpack:"-"`
	Violations       int   `msgpack:"-"`
	LastWeaponSwitch int64 `msgpack:"-"`

	// Per-weapon ammo state (each weapon keeps its own bullet count)
	WeaponAmmo map[WeaponType]int `msgpack:"-"`
	// Track which weapon is currently reloading (so switching cancels only that weapon's reload)
	ReloadingWeapon WeaponType `msgpack:"-"`

	// Reload timer
	ReloadTimer *time.Timer `msgpack:"-"`

	// Comeback mechanic (hidden underdog buff)
	IsUnderdog bool `msgpack:"-"`

	// MVP tracking
	TotalDamage int `msgpack:"-"`
	MaxStreak   int `msgpack:"-"`

	// Grenade cooldowns (ms timestamp of last throw)
	LastGrenadeTime   int64 `msgpack:"-"`
	LastFlashbangTime int64 `msgpack:"-"`

	// Throwing visual indicator
	ThrowingGrenade     bool        `msgpack:"-"`
	ThrowingGrenadeType GrenadeType `msgpack:"-"`
	ThrowStartTime      int64       `msgpack:"-"`
}

// Bullet represents a projectile in flight.
type Bullet struct {
	ID        string     `msgpack:"id"`
	ShortID   uint16     `msgpack:"shortId"`
	X         float64    `msgpack:"x"`
	Y         float64    `msgpack:"y"`
	DX        float64    `msgpack:"dx"`
	DY        float64    `msgpack:"dy"`
	PlayerID  string     `msgpack:"playerId"`
	Damage    int        `msgpack:"damage"`
	Weapon    WeaponType `msgpack:"weapon"`
	CreatedAt int64      `msgpack:"createdAt"`
}

// Obstacle represents a wall block.
type Obstacle struct {
	ID      string  `msgpack:"id"`
	X       float64 `msgpack:"x"`
	Y       float64 `msgpack:"y"`
	Size    float64 `msgpack:"size"`
	Type    string  `msgpack:"type,omitempty"`
	GroupID string  `msgpack:"groupId,omitempty"`
}

// Grenade represents a thrown grenade or flashbang in flight.
type Grenade struct {
	ID        string
	ShortID   uint16
	X         float64
	Y         float64
	DX        float64 // velocity X per tick
	DY        float64 // velocity Y per tick
	PlayerID  string
	GType     GrenadeType
	CreatedAt int64
	FuseTime  int64   // ms until detonation from creation
	Friction  float64 // deceleration factor per tick
}

// Game holds all state for a game instance.
type Game struct {
	mu sync.Mutex // protects all game state

	ID          string
	NextShortID uint16
	Players     []*Player
	Bullets     []*Bullet
	Grenades    []*Grenade
	Obstacles   []*Obstacle

	Started    bool
	RoundEnded bool

	StateSequence  uint32
	MatchStartTime int64

	// Round timer
	RoundStartTime int64

	// Tick control
	ticker *time.Ticker
	stopCh chan struct{}
}

// TrackedPlayer for the online players list.
type TrackedPlayer struct {
	ID       string
	Username string
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
	Timestamp  int64                `json:"timestamp"`
	Players    []MatchHistoryPlayer `json:"players"`
	WinnerName string               `json:"winnerName"`
}

// MatchHistoryPlayer for per-player match data.
type MatchHistoryPlayer struct {
	Username string `json:"username"`
	Kills    int    `json:"kills"`
	Deaths   int    `json:"deaths"`
	IsWinner bool   `json:"isWinner"`
}
