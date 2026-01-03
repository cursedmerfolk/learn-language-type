#include "player.h"

#include "map.h"
#include <string.h>

#if defined(__SDCC)
#include <gb/gb.h>
#include <gbdk/platform.h>
#include <gbdk/metasprites.h>

BANKREF_EXTERN(player_animations)
extern const palette_color_t player_animations_palettes[];
extern const uint8_t player_animations_tiles[];
extern const metasprite_t* const player_animations_metasprites[];

#define PLAYER_ANIM_TILES_COUNT ((UINT8)80u)
#define PLAYER_ANIM_PALETTE_COUNT ((UINT8)7u)
#endif

const UINT8 idle_sequence[IDLE_SEQ_LEN] = {0, 1, 2, 1};

void player_init_state(Player* player, INT16 start_x, INT16 start_y) {
    player->x = start_x;
    player->y = start_y;
    player->vel_x = 0;
    player->vel_y = 0;
    player->x_subpixel = 0;
    player->vel_x_subpixel = 0;
    player->y_subpixel = 0;
    player->y_speed_fp = 0;
    player->y_dir = 2;
    player->accel_mode = 2;
    player->facing_left = 1;
    player->on_ground = 0;
    player->jumping = 0;
    player->is_moving = 0;
    player->sprinting = 0;
    player->in_water = 0;
    player->anim_frame = 0;
    player->anim_timer = 0;
    player->anim_speed = IDLE_ANIM_SPEED;
}

void player_init(Player* player, INT16 start_x, INT16 start_y) {
    player_init_state(player, start_x, start_y);

#if defined(__SDCC)

    {
        UINT8 old_bank = _current_bank;
        SWITCH_ROM(BANK(player_animations));
        set_sprite_data(IDLE_TILE_BASE, PLAYER_ANIM_TILES_COUNT, player_animations_tiles);
        set_sprite_palette(0, PLAYER_ANIM_PALETTE_COUNT, player_animations_palettes);
        SWITCH_ROM(old_bank);
    }
#endif
}

void player_input_left(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held) {
    player->facing_left = 1;

    player->accel_mode = 1;

    player->sprinting = sprint_held && player->on_ground;

    if (just_pressed) {
        player->is_moving = 1;
        player->anim_timer = 0;
        player->anim_frame = 0;
        player->anim_speed = RUN_ANIM_SPEED;
    }
}

void player_input_right(Player* player, BOOLEAN just_pressed, BOOLEAN sprint_held) {
    player->facing_left = 0;

    player->accel_mode = 0;

    player->sprinting = sprint_held && player->on_ground;

    if (just_pressed) {
        player->is_moving = 1;
        player->anim_timer = 0;
        player->anim_frame = 0;
        player->anim_speed = RUN_ANIM_SPEED;
    }
}

void player_input_none(Player* player, BOOLEAN just_released) {

    player->accel_mode = 2;
    player->sprinting = 0;

    if (just_released) {
        player->anim_timer = 0;
        player->anim_frame = 0;
        player->anim_speed = IDLE_ANIM_SPEED;
    }
}

void player_input_jump(Player* player) {
    if (player->on_ground) {
        player->on_ground = 0;
        player->y_dir = 1;
        player->y_speed_fp = player->in_water ? PLAYER_JUMP_INIT_SPEED_FP_WATER : PLAYER_JUMP_INIT_SPEED_FP_NORMAL;
        player->anim_frame = 2;
        player->anim_timer = 0;
        player->anim_speed = JUMP_ANIM_SPEED;

    }
}

static void player_apply_y_displacement_fp(Player* player, INT16 amt_fp) {
    if (amt_fp == 0)
        return;

    if (amt_fp > 0) {

        UINT16 frac_sum = (UINT16)player->y_subpixel + (UINT8)amt_fp;
        player->y += (amt_fp >> 8);
        if (frac_sum >= 256) {
            player->y++;
            frac_sum -= 256;
        }
        player->y_subpixel = (UINT8)frac_sum;
    } else {

        UINT16 pos_fp = (UINT16)(-amt_fp);
        UINT8 frac = (UINT8)pos_fp;
        player->y -= (INT16)(pos_fp >> 8);
        if (player->y_subpixel < frac) {
            player->y--;
            player->y_subpixel = (UINT8)(256 + player->y_subpixel - frac);
        } else {
            player->y_subpixel = (UINT8)(player->y_subpixel - frac);
        }
    }
}

