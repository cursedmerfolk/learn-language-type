#include <gb/gb.h>
#include <gbdk/platform.h>
#include "music.h"
#include "hUGEDriver.h"

#define MUSIC_BANK 3u

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
