#include <gb/gb.h>
#include <gbdk/platform.h>
#include "music.h"
#include "hUGEDriver.h"

// hUGEDriver was re-homed to bank 3 at link time (see Makefile).
#define MUSIC_BANK 3u

// Bank 3 music init implementation (see src/music_bank3.c)
void music3_init(void);

void vbl_music(void) NONBANKED {
    UINT8 old_bank = _current_bank;
    SWITCH_ROM(MUSIC_BANK);
    hUGE_dosound();
    SWITCH_ROM(old_bank);
}

void music_init(void)
{
    UINT8 old_bank = _current_bank;
    SWITCH_ROM(MUSIC_BANK);
    music3_init();
    SWITCH_ROM(old_bank);
}

