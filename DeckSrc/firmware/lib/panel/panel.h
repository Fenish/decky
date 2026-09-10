/*---------------------------------------------------------------
 * CrowPanel Basic 7.0" panel bring-up.
 *
 * Owns the RGB bus configuration, the panel timing, the backlight and the
 * frame buffers. Everything that knows about GPIO numbers lives here; nothing
 * above this layer should.
 *--------------------------------------------------------------*/

#pragma once

#include <LovyanGFX.hpp>
#include <lgfx/v1/platforms/esp32s3/Bus_RGB.hpp>
#include <lgfx/v1/platforms/esp32s3/Panel_RGB.hpp>
#include <lgfx/v1/touch/Touch_GT911.hpp>

#include <driver/i2c.h>

#include <cstdint>

/**
 * @brief LovyanGFX device bound to the CrowPanel's 800 x 480 RGB panel.
 * @note The pin map and timing come from Elecrow's own documentation for this
 *       board; see panel.cpp for the one value where their docs disagree.
 */
class CrowPanelDisplay : public lgfx::LGFX_Device
{
public:
    lgfx::Bus_RGB bus;
    lgfx::Panel_RGB panel;
    lgfx::Touch_GT911 touch;

    CrowPanelDisplay();
};

namespace panel
{
// Panel resolution and the physical size of the active area, from the Elecrow
// product spec. The pixels are not square, which is why the two axes carry
// separate scales.
constexpr int   WIDTH = 800;
constexpr int   HEIGHT = 480;
constexpr float ACTIVE_W_MM = 153.84f;
constexpr float ACTIVE_H_MM = 85.63f;

constexpr uint8_t BACKLIGHT_PIN = 2;

// Touch controller. The GT911 sits on its own I2C bus, so it contends with
// nothing: the panel is on the LCD peripheral and the SD card on SPI2.
//
// These pins, the 400 kHz clock and the 0x14 address are Elecrow's own values
// for this exact board - LovyanGFX ships them as
// lgfx_user/LGFX_Elecrow_ESP32_Display_WZ8048C070.h, whose twenty RGB pins
// match panel.cpp exactly, which is what identifies it as our panel and not a
// near neighbour.
//
// There is no reset line to drive and no I2C expander in the way. The address
// is the one the controller settles on at power-up; the driver tries the other
// (0x5D) by itself if this one does not answer, so it is a starting point
// rather than a fact to be sure of.
constexpr int      TOUCH_SDA_PIN = 19;
constexpr int      TOUCH_SCL_PIN = 20;
constexpr uint32_t TOUCH_I2C_HZ = 400000;
constexpr uint8_t  TOUCH_I2C_ADDR = 0x14;

// Pixel clock. Override from platformio.ini with -DPANEL_PCLK_HZ=... to try a
// different refresh rate; see panel.cpp for what breaks when it is too high.
#ifndef PANEL_PCLK_HZ
#define PANEL_PCLK_HZ 24000000
#endif

// Blanking intervals, from Elecrow's timing. They are here rather than buried
// in the constructor because together with the pixel clock they *are* the
// refresh rate, and that is the number anyone tuning this actually wants.
constexpr int HSYNC_FRONT_PORCH = 40;
constexpr int HSYNC_PULSE_WIDTH = 48;
constexpr int HSYNC_BACK_PORCH = 40;
constexpr int VSYNC_FRONT_PORCH = 1;
constexpr int VSYNC_PULSE_WIDTH = 31;
constexpr int VSYNC_BACK_PORCH = 13;

constexpr int H_TOTAL = WIDTH + HSYNC_FRONT_PORCH + HSYNC_PULSE_WIDTH + HSYNC_BACK_PORCH;
constexpr int V_TOTAL = HEIGHT + VSYNC_FRONT_PORCH + VSYNC_PULSE_WIDTH + VSYNC_BACK_PORCH;

// Refresh rate the panel will actually run at. Nothing drawn faster than this
// can be seen.
constexpr float REFRESH_HZ =
    static_cast<float>(PANEL_PCLK_HZ) / (static_cast<float>(H_TOTAL) * V_TOTAL);

// The one display device. Declared here so screens can draw on it.
extern CrowPanelDisplay display;

/**
 * @brief Start the panel.
 * @param None.
 * @return True if the panel came up.
 * @note Leaves the backlight off so nothing half-drawn is ever shown.
 */
bool begin();

/**
 * @brief Hand the drawn buffer to the scanout.
 * @param None.
 * @return Nothing.
 * @note There is only one buffer: every drawing path writes into the one being
 *       scanned, so this is called once at start-up and never again.
 */
void present();

/**
 * @brief Turn the backlight on or off.
 * @param on True to light the panel.
 * @return Nothing.
 */
void backlight(bool on);

/**
 * @brief Whether the touch controller answered.
 * @param None.
 * @return True if the GT911 is talking.
 * @note begin() already tries to start it; this reports the outcome, which is
 *       worth checking because a silent controller and a working one look
 *       identical until something is touched.
 */
bool touch_ready();

/**
 * @brief Current contact position.
 * @param x Set to the touched column when a finger is down.
 * @param y Set to the touched row when a finger is down.
 * @return True while a finger is on the glass.
 * @note One contact only. The deck treats a touch as a key press, and a key
 *       press has no use for a second finger.
 */
bool touch_point(int &x, int &y);

/**
 * @brief List the devices answering on the touch I2C bus.
 * @param None.
 * @return Nothing; results go to the serial port.
 * @note Diagnostic, and the first thing to look at if touch does not work.
 *       Must be called before begin(), which takes the bus over.
 */
void touch_bus_scan();

/**
 * @brief The frame buffer the panel is scanning out.
 * @param None.
 * @return Pointer to WIDTH * HEIGHT RGB565 pixels, or nullptr before begin().
 * @note For code that draws whole scanlines and cannot afford a library call
 *       per line. Writes land on screen immediately, so a partially drawn frame
 *       can be seen; that is the trade for not double-buffering every update.
 */
uint16_t *framebuffer();

/**
 * @brief Block until the panel finishes scanning the current frame.
 * @param timeout_ms How long to wait before giving up.
 * @return True if a vertical sync arrived.
 * @note Gives callers a known beam position, which is what makes it possible to
 *       write a region only while the scanout is somewhere else.
 */
bool wait_vsync(uint32_t timeout_ms = 50);
// Restart scanout from the first line at the next vertical blank, keeping the
// picture. A slipped picture does not need it: the bus guards that per frame.
bool recover_scanout();
// Diagnostics: the display driver's bounce position at the last vertical sync,
// EOF interrupts per frame since the last call, and slips averted since boot.
// False when the driver's layout could not be confirmed.
bool scanout_state(int32_t &pos_px, uint32_t &min_eofs, uint32_t &max_eofs, uint32_t &corrections);

/**
 * @brief When the scanout beam clears a given pixel row.
 * @param y Row on the panel.
 * @return Microseconds after a vertical sync at which that row has been drawn.
 * @note Writing to a row after this offset, and before the next frame reaches
 *       it again, cannot tear.
 */
uint32_t beam_clears_row_us(int y);

/**
 * @brief Duration of one displayed frame.
 * @param None.
 * @return Microseconds per refresh.
 */
constexpr uint32_t frame_period_us()
{
    return static_cast<uint32_t>(1000000.0f / REFRESH_HZ);
}

}
