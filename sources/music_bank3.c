#pragma bank 3

#include <gb/gb.h>
#include <gbdk/platform.h>
#include "music.h"
#include "hUGEDriver.h"

extern const hUGESong_t crateria_music;
BANKREF_EXTERN(crateria_music)

void music3_init(void)
{

    NR52_REG = 0x80;
    NR51_REG = 0xFF;
    NR50_REG = 0x77;

    disable_interrupts();
    set_interrupts(VBL_IFLAG);

    hUGE_init(&crateria_music);

    add_VBL(vbl_music);
    enable_interrupts();
}
