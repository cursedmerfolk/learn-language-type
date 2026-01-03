#pragma once

#include <gb/gb.h>
#include "player.h"
#include "map.h"

typedef struct {

    INT16 rel_x_from_player;
    INT16 rel_y_from_player;
    INT16 vel_x;

    UINT16 progress_x;
    INT16 start_offset_x;
    INT16 move_distance_x;

    INT8 progress_y;
    INT8 y_lookahead;
} Camera;

#define CAMERA_LOOKAHEAD     56
#define CAMERA_LOOKAHEAD_Y   40
#define CAMERA_MOVE_FRAMES   12
#define CAMERA_MOVE_FRAMES_Y 4

#define PLAYER_OFFSET_X      (80)
#define PLAYER_OFFSET_Y      (72 + 24)

void camera_init(Camera* camera, const Player* player);

void camera_update(Camera* camera, const Player* player, Map* map);

void camera_input_left_right(Camera* camera, INT8 lookahead);

void camera_input_up_down(Camera* camera, INT8 lookahead_y);

#define CAMERA_TO_SCREEN_X(camera) (PLAYER_OFFSET_X - (camera).rel_x_from_player)
#define CAMERA_TO_SCREEN_Y(camera) (PLAYER_OFFSET_Y - (camera).rel_y_from_player)
