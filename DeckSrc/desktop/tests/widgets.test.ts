import { describe, expect, it, vi } from "vitest";
import { formatDuration, runTime } from "../src/shared/widgets";
import {
    defaultWidget,
    nextChange,
    validWidget,
    WIDGET_CHOICES,
} from "../src/shared/widgets/registry";
import { clockParts } from "../src/shared/widgets/clock";
import {
    countdownEnd,
    stepTimer,
    TIMER_STEPS,
    timerSeconds,
    timerView,
} from "../src/shared/widgets/timer";
import { pomodoroSkip, pomodoroView } from "../src/shared/widgets/pomodoro";
import { daysUntil } from "../src/shared/widgets/countdown";
import type { Widget } from "../src/shared/widgets";
import { dialTimer, pressWidget, WidgetStore } from "../src/main/widgets/widget-state";
import { PingWatcher, pingHost } from "../src/main/widgets/ping";
import { createConfig, validateConfig } from "../src/shared/config";

const MINUTE = 60_000;
// 2026-09-11 14:05:09.250 UTC
const NOW = Date.UTC(2026, 8, 11, 14, 5, 9, 250);

describe("widget defaults and validation", () => {
    it("gives every widget type valid defaults", () => {
        for (const choice of WIDGET_CHOICES)
            expect(validWidget(defaultWidget(choice.type))).toBe(true);
    });
    it("rejects settings outside their ranges", () => {
        const clock = defaultWidget("clock") as Extract<Widget, { type: "clock" }>;
        expect(validWidget({ ...clock, timeZone: "Mars/Olympus" })).toBe(false);
        expect(validWidget({ ...clock, timeZone: "Europe/Istanbul" })).toBe(true);
        expect(validWidget({ type: "timer", mode: "countdown", seconds: 0 })).toBe(false);
        expect(validWidget({ type: "pomodoro", focus: 25, rest: 0 })).toBe(false);
        expect(validWidget({ type: "countdown", date: "2026-9-1", title: "" })).toBe(false);
        expect(validWidget({ type: "counter", start: 0, step: 0 })).toBe(false);
        for (const host of ["google.com", "192.168.1.1", "nas.local", "::1", "fe80::1"])
            expect(validWidget({ type: "ping", host, interval: 5 })).toBe(true);
        // Nothing ping.exe could take for an option, and no URLs or ports.
        for (const host of ["-t", "https://google.com", "10.0.0.5:22", "a b", ""])
            expect(validWidget({ type: "ping", host, interval: 5 })).toBe(false);
        expect(validWidget({ type: "ping", host: "google.com", interval: 1 })).toBe(false);
        expect(validWidget({ type: "note", text: "   ", size: "medium" })).toBe(false);
        expect(validWidget({ type: "weather" })).toBe(false);
    });
});

describe("timers", () => {
    it("counts run time across pauses", () => {
        const paused = { running: false, elapsed: 90_000 };
        expect(runTime(paused, NOW)).toBe(90_000);
        expect(runTime({ running: true, since: NOW - 30_000, elapsed: 90_000 }, NOW)).toBe(120_000);
        expect(runTime(undefined, NOW)).toBe(0);
    });
    it("formats minutes, and hours past the hour", () => {
        expect(formatDuration(65_000)).toBe("1:05");
        expect(formatDuration(3_723_000)).toBe("1:02:03");
        expect(formatDuration(64_001, true)).toBe("1:05");
    });
    it("counts a countdown down to zero and a stopwatch up", () => {
        const countdown = { type: "timer", mode: "countdown", seconds: 300 } as const;
        expect(timerView(countdown, undefined, NOW).text).toBe("5:00");
        const running = { running: true, since: NOW - 61_000, elapsed: 0 };
        expect(timerView(countdown, running, NOW)).toMatchObject({ text: "3:59", done: false });
        expect(timerView(countdown, { elapsed: 400_000 }, NOW)).toMatchObject({
            text: "0:00",
            done: true,
        });
        const stopwatch = { type: "timer", mode: "stopwatch", seconds: 300 } as const;
        expect(timerView(stopwatch, running, NOW).text).toBe("1:01");
    });
});