static void player_check_start_falling(Player* player) {
    if (player->y_dir == 1 && player->y_speed_fp < 0) {
        player->y_speed_fp = 0;
        player->y_dir = 2;
    }
}

static void player_move_y_with_speed_calc(Player* player) {
    INT16 amt_fp = player->y_speed_fp;

    INT16 gravity_accel_fp = player->in_water ? PLAYER_GRAVITY_ACCEL_FP_WATER : PLAYER_GRAVITY_ACCEL_FP_NORMAL;
    INT16 max_fall_speed_fp = player->in_water ? PLAYER_MAX_FALL_SPEED_FP_WATER : PLAYER_MAX_FALL_SPEED_FP_NORMAL;

    if (player->y_dir == 2) {

        if (player->y_speed_fp < max_fall_speed_fp) {
            INT16 next = player->y_speed_fp + gravity_accel_fp;
            player->y_speed_fp = (next > max_fall_speed_fp) ? max_fall_speed_fp : next;
        }
    } else {

        player->y_speed_fp -= gravity_accel_fp;
    }

    if (player->y_dir != 2)
    {
        amt_fp = -amt_fp;
    }

    player_apply_y_displacement_fp(player, amt_fp);
}

static void player_calc_horizontal_speed(Player* player) {
    UINT16 temp_subpixel;
    INT8 temp_speed;

    if (player->accel_mode == 2) {

        if (player->vel_x > 0) {

            temp_subpixel = player->vel_x_subpixel;
            if (temp_subpixel < PLAYER_DECEL_SUB) {

                if (player->vel_x > 0) {
                    player->vel_x--;
                    temp_subpixel += 256;
                }
            }
            temp_subpixel -= PLAYER_DECEL_SUB;
            player->vel_x_subpixel = (UINT8)temp_subpixel;

            if (player->vel_x == 0 && player->vel_x_subpixel == 0) {
                player->is_moving = 0;
            }
        } else if (player->vel_x < 0) {

            temp_subpixel = player->vel_x_subpixel;
            if (temp_subpixel < PLAYER_DECEL_SUB) {

                player->vel_x++;
                temp_subpixel += 256;
            }
            temp_subpixel -= PLAYER_DECEL_SUB;
            player->vel_x_subpixel = (UINT8)temp_subpixel;

            if (player->vel_x == 0) {
                player->vel_x_subpixel = 0;
            }

            if (player->vel_x == 0 && player->vel_x_subpixel == 0) {
                player->is_moving = 0;
            }
        } else if (player->vel_x_subpixel != 0) {

            if (player->vel_x_subpixel <= PLAYER_DECEL_SUB) {
                player->vel_x_subpixel = 0;
            } else {
                player->vel_x_subpixel -= PLAYER_DECEL_SUB;
            }
            if (player->vel_x_subpixel == 0) {
                player->is_moving = 0;
            }
        }
    } else if (player->accel_mode == 0) {

        temp_subpixel = player->vel_x_subpixel + PLAYER_ACCEL_SUB;
        temp_speed = player->vel_x;

        if (temp_subpixel >= 256) {
            temp_speed++;
            temp_subpixel -= 256;
        }

        INT8 max_speed = player->sprinting ? PLAYER_SPRINT_SPEED : PLAYER_MAX_SPEED;
        UINT8 max_speed_sub = player->sprinting ? PLAYER_SPRINT_SPEED_SUB : PLAYER_MAX_SPEED_SUB;

        if (temp_speed > max_speed ||
            (temp_speed == max_speed && temp_subpixel > max_speed_sub)) {
            temp_speed = max_speed;
            temp_subpixel = max_speed_sub;
        }

        player->vel_x = temp_speed;
        player->vel_x_subpixel = (UINT8)temp_subpixel;
    } else {

        temp_subpixel = player->vel_x_subpixel + PLAYER_ACCEL_SUB;
        temp_speed = player->vel_x;

        if (temp_subpixel >= 256) {

            temp_speed--;
            temp_subpixel -= 256;
        }

        INT8 max_speed = player->sprinting ? PLAYER_SPRINT_SPEED : PLAYER_MAX_SPEED;
        UINT8 max_speed_sub = player->sprinting ? PLAYER_SPRINT_SPEED_SUB : PLAYER_MAX_SPEED_SUB;

        if (temp_speed < -max_speed ||
            (temp_speed == -max_speed && temp_subpixel > max_speed_sub)) {
            temp_speed = -max_speed;
            temp_subpixel = max_speed_sub;
        }

        player->vel_x = temp_speed;
        player->vel_x_subpixel = (UINT8)temp_subpixel;
    }
}

