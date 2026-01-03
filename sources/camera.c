#include "camera.h"


#define EASE_DURATION 256u
#define EASE_DURATION_DIV 8u
#define EASE_DURATION_HALF EASE_DURATION / 2u

#define CAMERA_BASE_Y (-24)

// Ease in-out function for smooth camera movement
// Returns value from 0 to 256 based on progress (0-256)
UINT16 ease_in_out(UINT16 t) {
    if (t < EASE_DURATION_HALF) {
        // Ease in (first half): quadratic acceleration
        UINT16 scaled = (t * t) >> 6;  // t^2 / 64
        return scaled;
    } else {
        // Ease out (second half): quadratic deceleration
        UINT16 t_inv = EASE_DURATION - t;
        UINT16 scaled = (t_inv * t_inv) >> 6;
        // (EASE_DURATION << 1) = EASE_DURATION * 2
        return (EASE_DURATION << 1) - scaled;
    }
}

void camera_init(Camera* camera, const Player* player) {
    // Initialize offsets so the camera immediately follows the player.
    // X offset is relative to player center.
    camera->rel_x_from_player = player->facing_left ? -CAMERA_LOOKAHEAD : CAMERA_LOOKAHEAD;
    // Y offset is relative to player pivot; negative means camera above player.
    // Keep a stable base offset; progress_y is an additional lookahead delta.
    camera->rel_y_from_player = CAMERA_BASE_Y;
    camera->vel_x = 0;
    camera->move_distance_x = 0;
    camera->progress_x = EASE_DURATION;
    // camera->moving_x = 0;
    camera->progress_y = 0;
    camera->y_lookahead = 0;
}

void camera_input_left_right(Camera* camera, INT8 lookahead) {
    camera->start_offset_x = camera->rel_x_from_player;
    camera->move_distance_x = (INT16)lookahead - camera->start_offset_x;
    camera->progress_x = EASE_DURATION - camera->progress_x;
}

void camera_input_up_down(Camera* camera, INT8 lookahead_y) {
    camera->y_lookahead = lookahead_y;
}

void camera_update(Camera* camera, const Player* player, Map* map) {

    // Update horizontal camera position with ease in-out interpolation.
    if (camera->progress_x != EASE_DURATION) {
        camera->progress_x += CAMERA_MOVE_FRAMES;

        if (camera->progress_x >= EASE_DURATION) {
            camera->progress_x = EASE_DURATION;
            camera->rel_x_from_player = (INT16)(camera->start_offset_x + camera->move_distance_x);
        } else {
            // Interpolate with easing
            UINT16 eased = ease_in_out(camera->progress_x) >> 1;                    // >> 1 = divide by 2
            // FUTURE: optimize mul out from here somehow using accumulation.
            // Right now it's calculating a percentage each frame.
            INT16 offset = (camera->move_distance_x * (INT32)eased) >> EASE_DURATION_DIV;  // >> 8 = divide by 256 = EASE_DURATION
            camera->rel_x_from_player = (INT16)(camera->start_offset_x + offset);
        }
    } else {
        // Camera follows player with lookahead
        camera->rel_x_from_player = player->facing_left ? -CAMERA_LOOKAHEAD : CAMERA_LOOKAHEAD;
    }

    // Update vertical camera position - pan based on progress_y
    if (camera->progress_y < camera->y_lookahead) {
        camera->progress_y += CAMERA_MOVE_FRAMES_Y;
        if (camera->progress_y > camera->y_lookahead) {
            camera->progress_y = camera->y_lookahead;
        }
    } else if (camera->progress_y > camera->y_lookahead){
        camera->progress_y -= CAMERA_MOVE_FRAMES_Y;
        if (camera->progress_y < camera->y_lookahead) {
            camera->progress_y = camera->y_lookahead;
        }
    }

    // Apply vertical offset: stable base + lookahead delta.
    camera->rel_y_from_player = (INT16)(CAMERA_BASE_Y + (INT16)camera->progress_y);

    // Camera world center is derived from player world position + offsets.
    INT16 cam_world_x = (player->x + PLAYER_HALF_WIDTH) + camera->rel_x_from_player;
    INT16 cam_world_y = player->y + camera->rel_y_from_player;

    // Update map scroll based on camera position
    map_set_scroll(map, cam_world_x - PLAYER_OFFSET_X, cam_world_y - PLAYER_OFFSET_Y);
    map_apply_scroll(map);
}