describe("pomodoro", () => {
    const pomodoro = { type: "pomodoro", focus: 25, rest: 5 } as const;
    it("alternates focus and rest from the run time alone", () => {
        expect(pomodoroView(pomodoro, undefined, NOW)).toMatchObject({
            phase: "focus",
            text: "25:00",
            rounds: 0,
        });
        expect(pomodoroView(pomodoro, { elapsed: 26 * MINUTE }, NOW)).toMatchObject({
            phase: "rest",
            text: "4:00",
            rounds: 0,
        });
        expect(pomodoroView(pomodoro, { elapsed: 31 * MINUTE }, NOW)).toMatchObject({
            phase: "focus",
            text: "24:00",
            rounds: 1,
        });
    });
    it("skips to the start of the next phase", () => {
        expect(pomodoroSkip(pomodoro, { elapsed: 3 * MINUTE }, NOW)).toBe(25 * MINUTE);
        expect(pomodoroSkip(pomodoro, { elapsed: 27 * MINUTE }, NOW)).toBe(30 * MINUTE);
    });
});

describe("clock and countdown", () => {
    const clock = defaultWidget("clock") as Extract<Widget, { type: "clock" }>;
    it("shows 24-hour and 12-hour time in the chosen time zone", () => {
        expect(clockParts({ ...clock, timeZone: "UTC" }, NOW).time).toBe("14:05");
        // Two-digit hours in both formats: 02, not 2.
        expect(clockParts({ ...clock, timeZone: "UTC", hour12: true }, NOW)).toMatchObject({
            hour: "02",
            time: "02:05",
            period: "PM",
        });
        expect(clockParts({ ...clock, timeZone: "UTC" }, Date.UTC(2026, 0, 1, 2, 39)).time).toBe(
            "02:39",
        );
        expect(clockParts({ ...clock, timeZone: "UTC", seconds: true }, NOW).time).toBe("14:05:09");
        expect(clockParts({ ...clock, timeZone: "Asia/Tokyo" }, NOW).time).toBe("23:05");
        expect(
            clockParts({ ...clock, timeZone: "UTC", hour12: true }, Date.UTC(2026, 0, 1, 0, 7))
                .time,
        ).toBe("12:07");
    });
    it("counts whole days to a date", () => {
        const noon = new Date(2026, 8, 11, 12).getTime();
        expect(daysUntil("2026-09-11", noon)).toBe(0);
        expect(daysUntil("2026-09-12", noon)).toBe(1);
        expect(daysUntil("2026-12-25", noon)).toBe(105);
        expect(daysUntil("2026-09-01", noon)).toBe(-10);
    });
});

describe("when a widget's picture next changes", () => {
    it("ticks clocks on the second or the minute", () => {
        const clock = defaultWidget("clock") as Extract<Widget, { type: "clock" }>;
        expect(nextChange({ ...clock, seconds: true }, undefined, NOW)).toBe(750);
        expect(nextChange(clock, undefined, NOW)).toBe(MINUTE - 9_250);
    });
    it("ticks timers only while they run, on their own seconds", () => {
        const timer = defaultWidget("timer");
        expect(nextChange(timer, { running: false, elapsed: 5_000 }, NOW)).toBeNull();
        expect(nextChange(timer, { running: true, since: NOW - 1_300, elapsed: 0 }, NOW)).toBe(700);
    });
    it("waits for an event for counters, notes and pings", () => {
        for (const type of ["counter", "note", "ping"] as const)
            expect(nextChange(defaultWidget(type), undefined, NOW)).toBeNull();
    });
});

