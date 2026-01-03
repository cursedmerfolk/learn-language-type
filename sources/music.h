#ifndef _MUSIC_H_
#define _MUSIC_H_

#include <gb/gb.h>
#include <gbdk/platform.h>

// Initialize music system
void music_init(void);

// VBL handler installed by music_init()
void vbl_music(void) NONBANKED;

#endif // _MUSIC_H_
