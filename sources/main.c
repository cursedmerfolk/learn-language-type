#include <gb/gb.h>
#include <gb/cgb.h>

#ifdef VBLANK_BENCH
#include "vblank_bench.h"

static uint8_t div_delta_u8(uint8_t start, uint8_t end) {
    return (uint8_t)(end - start);
}

volatile uint8_t g_vblank_wait_div_last;
#endif

#include "player.h"
#include "camera.h"
#include "map.h"
#include "music.h"

UINT8 PREV_JOY;

void input_update(Player* player, Camera* camera) {
    UINT8 joy = joypad();

    if ((joy & J_SELECT) && !(PREV_JOY & J_SELECT)) {
        player->in_water = !player->in_water;
    }

    player->jumping = (joy & J_A) != 0;

    BOOLEAN jump_pressed = (joy & J_A) && !(PREV_JOY & J_A);
    if (jump_pressed) {
        player_input_jump(player);
    }

    BOOLEAN sprint_held = (joy & J_B) && player->on_ground;

    if (joy & J_LEFT) {
        if (!player->facing_left) {
            camera_input_left_right(camera, -CAMERA_LOOKAHEAD);
        }
        BOOLEAN just_pressed = !(PREV_JOY & J_LEFT);
        player_input_left(player, just_pressed, sprint_held);
    }
    else if (joy & J_RIGHT) {
        if (player->facing_left) {
            camera_input_left_right(camera, CAMERA_LOOKAHEAD);
        }
        BOOLEAN just_pressed = !(PREV_JOY & J_RIGHT);
        player_input_right(player, just_pressed, sprint_held);
    }
    else {
        BOOLEAN just_released = (PREV_JOY & (J_LEFT | J_RIGHT));
        player_input_none(player, just_released);
    }

    if (joy & J_UP) {
        if (!(PREV_JOY & J_UP)) {
            camera_input_up_down(camera, -CAMERA_LOOKAHEAD_Y);
        }
    }
    else if (joy & J_DOWN) {
        if (!(PREV_JOY & J_DOWN)) {
            camera_input_up_down(camera, CAMERA_LOOKAHEAD_Y);
        }
    }
    else {

        if (PREV_JOY & (J_UP | J_DOWN)) {
            camera_input_up_down(camera, 0);
        }
    }

    PREV_JOY = joy;
}

void main() {
    DISPLAY_OFF;

    SPRITES_8x8;

    cpu_slow();

    music_init();

    Player player;
    player_init(&player, 500, 300);

    Camera camera;
    camera_init(&camera, &player);

    Map map;
    map_init(&map);

    {
        INT16 cam_world_x = (player.x + PLAYER_HALF_WIDTH) + camera.rel_x_from_player;
        INT16 cam_world_y = player.y + camera.rel_y_from_player;
        map_set_scroll_immediate(&map, cam_world_x - PLAYER_OFFSET_X, cam_world_y - PLAYER_OFFSET_Y);
    }
    map_apply_scroll(&map);
    map_draw_full_screen(&map);

    SHOW_BKG;
    SHOW_SPRITES;
    DISPLAY_ON;

#ifdef VBLANK_BENCH
    g_vblank_wait_div_last = 0u;
    UINT8 div_stride = 0;
    vblank_bench_init();
#endif

    while (1) {

        input_update(&player, &camera);

        player_update(&player);

        camera_update(&camera, &player, &map);

        player_draw(&player, CAMERA_TO_SCREEN_X(camera), CAMERA_TO_SCREEN_Y(camera));

#ifdef VBLANK_BENCH
        if (div_stride++ >= 30) {
            div_stride = 0;
            DIV_REG = 0;
            uint8_t t0 = DIV_REG;
            wait_vbl_done();
            g_vblank_wait_div_last = div_delta_u8(t0, DIV_REG);

            vblank_bench_print_right4(g_vblank_wait_div_last);
        }
        else {
            wait_vbl_done();
        }
#else
        wait_vbl_done();
#endif
    }
}