describe("pressing a widget", () => {
    const at = 1_000_000;
    it("starts, pauses and resets a timer, and a tap sets a finished countdown back", () => {
        const timer = { type: "timer", mode: "countdown", seconds: 60 } as const;
        const started = pressWidget(timer, undefined, false, at);
        expect(started.state).toEqual({ running: true, since: at, elapsed: 0 });
        const paused = pressWidget(timer, started.state, false, at + 10_000);
        expect(paused.state).toEqual({ running: false, elapsed: 10_000 });
        expect(pressWidget(timer, paused.state, false, at + 20_000).state).toEqual({
            running: true,
            since: at + 20_000,
            elapsed: 10_000,
        });
        expect(pressWidget(timer, paused.state, true, at).state).toBeUndefined();
        // Ended and still ringing: the tap stops it and sets it back, not going.
        const ended = { running: true, since: at - 61_000, elapsed: 0 };
        expect(pressWidget(timer, ended, false, at).state).toBeUndefined();
        const picked = { ...ended, picked: { seconds: 45, over: 60 } };
        const wheel = { ...timer, adjustable: true };
        expect(pressWidget(wheel, picked, false, at).state).toEqual({
            picked: { seconds: 45, over: 60 },
        });
    });
    it("rings a running countdown at its end, unless its sound is off", () => {
        const timer = { type: "timer", mode: "countdown", seconds: 60 } as const;
        const running = { running: true, since: at, elapsed: 20_000 };
        expect(countdownEnd(timer, running)).toBe(at + 40_000);
        expect(countdownEnd({ ...timer, sound: false }, running)).toBeNull();
        expect(countdownEnd(timer, { running: false, elapsed: 20_000 })).toBeNull();
        expect(countdownEnd({ ...timer, mode: "stopwatch" }, running)).toBeNull();
        // A time picked on the deck rings at its own end.
        const picked = { ...running, picked: { seconds: 90, over: 60 } };
        expect(countdownEnd({ ...timer, adjustable: true }, picked)).toBe(at + 70_000);
        expect(validWidget({ ...timer, sound: "on" })).toBe(false);
    });
    it("counts a counter by its step and holds back to the start", () => {
        const counter = { type: "counter", start: 10, step: 5 } as const;
        expect(pressWidget(counter, undefined, false, at).state).toEqual({ value: 15 });
        expect(pressWidget(counter, { value: 15 }, false, at).state).toEqual({ value: 20 });
        expect(pressWidget(counter, { value: 20 }, true, at).state).toBeUndefined();
    });
    it("skips a pomodoro to its next phase, running or not", () => {
        const pomodoro = { type: "pomodoro", focus: 25, rest: 5 } as const;
        const skipped = pressWidget(
            pomodoro,
            { running: true, since: at, elapsed: 0 },
            true,
            at + MINUTE,
        );
        expect(skipped.state).toEqual({ running: true, since: at + MINUTE, elapsed: 25 * MINUTE });
        expect(pressWidget(pomodoro, { elapsed: 0 }, true, at).state).toEqual({
            elapsed: 25 * MINUTE,
        });
    });
    it("leaves clocks, countdowns and notes alone", () => {
        for (const type of ["clock", "countdown", "note"] as const)
            expect(pressWidget(defaultWidget(type), undefined, false, at).message).toBe("");
    });
});

