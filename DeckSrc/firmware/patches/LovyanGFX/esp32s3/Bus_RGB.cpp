#if defined(ESP_PLATFORM)
#include <sdkconfig.h>
#if defined(CONFIG_IDF_TARGET_ESP32S3)
#if __has_include(<esp_lcd_panel_rgb.h>)

#include "Bus_RGB.hpp"

#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>
#include <esp_lcd_panel_interface.h>
#include <esp_intr_alloc.h>
#include <esp_log.h>
#include <esp_pm.h>
#include <esp_timer.h>
#include <esp_private/gdma.h>
#include <esp_private/gdma_link.h>
#include <freertos/FreeRTOS.h>
#include <hal/lcd_hal.h>
#include <soc/soc_caps.h>

namespace
{
  // esp_rgb_panel_t as ESP-IDF v5.5.4 lays it out for the ESP32-S3
  // (components/esp_lcd/rgb/esp_lcd_panel_rgb.c, with its separate restart
  // link), up to its spinlock. Private to the driver: it is only used after
  // init() has matched it against values known here, down to this bus's own
  // VSYNC callback and context.
  struct driver_rgb_panel
  {
    esp_lcd_panel_t base;
    int panel_id;
    lcd_hal_context_t hal;
    size_t data_width;
    size_t fb_bits_per_pixel;
    size_t num_fbs;
    size_t output_bits_per_pixel;
    size_t dma_burst_size;
    intr_handle_t intr;
    esp_pm_lock_handle_t pm_lock;
    size_t num_dma_nodes;
    gdma_channel_handle_t dma_chan;
    gdma_link_list_handle_t dma_fb_links[3];
    gdma_link_list_handle_t dma_bb_link;
    gdma_link_list_handle_t dma_restart_link;
    uint8_t* fbs[3];
    uint8_t* bounce_buffer[2];
    size_t fb_size;
    size_t bb_size;
    uint8_t cur_fb_index;
    uint8_t bb_fb_index;
    size_t int_mem_align;
    size_t ext_mem_align;
    int hsync_gpio_num;
    int vsync_gpio_num;
    int de_gpio_num;
    int pclk_gpio_num;
    int disp_gpio_num;
    int data_gpio_nums[SOC_LCDCAM_RGB_DATA_WIDTH];
    uint64_t gpio_reserve_mask;
    uint32_t src_clk_hz;
    esp_lcd_rgb_timing_t timings;
    int bounce_pos_px;
    size_t bb_eof_count;
    size_t expect_eof_count;
    esp_lcd_rgb_panel_draw_buf_complete_cb_t on_color_trans_done;
    esp_lcd_rgb_panel_frame_buf_complete_cb_t on_frame_buf_complete;
    esp_lcd_rgb_panel_vsync_cb_t on_vsync;
    esp_lcd_rgb_panel_bounce_buf_fill_cb_t on_bounce_empty;
    void* user_ctx;
    int x_gap;
    int y_gap;
    portMUX_TYPE spinlock;
  };
}

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
    // This runs in the LCD interrupt just before the driver restarts the DMA
    // for the next frame. The driver picks which bounce buffer to refill by
    // the parity of its EOF count, and zeroes the count here every frame -
    // except when built with CONFIG_LCD_RGB_RESTART_IN_VSYNC, as this framework
    // is. Then it never does, and a stall that merges two EOF interrupts into
    // one (flash writes and Wi-Fi calibration hold interrupts off) flips the
    // parity for good: every refill lands in the buffer being sent, and the
    // picture sits one bounce buffer (48 lines) too high, wrapped, until a
    // reset. Zeroing it here restores the driver's own rule; a flip is gone
    // within a frame. Measured on the deck: a frame is 10 EOFs, even.
    if (bus->_driver != nullptr)
    {
      auto* driver = static_cast<driver_rgb_panel*>(bus->_driver);
      portENTER_CRITICAL_ISR(&driver->spinlock);
      const uint32_t eofs = driver->bb_eof_count;
      driver->bb_eof_count = 0;
      portEXIT_CRITICAL_ISR(&driver->spinlock);
      if (eofs & 1) { bus->_corrections = bus->_corrections + 1; }
      if (eofs < bus->_min_eofs) { bus->_min_eofs = eofs; }
      if (eofs > bus->_max_eofs) { bus->_max_eofs = eofs; }
      bus->_seen_pos = driver->bounce_pos_px;
    }
    return false;
  }

  bool Bus_RGB::scanoutState(int32_t* pos_px, uint32_t* min_eofs, uint32_t* max_eofs, uint32_t* corrections)
  {
    if (_driver == nullptr) { return false; }
    *pos_px = _seen_pos;
    *min_eofs = _min_eofs;
    *max_eofs = _max_eofs;
    *corrections = _corrections;
    _min_eofs = UINT32_MAX;
    _max_eofs = 0;
    return true;
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

    // Trust the mirrored layout only if every field up to the bookkeeping
    // holds what this panel was configured with.
    auto* driver = reinterpret_cast<driver_rgb_panel*>(_panel_handle);
    if (driver->num_fbs == 1 && driver->fbs[0] == _frame_buffers[0] &&
        driver->fb_size == frame_size &&
        driver->bb_size == static_cast<size_t>(_cfg.panel->width()) * 48 * 2 &&
        driver->bounce_buffer[0] != nullptr && driver->bounce_buffer[1] != nullptr &&
        driver->hsync_gpio_num == _cfg.pin_hsync && driver->vsync_gpio_num == _cfg.pin_vsync &&
        driver->timings.h_res == static_cast<uint32_t>(_cfg.panel->width()) &&
        driver->timings.v_res == static_cast<uint32_t>(_cfg.panel->height()) &&
        driver->timings.vsync_back_porch == static_cast<uint32_t>(_cfg.vsync_back_porch) &&
        driver->timings.vsync_front_porch == static_cast<uint32_t>(_cfg.vsync_front_porch) &&
        driver->on_vsync == onVSync && driver->user_ctx == this)
    {
      _driver = driver;
    }
    else
    {
      ESP_LOGW("Bus_RGB", "esp_lcd RGB layout not recognised; bounce parity not guarded");
    }
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
    // A full restart of scanout: stop and reset the LCD engine, rewind the
    // bounce buffers to the frame's first line, refill both, start again. The
    // framebuffer is kept, so the picture itself does not change.
    //
    // esp_lcd_rgb_panel_restart() cannot do this here: under this framework's
    // CONFIG_LCD_RGB_RESTART_IN_VSYNC it is a no-op. esp_lcd_panel_init() runs
    // the driver's full start again and only rewrites registers, so it is safe
    // on a running panel; right after a vertical sync, any glitch is one frame.
    // It does not cure a slipped picture - the bounce parity onVSync() guards
    // survives it - so nothing calls it but DISPLAY_RESYNC.
    if (_panel_handle == nullptr) { return false; }
    waitVSync(50);
    return esp_lcd_panel_init(_panel_handle) == ESP_OK;
  }

  void Bus_RGB::release(void)
  {
    _driver = nullptr;
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
