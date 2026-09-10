#if defined(ESP_PLATFORM)
#include <sdkconfig.h>
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#if __has_include(<esp_lcd_panel_rgb.h>)

#include "Bus_RGB.hpp"

#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>
#include <esp_log.h>
#include <esp_timer.h>

namespace lgfx
{
 inline namespace v1
 {
  void Bus_RGB::config(const config_t& cfg)
  {
    _cfg = cfg;
  }

  bool Bus_RGB::onVSync(esp_lcd_panel_handle_t panel,
                        const esp_lcd_rgb_panel_event_data_t* event_data,
                        void* user_context)
  {
    (void)panel;
    (void)event_data;
    Bus_RGB* bus = static_cast<Bus_RGB*>(user_context);
    bus->_vsync_count = bus->_vsync_count + 1;
    return false;
  }

  bool Bus_RGB::init(void)
  {
    if (_panel_handle != nullptr) { return true; }

    esp_lcd_rgb_panel_config_t panel_config = {};
    panel_config.clk_src = LCD_CLK_SRC_PLL160M;
    panel_config.timings.pclk_hz = _cfg.freq_write;
    panel_config.timings.h_res = _cfg.panel->width();
    panel_config.timings.v_res = _cfg.panel->height();
    panel_config.timings.hsync_pulse_width = _cfg.hsync_pulse_width;
    panel_config.timings.hsync_back_porch = _cfg.hsync_back_porch;
    panel_config.timings.hsync_front_porch = _cfg.hsync_front_porch;
    panel_config.timings.vsync_pulse_width = _cfg.vsync_pulse_width;
    panel_config.timings.vsync_back_porch = _cfg.vsync_back_porch;
    panel_config.timings.vsync_front_porch = _cfg.vsync_front_porch;
    panel_config.timings.flags.hsync_idle_low = _cfg.hsync_polarity;
    panel_config.timings.flags.vsync_idle_low = _cfg.vsync_polarity;
    panel_config.timings.flags.de_idle_high = _cfg.de_idle_high;
    panel_config.timings.flags.pclk_active_neg = _cfg.pclk_active_neg;
    panel_config.timings.flags.pclk_idle_high = _cfg.pclk_idle_high;
    panel_config.data_width = 16;
    panel_config.bits_per_pixel = 16;
    // One frame buffer, not two. Nothing flips them: every drawing path writes
    // straight into the buffer being scanned out, and the second was mirrored
    // once at start-up and never touched again - 768 KB of PSRAM standing idle
    // on a board where memory is what limits how much content can be held.
    panel_config.num_fbs = 1;
    // Bounce buffers absorb PSRAM contention between the scanout DMA and
    // whatever the CPU is doing in PSRAM. Elecrow's 10 lines is too thin here:
    // the GIF decoders also live in PSRAM, and at 24 MHz the DMA lost the race
    // often enough to put stray pixels on the left of the screen - the left,
    // because that is where each scanline starts and the DMA has least slack.
    // 40 lines fixed it at idle; under a 90% decode load the artefacts came
    // back, so this is 64 lines - 100 KB per buffer out of internal RAM.
    panel_config.bounce_buffer_size_px = _cfg.panel->width() * 48;
    panel_config.dma_burst_size = 64;
    panel_config.hsync_gpio_num = _cfg.pin_hsync;
    panel_config.vsync_gpio_num = _cfg.pin_vsync;
    panel_config.de_gpio_num = _cfg.pin_henable;
    panel_config.pclk_gpio_num = _cfg.pin_pclk;
    panel_config.disp_gpio_num = -1;

    for (uint8_t index = 0; index < 16; ++index)
    {
      panel_config.data_gpio_nums[index] = _cfg.pin_data[index];
    }
    panel_config.flags.fb_in_psram = 1;

    esp_err_t result = esp_lcd_new_rgb_panel(&panel_config, &_panel_handle);
    if (result == ESP_OK)
    {
      esp_lcd_rgb_panel_event_callbacks_t callbacks = {};
      callbacks.on_vsync = onVSync;
      result = esp_lcd_rgb_panel_register_event_callbacks(_panel_handle, &callbacks, this);
    }
    if (result == ESP_OK) { result = esp_lcd_panel_reset(_panel_handle); }
    if (result == ESP_OK) { result = esp_lcd_panel_init(_panel_handle); }
    if (result == ESP_OK)
    {
      result = esp_lcd_rgb_panel_get_frame_buffer(_panel_handle, 1,
                                                  (void**)&_frame_buffers[0]);
      _frame_buffers[1] = nullptr;
    }
    if (result != ESP_OK)
    {
      ESP_LOGE("Bus_RGB", "esp_lcd RGB init failed: %s", esp_err_to_name(result));
      release();
      return false;
    }

    size_t frame_size = _cfg.panel->width() * _cfg.panel->height() * 2;
    memset(_frame_buffers[0], 0, frame_size);
    return true;
  }

  uint8_t* Bus_RGB::getDMABuffer(uint32_t length)
  {
    (void)length;
    return _frame_buffers[0];
  }

  bool Bus_RGB::presentFrameBuffer(uint8_t* buffer, uint32_t timeout_ms)
  {
    if (buffer != _frame_buffers[0] && buffer != _frame_buffers[1]) { return false; }
    uint32_t count = _vsync_count;
    esp_err_t result = esp_lcd_panel_draw_bitmap(_panel_handle, 0, 0,
                                                  _cfg.panel->width(),
                                                  _cfg.panel->height(), buffer);
    if (result != ESP_OK) { return false; }
    int64_t timeout_at = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    while (_vsync_count == count)
    {
      if (esp_timer_get_time() >= timeout_at) { return false; }
      taskYIELD();
    }
    return true;
  }

  bool Bus_RGB::waitVSync(uint32_t timeout_ms)
  {
    uint32_t count = _vsync_count;
    int64_t timeout_at = esp_timer_get_time() + (int64_t)timeout_ms * 1000;
    while (_vsync_count == count)
    {
      if (esp_timer_get_time() >= timeout_at) { return false; }
      taskYIELD();
    }
    return true;
  }

  bool Bus_RGB::restartScanout()
  {
    // Flash/NVS operations can stall the PSRAM bounce-buffer interrupt and
    // leave LCD and DMA positions different. Restart at the driver's next
    // vertical blank, keeping the same framebuffer and measured timings.
    return _panel_handle && esp_lcd_rgb_panel_restart(_panel_handle) == ESP_OK;
  }

  void Bus_RGB::release(void)
  {
    if (_panel_handle != nullptr)
    {
      esp_lcd_panel_del(_panel_handle);
      _panel_handle = nullptr;
    }
    _frame_buffers[0] = nullptr;
    _frame_buffers[1] = nullptr;
  }
 }
}

#endif
#endif
#endif