static void player_resolve_horizontal_collision(Player* player, INT16 old_x) {
    INT16 dx = player->x - old_x;
    if (dx == 0) {
        return;
    }

    INT16 top = player->y - PLAYER_COLLISION_HALF_H;
    INT16 bottom = top + (PLAYER_COLLISION_H - 1);

    if (dx > 0) {
        INT16 right = player->x + (PLAYER_COLLISION_W - 1);
        INT16 tile_x = right >> 3;
        INT16 ty0 = top >> 3;
        INT16 ty1 = bottom >> 3;
        for (INT16 tile_y = ty0; tile_y <= ty1; ++tile_y) {
            if (map_is_solid_at(tile_x, tile_y)) {
                player->x = (INT16)(tile_x * 8 - PLAYER_COLLISION_W);
                player->x_subpixel = 0;
                player->vel_x = 0;
                player->vel_x_subpixel = 0;
                player->accel_mode = 2;
                return;
            }
        }
    } else {
        INT16 left = player->x;
        INT16 tile_x = left >> 3;
        INT16 ty0 = top >> 3;
        INT16 ty1 = bottom >> 3;
        for (INT16 tile_y = ty0; tile_y <= ty1; ++tile_y) {
            if (map_is_solid_at(tile_x, tile_y)) {
                player->x = (INT16)((tile_x + 1) * 8);
                player->x_subpixel = 0;
                player->vel_x = 0;
                player->vel_x_subpixel = 0;
                player->accel_mode = 2;
                return;
            }
        }
    }
}

static BOOLEAN player_resolve_vertical_collision(Player* player, BOOLEAN was_on_ground) {
    BOOLEAN landed = 0;

    INT16 left = player->x;
    INT16 right = player->x + (PLAYER_COLLISION_W - 1);
    INT16 top = player->y - PLAYER_COLLISION_HALF_H;
    INT16 bottom = top + (PLAYER_COLLISION_H - 1);

    INT16 tx0 = (left + 1) >> 3;
    INT16 tx1 = (right - 1) >> 3;

    if (player->y_dir == 2) {

        INT16 tile_y = bottom >> 3;
        for (INT16 tile_x = tx0; tile_x <= tx1; ++tile_x) {
            if (map_is_solid_at(tile_x, tile_y)) {
                player->y = (INT16)(tile_y * 8 - PLAYER_COLLISION_HALF_H);
                player->y_subpixel = 0;
                player->y_speed_fp = 0;
                player->y_dir = 2;
                player->on_ground = 1;
                landed = !was_on_ground;
                return landed;
            }
        }
    } else {

        INT16 tile_y = top >> 3;
        for (INT16 tile_x = tx0; tile_x <= tx1; ++tile_x) {
            if (map_is_solid_at(tile_x, tile_y)) {
                player->y = (INT16)(((tile_y + 1) * 8) + PLAYER_COLLISION_HALF_H);
                player->y_subpixel = 0;
                player->y_speed_fp = 0;
                player->y_dir = 2;
                player->on_ground = 0;
                return 0;
            }
        }
    }

    return 0;
}

static BOOLEAN player_is_supported(const Player* player) {

    INT16 left = player->x;
    INT16 right = player->x + (PLAYER_COLLISION_W - 1);
    INT16 bottom = (player->y - PLAYER_COLLISION_HALF_H) + (PLAYER_COLLISION_H - 1);
    INT16 y_check = bottom + 1;

    INT16 tx0 = (left + 1) >> 3;
    INT16 tx1 = (right - 1) >> 3;
    INT16 tile_y = y_check >> 3;

    for (INT16 tile_x = tx0; tile_x <= tx1; ++tile_x) {
        if (map_is_solid_at(tile_x, tile_y)) {
            return 1;
        }
    }
    return 0;
}

