#pragma once

#if __has_include (<esp_lcd_panel_rgb.h>)
#include <esp_lcd_panel_io.h>
#include <esp_lcd_panel_rgb.h>
#include <esp_lcd_panel_vendor.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_interface.h>

#include "../../Bus.hpp"
#include "../../panel/Panel_FrameBufferBase.hpp"
#include "../common.hpp"

struct lcd_cam_dev_t;
struct esp_rgb_panel_t;

namespace lgfx
{
 inline namespace v1
 {
  class Bus_RGB : public IBus
  {
  public:
    struct config_t
    {
      Panel_FrameBufferBase* panel = nullptr;
      int8_t port = 0;
      uint32_t freq_write = 16000000;
      int8_t pin_pclk = -1;
      int8_t pin_vsync = -1;
      int8_t pin_hsync = -1;
      int8_t pin_henable = -1;
      union
      {
        int8_t pin_data[16];
        struct
        {
          int8_t pin_d0;
          int8_t pin_d1;
          int8_t pin_d2;
          int8_t pin_d3;
          int8_t pin_d4;
          int8_t pin_d5;
          int8_t pin_d6;
          int8_t pin_d7;
          int8_t pin_d8;
          int8_t pin_d9;
          int8_t pin_d10;
          int8_t pin_d11;
          int8_t pin_d12;
          int8_t pin_d13;
          int8_t pin_d14;
          int8_t pin_d15;
        };
      };
      int8_t hsync_pulse_width = 0;
      int8_t hsync_back_porch = 0;
      int8_t hsync_front_porch = 0;
      int8_t vsync_pulse_width = 0;
      int8_t vsync_back_porch = 0;
      int8_t vsync_front_porch = 0;
      bool hsync_polarity = 0;
      bool vsync_polarity = 0;
      bool pclk_active_neg = 1;
      bool de_idle_high = 0;
      bool pclk_idle_high = 0;
    };

    const config_t& config(void) const { return _cfg; }
    void config(const config_t& config);
    bus_type_t busType(void) const override { return bus_type_t::bus_unknown; }
    bool init(void) override;
    void release(void) override;
    bool waitVSync(uint32_t timeout_ms = 50);
    void beginTransaction(void) override {}
    void endTransaction(void) override {}
    void wait(void) override {}
    bool busy(void) const override { return false; }
    void flush(void) override {}
    bool writeCommand(uint32_t data, uint_fast8_t bit_length) override { return true; }
    void writeData(uint32_t data, uint_fast8_t bit_length) override {}
    void writeDataRepeat(uint32_t data, uint_fast8_t bit_length, uint32_t count) override {}
    void writePixels(pixelcopy_t* param, uint32_t length) override {}
    void writeBytes(const uint8_t* data, uint32_t length, bool dc, bool use_dma) override {}
    void initDMA(void) override {}
    void addDMAQueue(const uint8_t* data, uint32_t length) override {}
    void execDMAQueue(void) override {}
    uint8_t* getDMABuffer(uint32_t length) override;
    uint8_t* getFrameBuffer(uint8_t index) const { return index < 2 ? _frame_buffers[index] : nullptr; }
    bool presentFrameBuffer(uint8_t* buffer, uint32_t timeout_ms = 50);
    bool restartScanout();
    // The esp_lcd driver's bounce position at the last vertical sync, the
    // spread of EOF interrupts per frame since the previous call, and how many
    // frames ended on an odd count - each a slipped picture averted. False
    // when the driver's private layout could not be confirmed at init.
    bool scanoutState(int32_t* pos_px, uint32_t* min_eofs, uint32_t* max_eofs, uint32_t* corrections);
    void beginRead(void) override {}
    void endRead(void) override {}
    uint32_t readData(uint_fast8_t bit_length) override { return 0; }
    bool readBytes(uint8_t* dst, uint32_t length, bool use_dma) override { return false; }
    void readPixels(void* dst, pixelcopy_t* param, uint32_t length) override {}

  private:
    config_t _cfg;
    esp_lcd_panel_handle_t _panel_handle = nullptr;
    uint8_t* _frame_buffers[2] = { nullptr, nullptr };
    volatile uint32_t _vsync_count = 0;
    void* _driver = nullptr;  // the driver's own panel state, once its layout is confirmed
    volatile int32_t _seen_pos = -1;
    volatile uint32_t _min_eofs = UINT32_MAX;
    volatile uint32_t _max_eofs = 0;
    volatile uint32_t _corrections = 0;
    static bool onVSync(esp_lcd_panel_handle_t panel,
                        const esp_lcd_rgb_panel_event_data_t* event_data,
                        void* user_context);
  };
 }
}
#endif
