#pragma once

#include "game_types.h"

struct Map;

typedef struct {
    INT16 x;
    INT16 y;
    INT8 vel_x;
    INT8 vel_y;

    UINT8 x_subpixel;
    UINT8 vel_x_subpixel;

    UINT8 y_subpixel;
    INT16 y_speed_fp;
    UINT8 y_dir;

    UINT8 gravity_timer;

    UINT8 anim_frame;
    UINT8 anim_timer;
    UINT8 anim_speed;

    UINT8 accel_mode;

    BOOLEAN facing_left;
    BOOLEAN on_ground;
    BOOLEAN jumping;
    BOOLEAN is_moving;
    BOOLEAN sprinting;

    BOOLEAN in_water;
} Player;

#define PLAYER_JUMP_INIT_SPEED_FP_NORMAL ((INT16)936)
#define PLAYER_JUMP_INIT_SPEED_FP_WATER  ((INT16)336)

#define PLAYER_MAX_FALL_SPEED_FP_NORMAL ((INT16)(3 << 8) + 192)
#define PLAYER_MAX_FALL_SPEED_FP_WATER  PLAYER_MAX_FALL_SPEED_FP_NORMAL

#define PLAYER_GRAVITY_ACCEL_FP_NORMAL ((INT16)21)
#define PLAYER_GRAVITY_ACCEL_FP_WATER  ((INT16)6)

#define PLAYER_ACCEL_SUB        48
#define PLAYER_MAX_SPEED        2
#define PLAYER_MAX_SPEED_SUB    192
#define PLAYER_SPRINT_SPEED     4
#define PLAYER_SPRINT_SPEED_SUB 0
#define PLAYER_DECEL_SUB        64
#define PLAYER_HALF_WIDTH       8

#define PLAYER_COLLISION_W      (PLAYER_HALF_WIDTH * 2)
#define PLAYER_COLLISION_H      32
#define PLAYER_COLLISION_HALF_H (PLAYER_COLLISION_H / 2)

#define IDLE_SEQ_LEN        4
#define IDLE_ANIM_SPEED     30
#define IDLE_FRAMES_PER_DIR 3
#define IDLE_TILE_BASE      256
#define RUN_ANIM_SPEED      4
#define RUN_FRAMES_PER_DIR  10
#define JUMP_ANIM_SPEED     4
#define JUMP_FRAMES_PER_DIR 4

void player_init_state(Player* player, INT16 start_x, INT16 start_y);

void player_init(Player* player, INT16 start_x, INT16 start_y);

void player_update(Player* player);

#if defined(__SDCC)
void player_draw(const Player* player, INT16 screen_x, INT16 screen_y);
#endif

void player_input_left(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held);
void player_input_right(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held);
void player_input_none(Player* player, BOOLEAN just_released);
void player_input_jump(Player* player);