describe("a countdown set on the deck", () => {
    const countdown = { type: "timer", mode: "countdown", seconds: 300, adjustable: true } as const;
    it("steps 10 seconds to a minute, minutes to an hour, then 5 minutes to 3 hours", () => {
        expect(TIMER_STEPS.slice(0, 7)).toEqual([10, 20, 30, 40, 50, 60, 120]);
        expect(TIMER_STEPS[TIMER_STEPS.indexOf(3600) + 1]).toBe(3900);
        expect(TIMER_STEPS.at(-1)).toBe(10_800);
        expect(stepTimer(300, 1)).toBe(360);
        expect(stepTimer(300, -2)).toBe(180);
        expect(stepTimer(60, -1)).toBe(50);
        expect(stepTimer(3600, 1)).toBe(3900);
        // A time set in the app between two steps goes to the next one either way.
        expect(stepTimer(450, 1)).toBe(480);
        expect(stepTimer(450, -1)).toBe(420);
        // And the wheel stops at its ends.
        expect(stepTimer(10, -3)).toBe(10);
        expect(stepTimer(10_800, 5)).toBe(10_800);
        expect(stepTimer(86_399, -1)).toBe(10_800);
    });
    it("runs the picked time until the time set in the app changes", () => {
        const picked = { picked: { seconds: 420, over: 300 } };
        expect(timerSeconds(countdown, picked)).toBe(420);
        expect(timerView(countdown, picked, NOW).text).toBe("7:00");
        expect(timerSeconds({ ...countdown, seconds: 600 }, picked)).toBe(600);
        expect(timerSeconds({ ...countdown, adjustable: false }, picked)).toBe(300);
    });
    it("turns only while stopped, and keeps its time through start, pause and reset", () => {
        const dialed = dialTimer(countdown, undefined, 2)!;
        expect(dialed).toEqual({ picked: { seconds: 420, over: 300 } });
        // A paused countdown starts over from the new time.
        expect(dialTimer(countdown, { ...dialed, elapsed: 30_000 }, 1)).toEqual({
            picked: { seconds: 480, over: 300 },
        });
        const running = pressWidget(countdown, dialed, false, 1000).state;
        expect(running).toMatchObject({ running: true, picked: { seconds: 420 } });
        expect(dialTimer(countdown, running, 1)).toBeNull();
        expect(pressWidget(countdown, running, true, 2000).state).toEqual(dialed);
        expect(dialTimer({ ...countdown, adjustable: false }, undefined, 1)).toBeNull();
    });
    it("accepts the switch in a profile", () => {
        expect(validWidget(countdown)).toBe(true);
        expect(validWidget({ ...countdown, adjustable: "yes" })).toBe(false);
    });
});

describe("ping", () => {
    it("counts a refused connection as an answer", async () => {
        // Nothing listens on port 443 here, and the refusal is a round trip.
        const result = await pingHost("127.0.0.1");
        expect(result.up).toBe(true);
        expect(result.ms).toBeGreaterThanOrEqual(0);
    });
    it("pings each ping widget at once, on its interval, and when tapped", async () => {
        const hosts: string[] = [];
        let answer: (result: { up: boolean; ms?: number }) => void = () => {};
        const store = new WidgetStore("/fixture/widgets.json", () => {});
        const watcher = new PingWatcher(store, (host) => {
            hosts.push(host);
            return new Promise((resolve) => (answer = resolve));
        });
        const config = createConfig();
        config.pages[0]!.keys["3"] = {
            label: "",
            icon: "Activity",
            color: "#eee8da",
            action: { kind: "widget", widget: { type: "ping", host: "nas.local", interval: 5 } },
        };
        watcher.sync(config);
        expect(hosts).toEqual(["nas.local"]);
        // A tap while a ping is out does not send a second one.
        watcher.now("home:3");
        expect(hosts).toHaveLength(1);
        answer({ up: true, ms: 12 });
        await vi.waitFor(() => expect(store.get("home:3")).toMatchObject({ up: true, ms: 12 }));
        watcher.now("home:3");
        expect(hosts).toHaveLength(2);
        watcher.stop();
    });
});

describe("widget keys in a profile", () => {
    const withKey = (key: Record<string, unknown>) => {
        const config = createConfig();
        config.pages[0]!.keys["0"] = {
            label: "",
            icon: "Clock",
            color: "#eee8da",
            action: { kind: "widget", widget: defaultWidget("clock") },
            ...key,
        } as never;
        return config;
    };
    it("accepts a widget key and refuses one set to toggle or with bad settings", () => {
        expect(() => validateConfig(withKey({}))).not.toThrow();
        expect(() => validateConfig(withKey({ behavior: "toggle" }))).toThrow(/normal buttons/);
        expect(() =>
            validateConfig(
                withKey({
                    action: { kind: "widget", widget: { type: "timer", mode: "stopwatch" } },
                }),
            ),
        ).toThrow(/action settings/);
    });
});