void player_update(Player* player) {
    BOOLEAN was_on_ground = player->on_ground;

    INT16 old_x;

    player_calc_horizontal_speed(player);

    old_x = player->x;
    player->x += player->vel_x;
    if (player->vel_x < 0 || (player->vel_x == 0 && player->vel_x_subpixel != 0 && player->facing_left)) {

        if (player->x_subpixel < player->vel_x_subpixel) {
            player->x--;
            player->x_subpixel = (UINT8)(256 + player->x_subpixel - player->vel_x_subpixel);
        } else {
            player->x_subpixel = (UINT8)(player->x_subpixel - player->vel_x_subpixel);
        }
    } else {

        UINT16 new_subpixel = player->x_subpixel + player->vel_x_subpixel;
        if (new_subpixel >= 256) {
            player->x++;
            new_subpixel -= 256;
        }
        player->x_subpixel = (UINT8)new_subpixel;
    }

    player_resolve_horizontal_collision(player, old_x);

    if (!player->on_ground) {
        player_check_start_falling(player);
        if (player->y_dir == 1 && (!player->jumping || player->y_speed_fp < 0)) {
            player->y_speed_fp = 0;
            player->y_dir = 2;
        }
        player_move_y_with_speed_calc(player);

        BOOLEAN landed = player_resolve_vertical_collision(player, was_on_ground);
        if (landed) {
            player->anim_frame = 0;
            player->anim_timer = 0;
            player->anim_speed = player->is_moving ? RUN_ANIM_SPEED : IDLE_ANIM_SPEED;

        }
    }

    else if (!player_is_supported(player)) {
        player->on_ground = 0;
        player->y_dir = 2;
    }

    if (++player->anim_timer >= player->anim_speed) {
        player->anim_timer = 0;
        player->anim_frame++;
        if (!player->on_ground) {
            if (player->anim_frame >= JUMP_FRAMES_PER_DIR) {
                player->anim_frame = 0;
            }
        } else if (player->is_moving) {
            if (player->anim_frame >= RUN_FRAMES_PER_DIR) {
                player->anim_frame = 0;
            }
        } else {
            if (player->anim_frame >= IDLE_SEQ_LEN) {
                player->anim_frame = 0;
            }
        }
    }
}

#if defined(__SDCC)
void player_draw(const Player* player, INT16 screen_x, INT16 screen_y) {
    UINT8 sprites_used;

    UINT8 old_bank = _current_bank;
    SWITCH_ROM(BANK(player_animations));

    if (!player->on_ground) {
        if (player->facing_left) {
            sprites_used = move_metasprite_ex(
                player_animations_metasprites[16 + player->anim_frame],
                IDLE_TILE_BASE,
                0,
                0,
                screen_x,
                screen_y
            );
        }
        else {
            sprites_used = move_metasprite_flipx(
                player_animations_metasprites[16 + player->anim_frame],
                IDLE_TILE_BASE,
                0,
                0,
                screen_x,
                screen_y
            );
        }
    } else if (player->is_moving) {
        if (player->facing_left) {
            sprites_used = move_metasprite_ex(
                player_animations_metasprites[6 + player->anim_frame],
                IDLE_TILE_BASE,
                0,
                0,
                screen_x,
                screen_y
            );
        }
        else {
            sprites_used = move_metasprite_flipx(
                player_animations_metasprites[6 + player->anim_frame],
                IDLE_TILE_BASE,
                0,
                0,
                screen_x,
                screen_y
            );
        }
    } else {

        UINT8 idle_base = player->facing_left ? 0 : IDLE_FRAMES_PER_DIR;
        UINT8 frame_idx = idle_base + idle_sequence[player->anim_frame];
        sprites_used = move_metasprite_ex(
            player_animations_metasprites[frame_idx],
            IDLE_TILE_BASE,
            0,
            0,
            screen_x,
            screen_y
        );
    }

#ifdef VBLANK_BENCH

    hide_sprites_range(sprites_used, 36u);
#else
    hide_sprites_range(sprites_used, 40u);
#endif

    SWITCH_ROM(old_bank);
}

#endif
