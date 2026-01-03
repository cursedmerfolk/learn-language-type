#pragma once

#include "game_types.h"

// Forward decl to avoid including map.h from the header.
struct Map;

// Player state
typedef struct {
    INT16 x;              // World X position (pixels)
    INT16 y;              // World Y position (pixels)
    INT8 vel_x;           // Horizontal velocity (pixels per frame)
    INT8 vel_y;           // Vertical velocity (pixels per frame) (legacy; to be removed once fully migrated)
    
    // Subpixel precision for smooth movement (Super Metroid style)
    UINT8 x_subpixel;     // Subpixel position (0-255)
    UINT8 vel_x_subpixel; // Subpixel velocity accumulator

    // Super Metroid-style vertical physics (8.8 fixed point)
    UINT8 y_subpixel;     // Subpixel position (0-255)
    INT16 y_speed_fp;     // Magnitude-style speed in 8.8; sign used for underflow detection
    UINT8 y_dir;          // 1 = rising, 2 = falling

    UINT8 gravity_timer;  // Counts frames between gravity applications

    UINT8 anim_frame;     // Current animation frame
    UINT8 anim_timer;     // Animation timer
    UINT8 anim_speed;     // Current animation speed (frames per update)
    
    // Acceleration state: 0=accelerating right, 1=accelerating left, 2=decelerating
    UINT8 accel_mode;

    // FUTURE: store in 1 byte using bitfields
    BOOLEAN facing_left;  // 1 = facing left (default), 0 = facing right
    BOOLEAN on_ground;      // 1 = on ground, 0 = in air
    BOOLEAN jumping;        // 1 = jump button held, 0 = not jumping
    BOOLEAN is_moving;      // 1 = moving, 0 = idle
    BOOLEAN sprinting;      // 1 = sprint button (A) held while running

    // Physics environment
    BOOLEAN in_water;       // 1 = water physics, 0 = normal (out of water)
} Player;

// Player constants
// Vertical movement (Super Metroid style in 8.8 fixed point, scaled for 12x12 tiles)
// Super Metroid derives gravity acceleration from Samus_DetermineAccel_Y():
// - Normal (out of water): samus_y_subaccel = 0x1c00
// - Water:                samus_y_subaccel = 0x0800
// and jump takeoff speed from Samus_InitJump() (no Gravity Suit):
// - Normal: 4 + 0xE000/65536 = 4.875 px/frame
// - Water:  1 + 0xC000/65536 = 1.75  px/frame
// Then scale by 3/4 for this project's 12x12 tiles, then convert to 8.8.

// Jump takeoff speed (magnitude)
#define PLAYER_JUMP_INIT_SPEED_FP_NORMAL ((INT16)936)  // 4.875 * 0.75 * 256 = 936 (3.65625 px/frame)
#define PLAYER_JUMP_INIT_SPEED_FP_WATER  ((INT16)336)  // 1.75  * 0.75 * 256 = 336 (1.3125  px/frame)

// Terminal fall speed
// NOTE: In Super Metroid, Samus_MoveY_WithSpeedCalc stops applying gravity once samus_y_speed reaches 5,
// regardless of liquid. So we keep the same terminal velocity in water; only accel changes.
#define PLAYER_MAX_FALL_SPEED_FP_NORMAL ((INT16)(3 << 8) + 192)  // 5.0 * 0.75 = 3.75 px/frame
#define PLAYER_MAX_FALL_SPEED_FP_WATER  PLAYER_MAX_FALL_SPEED_FP_NORMAL

// Gravity acceleration
#define PLAYER_GRAVITY_ACCEL_FP_NORMAL ((INT16)21)  // 0x1c00 -> 0.109375 px/f^2; *0.75*256 ~= 21
#define PLAYER_GRAVITY_ACCEL_FP_WATER  ((INT16)6)   // 0x0800 -> 0.03125  px/f^2; *0.75*256 ~= 6

// Horizontal movement (Super Metroid style with 3/4 scaling for 12x12 tiles)
// Values are scaled from SNES (16x16) to GB (12x12) = multiply by 0.75
// Using subpixel (256ths) for smooth acceleration
#define PLAYER_ACCEL_SUB        48   // Subpixel accel (48/256 ≈ 0.19 px/frame²)
#define PLAYER_MAX_SPEED        2    // Normal max speed in pixels/frame
#define PLAYER_MAX_SPEED_SUB    192  // Subpixel component (total: 2.75 px/frame)
#define PLAYER_SPRINT_SPEED     4    // Sprint max speed (holding A while running)
#define PLAYER_SPRINT_SPEED_SUB 0    // Sprint subpixel (total: 4.0 px/frame)
#define PLAYER_DECEL_SUB        64   // Subpixel decel (64/256 = 0.25 px/frame²)
#define PLAYER_HALF_WIDTH       8    // Half width of the player sprite

// Collision box (in world pixels). X is stored as left edge; Y is stored as pivot/center.
#define PLAYER_COLLISION_W      (PLAYER_HALF_WIDTH * 2)
#define PLAYER_COLLISION_H      32
#define PLAYER_COLLISION_HALF_H (PLAYER_COLLISION_H / 2)

// animations
#define IDLE_SEQ_LEN        4    // Ping-pong steps: 0,1,2,1
#define IDLE_ANIM_SPEED     30   // Frames between animation updates
#define IDLE_FRAMES_PER_DIR 3    // Idle unique frames per direction (0,1,2)
#define IDLE_TILE_BASE      256  //
#define RUN_ANIM_SPEED      4    // Frames between animation updates
#define RUN_FRAMES_PER_DIR  10   // Number of frames per direction in run anim
#define JUMP_ANIM_SPEED     4    // Frames between animation updates
#define JUMP_FRAMES_PER_DIR 4    // Half frames in jump sequence

// Initialize player
// Core, no-GBDK init (no VRAM/sprite setup).
void player_init_state(Player* player, INT16 start_x, INT16 start_y);

// Convenience init used by the game. On GBDK/SDCC builds this also loads sprite data;
// on host builds it's equivalent to player_init_state().
void player_init(Player* player, INT16 start_x, INT16 start_y);

// Core update (no Map/GBDK dependency). Pass NULL to disable collision.
void player_update(Player* player);

// Rendering uses GBDK metasprite APIs.
#if defined(__SDCC)
void player_draw(const Player* player, INT16 screen_x, INT16 screen_y);
#endif

// Handle player input
void player_input_left(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held);
void player_input_right(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held);
void player_input_none(Player* player, BOOLEAN just_released);
void player_input_jump(Player* player);
