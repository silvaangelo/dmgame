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
	Ready            bool       `msgpack:"ready"`
	AimAngle         float64    `msgpack:"aimAngle"`
	Weapon           WeaponType `msgpack:"weapon"`
	Skin             int        `msgpack:"skin"`

	SpeedBoostUntil int64 `msgpack:"-"`
	KillStreak      int   `msgpack:"-"`
	LastKilledBy    string `msgpack:"-"`

	// Respawn
	WaitingForRespawn bool  `msgpack:"-"`
	DeathTime         int64 `msgpack:"-"`

	// Anti-cheat
	MsgCount         int   `msgpack:"-"`
	MsgWindowStart   int64 `msgpack:"-"`
	Violations       int   `msgpack:"-"`
	LastWeaponSwitch int64 `msgpack:"-"`

	// Reload timer
	ReloadTimer *time.Timer `msgpack:"-"`

	// Comeback mechanic (hidden underdog buff)
	IsUnderdog bool `msgpack:"-"`

	// MVP tracking
	TotalDamage int `msgpack:"-"`
	MaxStreak   int `msgpack:"-"`
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
	ShooterMoving bool   `msgpack:"-"` // CS2: was shooter moving when firing?
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

// Game holds all state for a game instance.
type Game struct {
	mu sync.Mutex // protects all game state

	ID          string
	NextShortID uint16
	Players     []*Player
	Bullets     []*Bullet
	Obstacles   []*Obstacle

	Started    bool
	RoundEnded bool
	GameMode   GameMode

	StateSequence uint32
	MatchStartTime int64

	// Spawn timing (checked in game tick)
	LastObstacleSpawn  int64

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
