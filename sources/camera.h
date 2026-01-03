#pragma once

#include <gb/gb.h>
#include "player.h"
#include "map.h"

// Camera state
typedef struct {
    // X is relative to the player's *center* (player.x + PLAYER_HALF_WIDTH).
    // Y is relative to the player's pivot (player.y).
    INT16 rel_x_from_player;
    INT16 rel_y_from_player;
    INT16 vel_x;             // Current velocity (for smooth movement)

    // Camera panning movement animation (horizontal)
    // BOOLEAN moving_x;       // 1 = camera is moving to target, 0 = at target
    UINT16 progress_x;       // Movement progress (0-255)
    INT16 start_offset_x;   // Starting offset from player position
    INT16 move_distance_x;  // Distance to move

    // Camera panning movement animation (vertical)
    INT8 progress_y;    // Vertical movement progress (-128-128)
    INT8 y_lookahead;   // Vertical distance to be offset
} Camera;

// Camera constants
#define CAMERA_LOOKAHEAD     56         // Pixels to look ahead of player (horizontal)
#define CAMERA_LOOKAHEAD_Y   40         // Pixels to look ahead of player (vertical)
#define CAMERA_MOVE_FRAMES   12         // Panning animation speed (higher = faster)
#define CAMERA_MOVE_FRAMES_Y 4

// Center camera on screen (screen width 160/2 = 80, height 144/2 = 72)
#define PLAYER_OFFSET_X      (80)
#define PLAYER_OFFSET_Y      (72 + 24)  // Slightly below mid-screen

// Initialize camera
void camera_init(Camera* camera, const Player* player);

// Update camera to follow player and update map scroll
void camera_update(Camera* camera, const Player* player, Map* map);

// Handle camera input for left/right movement with lookahead
void camera_input_left_right(Camera* camera, INT8 lookahead);

// Handle camera input for up/down movement with lookahead
void camera_input_up_down(Camera* camera, INT8 lookahead_y);

#define CAMERA_TO_SCREEN_X(camera) (PLAYER_OFFSET_X - (camera).rel_x_from_player)
#define CAMERA_TO_SCREEN_Y(camera) (PLAYER_OFFSET_Y - (camera).rel_y_from_player)
