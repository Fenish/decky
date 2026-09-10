#include "panel.h"

#include <Arduino.h>
#include <Wire.h>

#include <cstring>

CrowPanelDisplay::CrowPanelDisplay()
{
    auto bus_config = bus.config();
    bus_config.panel = &panel;
    bus_config.pin_d0 = GPIO_NUM_15;  // B0
    bus_config.pin_d1 = GPIO_NUM_7;   // B1
    bus_config.pin_d2 = GPIO_NUM_6;   // B2
    bus_config.pin_d3 = GPIO_NUM_5;   // B3
    bus_config.pin_d4 = GPIO_NUM_4;   // B4
    bus_config.pin_d5 = GPIO_NUM_9;   // G0
    bus_config.pin_d6 = GPIO_NUM_46;  // G1
    bus_config.pin_d7 = GPIO_NUM_3;   // G2
    bus_config.pin_d8 = GPIO_NUM_8;   // G3
    bus_config.pin_d9 = GPIO_NUM_16;  // G4
    bus_config.pin_d10 = GPIO_NUM_1;  // G5
    bus_config.pin_d11 = GPIO_NUM_14; // R0
    bus_config.pin_d12 = GPIO_NUM_21; // R1
    bus_config.pin_d13 = GPIO_NUM_47; // R2
    bus_config.pin_d14 = GPIO_NUM_48; // R3
    bus_config.pin_d15 = GPIO_NUM_45; // R4
    bus_config.pin_henable = GPIO_NUM_41;
    bus_config.pin_vsync = GPIO_NUM_40;
    bus_config.pin_hsync = GPIO_NUM_39;
    bus_config.pin_pclk = GPIO_NUM_0;

    // The pixel clock sets the refresh rate: freq / (H_TOTAL * V_TOTAL).
    // It is also the thing that broke first - at 24 MHz with Elecrow's thin
    // 10-line bounce buffer, the scanout DMA lost against the GIF decoders for
    // PSRAM and painted stray pixels down the left of the screen. The bounce
    // buffer is now 40 lines; anything raised here must be re-tested for those
    // artefacts under full animation load, not just booted.
    bus_config.freq_write = PANEL_PCLK_HZ;

    bus_config.hsync_polarity = 0;
    bus_config.hsync_front_porch = panel::HSYNC_FRONT_PORCH;
    bus_config.hsync_pulse_width = panel::HSYNC_PULSE_WIDTH;
    bus_config.hsync_back_porch = panel::HSYNC_BACK_PORCH;
    bus_config.vsync_polarity = 0;
    bus_config.vsync_front_porch = panel::VSYNC_FRONT_PORCH;
    bus_config.vsync_pulse_width = panel::VSYNC_PULSE_WIDTH;
    bus_config.vsync_back_porch = panel::VSYNC_BACK_PORCH;
    bus_config.pclk_active_neg = 1;
    bus_config.de_idle_high = 0;
    bus_config.pclk_idle_high = 0;
    bus.config(bus_config);

    auto panel_config = panel.config();
    panel_config.memory_width = panel::WIDTH;
    panel_config.memory_height = panel::HEIGHT;
    panel_config.panel_width = panel::WIDTH;
    panel_config.panel_height = panel::HEIGHT;
    panel_config.offset_x = 0;
    panel_config.offset_y = 0;
    panel.config(panel_config);

    panel.setBus(&bus);

    auto touch_config = touch.config();
    touch_config.x_min = 0;
    touch_config.x_max = panel::WIDTH - 1;
    touch_config.y_min = 0;
    touch_config.y_max = panel::HEIGHT - 1;

    // No interrupt line and no reset line are wired to a usable pin on this
    // board, so the controller is polled and left to its own power-on reset.
    touch_config.pin_int = -1;
    touch_config.pin_rst = -1;

    // The GT911 has an I2C bus to itself; nothing else shares it.
    touch_config.bus_shared = false;
    touch_config.offset_rotation = 0;
    touch_config.i2c_port = I2C_NUM_1;
    touch_config.pin_sda = static_cast<int>(panel::TOUCH_SDA_PIN);
    touch_config.pin_scl = static_cast<int>(panel::TOUCH_SCL_PIN);
    touch_config.freq = panel::TOUCH_I2C_HZ;
    touch_config.i2c_addr = panel::TOUCH_I2C_ADDR;
    touch.config(touch_config);
    panel.setTouch(&touch);

    setPanel(&panel);
}

namespace panel
{
CrowPanelDisplay display;

namespace
{
constexpr size_t FRAME_BYTES = static_cast<size_t>(WIDTH) * HEIGHT * sizeof(uint16_t);
}

bool begin()
{
    pinMode(BACKLIGHT_PIN, OUTPUT);
    backlight(false);

    if(!display.begin()) {
        Serial.println("panel: begin() failed");
        return false;
    }
    delay(200);
    return true;
}

void present()
{
    uint8_t *front = display.bus.getFrameBuffer(0);
    if(front == nullptr) {
        Serial.println("panel: frame buffer unavailable");
        return;
    }

    if(!display.bus.presentFrameBuffer(front)) {
        Serial.println("panel: VSYNC frame switch timeout");
    }
}

void backlight(bool on)
{
    digitalWrite(BACKLIGHT_PIN, on ? HIGH : LOW);
}

bool touch_ready()
{
    // The driver remembers whether it came up, and returns that immediately on
    // a second call rather than re-probing the bus - so asking is cheap, and
    // asking after begin() is how the outcome is discovered at all. begin()
    // starts the controller but throws the answer away.
    return display.panel.initTouch();
}

bool touch_point(int &x, int &y)
{
    lgfx::touch_point_t point;
    if(display.getTouch(&point, 1) == 0) {
        return false;
    }

    x = point.x;
    y = point.y;
    return true;
}

void touch_bus_scan()
{
    // Deliberately a separate bus object from the one the driver will later
    // create on the same pins: this runs before begin(), and ends before it,
    // so the two never hold the port at once.
    TwoWire probe(1);
    if(!probe.begin(TOUCH_SDA_PIN, TOUCH_SCL_PIN, TOUCH_I2C_HZ)) {
        Serial.println("touch: I2C scan could not start");
        return;
    }

    int found = 0;
    for(uint8_t address = 0x08; address < 0x78; ++address) {
        probe.beginTransmission(address);
        if(probe.endTransmission() == 0) {
            Serial.printf("touch: device at 0x%02x%s\n", address,
                          address == 0x14 || address == 0x5d ? "  <- GT911" : "");
            ++found;
        }
    }

    if(found == 0) {
        Serial.printf("touch: nothing answered on SDA %d / SCL %d\n",
                      TOUCH_SDA_PIN, TOUCH_SCL_PIN);
    }

    probe.end();
}

bool wait_vsync(uint32_t timeout_ms)
{
    return display.bus.waitVSync(timeout_ms);
}
bool recover_scanout()
{
    return display.bus.restartScanout();
}

uint32_t beam_clears_row_us(int y)
{
    // A frame is V_TOTAL line times long. After a vertical sync the panel walks
    // through the sync pulse and the back porch before the first visible line,
    // so visible row y is finished at this many line times in.
    const float lines = static_cast<float>(VSYNC_PULSE_WIDTH + VSYNC_BACK_PORCH + y + 1);
    return static_cast<uint32_t>((lines / V_TOTAL) * frame_period_us());
}

uint16_t *framebuffer()
{
    return reinterpret_cast<uint16_t *>(display.bus.getFrameBuffer(0));
}

}
