#pragma once

// Why the deck last started: a crash (panic), a watchdog, the supply dipping
// (brownout), or plain power-on and flashing. A crash also leaves a core dump
// in the coredump partition, which outlives a power cycle (see the README).
const char *reset_reason();
