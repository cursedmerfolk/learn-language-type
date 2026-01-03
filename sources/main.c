#include <gb/gb.h>
#include <gb/cgb.h>

#ifdef VBLANK_BENCH
#include "vblank_bench.h"

static uint8_t div_delta_u8(uint8_t start, uint8_t end) {
    return (uint8_t)(end - start); // wrap-safe for DIV_REG (uint8_t)
}

// Exposed for emulator memory watch if desired.
volatile uint8_t g_vblank_wait_div_last;
#endif

// Game modules
#include "player.h"
#include "camera.h"
#include "map.h"
#include "music.h"

UINT8 PREV_JOY;

void input_update(Player* player, Camera* camera) {
    UINT8 joy = joypad();

    // Debug: toggle water physics
    if ((joy & J_SELECT) && !(PREV_JOY & J_SELECT)) {
        player->in_water = !player->in_water;
    }

    // A is both Jump (press) and Sprint (hold).
    // JumpingMovement uses whether the button is held each frame.
    player->jumping = (joy & J_A) != 0;

    // Handle jump input (A button)
    BOOLEAN jump_pressed = (joy & J_A) && !(PREV_JOY & J_A);
    if (jump_pressed) {
        player_input_jump(player);
    }

    // Handle horizontal movement
    // Sprint only when B is already held (avoid sprinting on the same frame as jump press).
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
    
    // Handle vertical camera panning
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
        // Return to center if up/down was previously pressed
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

    // Initialize music
    music_init();

    // Initialize player
    Player player;
    player_init(&player, 500, 300);

    // Initialize camera centered on player
    Camera camera;
    camera_init(&camera, &player);

    // Initialize map and draw initial screen
    // IMPORTANT: the collision ring only contains streamed tiles.
    // The player spawns far from (0,0), so seed the map state to the
    // camera's initial target before the first draw.
    Map map;
    map_init(&map);

    // Seed the map state to the camera's initial top-left scroll BEFORE drawing.
    // This avoids a massive first-frame scroll delta that can overflow internal offsets
    // or require streaming hundreds of columns/rows.
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

        // Update player physics and input
        player_update(&player);
        
        // FUTURE: only update when a movement input occurs
        // Update camera to follow player (also updates map scroll with tile streaming)
        camera_update(&camera, &player, &map);

        // FUTURE: update player->screen_x as the player moves
        //         don't recalculate every frame
        // Draw player at screen position
        player_draw(&player, CAMERA_TO_SCREEN_X(camera), CAMERA_TO_SCREEN_Y(camera));

#ifdef VBLANK_BENCH
        if (div_stride++ >= 30) {
            div_stride = 0;
            DIV_REG = 0;  // because it can be in the middle of counting.
            uint8_t t0 = DIV_REG;
            wait_vbl_done();
            g_vblank_wait_div_last = div_delta_u8(t0, DIV_REG);

            // Print the last wait ticks at the top-right.
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