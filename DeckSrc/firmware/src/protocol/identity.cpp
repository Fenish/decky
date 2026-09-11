#include "protocol/identity.h"
#include <esp_system.h>

namespace {
struct Reason {
    esp_reset_reason_t reason;
    const char *name;
};
constexpr Reason REASONS[] = {
    {ESP_RST_POWERON, "poweron"}, {ESP_RST_EXT, "ext"},           {ESP_RST_SW, "sw"},
    {ESP_RST_PANIC, "panic"},     {ESP_RST_INT_WDT, "intwdt"},    {ESP_RST_TASK_WDT, "taskwdt"},
    {ESP_RST_WDT, "wdt"},         {ESP_RST_BROWNOUT, "brownout"}, {ESP_RST_USB, "usb"},
    {ESP_RST_JTAG, "jtag"},
};
}  // namespace

const char *reset_reason() {
    const esp_reset_reason_t reason = esp_reset_reason();
    for (const Reason &known : REASONS)
        if (known.reason == reason) return known.name;
    return "unknown";
}
