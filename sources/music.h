#ifndef _MUSIC_H_
#define _MUSIC_H_

#include <gb/gb.h>
#include <gbdk/platform.h>

void music_init(void);

void vbl_music(void) NONBANKED;

#endif
