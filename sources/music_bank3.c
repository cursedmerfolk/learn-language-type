#pragma bank 3

#include <gb/gb.h>
#include <gbdk/platform.h>
#include "music.h"
#include "hUGEDriver.h"

// Crateria music data (generated from music/*.uge)
extern const hUGESong_t crateria_music;
BANKREF_EXTERN(crateria_music)

void music3_init(void)
{
    // Enable sound
    NR52_REG = 0x80;  // Sound ON
    NR51_REG = 0xFF;  // All channels to both speakers
    NR50_REG = 0x77;  // Max volume

    disable_interrupts();
    set_interrupts(VBL_IFLAG);

    // Initialize hUGEDriver with Crateria music
    // (Interrupts are currently disabled, so this is effectively critical.)
    hUGE_init(&crateria_music);

    // vbl_music is NONBANKED (bank 0).
    add_VBL(vbl_music);
    enable_interrupts();
}
