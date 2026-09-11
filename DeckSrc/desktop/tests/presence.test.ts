import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presenceCard } from "../src/shared/presence";
import type { PresenceFacts, PresenceStatus } from "../src/shared/presence";
import { localDate } from "../src/shared/widgets";
import { DiscordIpc } from "../src/main/discord/discord-ipc";
import { DISCORD_APP_ID, RichPresence } from "../src/main/discord/presence";
import type { PresenceLink, PresenceSources } from "../src/main/discord/presence";

const T = 1_789_000_000_000;
const facts = (extra: Partial<PresenceFacts> = {}): PresenceFacts => ({
    connected: T,
    editing: null,
    updating: null,
    record: null,
    stream: null,
    presses: 0,
    ...extra,
});

describe("Decky's card on Discord", () => {
    it("says what is going on, most telling first, and never a page's name", () => {
        expect(presenceCard(facts({ presses: 128 }))).toEqual({
            details: "At the deck",
            state: "128 presses today",
            since: T,
        });
        expect(presenceCard(facts({ presses: 1 })).state).toBe("1 press today");
        expect(presenceCard(facts({ presses: 1234 })).state).toBe("1,234 presses today");
        // No presses yet: no second line, rather than a zero.
        expect(presenceCard(facts())).toEqual({ details: "At the deck", since: T });
        expect(presenceCard(facts({ editing: T + 5 }))).toEqual({
            details: "Editing keys",
            since: T + 5,
        });
        expect(presenceCard(facts({ connected: null }))).toEqual({ details: "Deck disconnected" });
        expect(presenceCard(facts({ record: { since: T - 9 }, editing: T }))).toMatchObject({
            details: "Recording",
            since: T - 9,
        });
        expect(presenceCard(facts({ record: "paused" }))).toEqual({ details: "Recording paused" });
        expect(
            presenceCard(facts({ stream: { since: T - 3 }, record: { since: T } })),
        ).toMatchObject({ details: "Live", since: T - 3 });
        expect(presenceCard(facts({ updating: "deck", stream: { since: T } }))).toEqual({
            details: "Updating the deck",
        });
        expect(presenceCard(facts({ updating: "app" }))).toEqual({ details: "Updating Decky" });
    });
});

/** Discord, stood in for: every command asked of it, and whether it is there. */
function fakeDiscord() {
    const sent: { cmd: string; args?: Record<string, unknown> }[] = [];
    const links: PresenceLink[] = [];
    const state = { running: true };
    const connect = vi.fn(async (clientId: string): Promise<PresenceLink> => {
        expect(clientId).toBe(DISCORD_APP_ID);
        if (!state.running) throw new Error("Discord isn't running.");
        const link: PresenceLink = {
            onClose: null,
            request: async (cmd, args) => {
                sent.push({ cmd, args });
                return {};
            },
            close: vi.fn(),
        };
        links.push(link);
        return link;
    });
    const activities = () =>
        sent
            .filter((s) => s.cmd === "SET_ACTIVITY")
            .map((s) => (s.args?.activity as Record<string, unknown> | undefined) ?? null);
    return { sent, links, state, connect, activities };
}

const files: string[] = [];
function presence(discord = fakeDiscord(), sources: Partial<PresenceSources> = {}) {
    const path = join(tmpdir(), `decky-presence-${Math.random().toString(36).slice(2)}.json`);
    files.push(path);
    const statuses: PresenceStatus[] = [];
    const service = new RichPresence(
        path,
        {
            connected: () => true,
            updating: () => null,
            outputs: () => ({ record: null, stream: null }),
            ...sources,
        },
        (status) => statuses.push(status),
        discord.connect,
    );
    return { service, discord, statuses, path };
}

afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(files.splice(0).map((file) => rm(file, { force: true })));
});

describe("Decky on Discord", () => {
    it("stays off until turned on, then shows Watching Decky with its art", async () => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(T);
        const { service, discord, path } = presence();
        await service.load();
        service.press();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(discord.connect).not.toHaveBeenCalled();
        expect(service.status()).toEqual({ enabled: false, discord: "closed", card: null });

        expect(await service.setEnabled(true)).toMatchObject({ enabled: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(discord.activities()).toEqual([
            {
                type: 3,
                details: "At the deck",
                state: "1 press today",
                timestamps: { start: T + 10_000 },
                assets: { large_image: "decky", large_text: "Decky" },
                instance: false,
            },
        ]);
        expect(discord.sent[0]!.args?.pid).toBe(process.pid);
        expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
            enabled: true,
            presses: 1,
        });
        service.stop();
    });

    it("sends a changed card at most every 4 seconds, the newest when it may", async () => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(T);
        const { service, discord } = presence();
        await service.setEnabled(true);
        await vi.advanceTimersByTimeAsync(0);
        for (let i = 0; i < 5; i++) service.press();
        service.setEditing(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(discord.activities()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(4000);
        expect(discord.activities()).toHaveLength(2);
        expect(discord.activities()[1]).toMatchObject({
            details: "Editing keys",
            state: "5 presses today",
        });
        // Nothing new: nothing sent.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(discord.activities()).toHaveLength(2);
        service.stop();
    });

    it("waits for Discord, tries it again, and comes back when it returns", async () => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(T);
        const { service, discord, statuses } = presence();
        discord.state.running = false;
        await service.setEnabled(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(discord.connect).toHaveBeenCalledTimes(1);
        expect(service.status()).toMatchObject({
            discord: "closed",
            card: { details: "At the deck" },
        });
        discord.state.running = true;
        await vi.advanceTimersByTimeAsync(6000);
        expect(discord.connect).toHaveBeenCalledTimes(2);
        expect(discord.activities()).toHaveLength(1);
        expect(statuses.at(-1)).toMatchObject({ discord: "connected" });
        // Discord quits: the link is gone, and tried again later.
        discord.links[0]!.onClose?.();
        expect(service.status().discord).toBe("closed");
        await vi.advanceTimersByTimeAsync(16_000);
        expect(discord.connect).toHaveBeenCalledTimes(3);
        expect(discord.activities()).toHaveLength(2);
        service.stop();
    });

    it("takes the card away when turned off, and lets Discord go", async () => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(T);
        const { service, discord } = presence();
        await service.setEnabled(true);
        await vi.advanceTimersByTimeAsync(0);
        await service.setEnabled(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(discord.sent.at(-1)).toEqual({ cmd: "SET_ACTIVITY", args: { pid: process.pid } });
        expect(discord.links[0]!.close).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(discord.connect).toHaveBeenCalledTimes(1);
    });

    it("follows the deck, OBS and updates, and counts presses by the day", async () => {
        vi.useFakeTimers({
            toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
        });
        vi.setSystemTime(T);
        const world = { connected: true, updating: null as "deck" | null, live: false };
        const { service, path } = presence(fakeDiscord(), {
            connected: () => world.connected,
            updating: () => world.updating,
            outputs: () => ({ record: null, stream: world.live ? { since: T - 60_000 } : null }),
        });
        // Presses saved today carry on; another day's start again.
        await writeFile(path, JSON.stringify({ enabled: true, day: localDate(T), presses: 41 }));
        await service.load();
        service.press();
        expect(service.status().card).toMatchObject({ state: "42 presses today" });
        world.live = true;
        await vi.advanceTimersByTimeAsync(2000);
        expect(service.status().card).toMatchObject({ details: "Live", since: T - 60_000 });
        world.updating = "deck";
        world.connected = false;
        await vi.advanceTimersByTimeAsync(2000);
        expect(service.status().card).toEqual({ details: "Updating the deck" });
        world.updating = null;
        world.live = false;
        await vi.advanceTimersByTimeAsync(2000);
        expect(service.status().card).toEqual({ details: "Deck disconnected" });
        vi.setSystemTime(T + 86_400_000);
        await vi.advanceTimersByTimeAsync(2000);
        service.press();
        expect(service.status().card).toEqual({ details: "Deck disconnected" });
        world.connected = true;
        await vi.advanceTimersByTimeAsync(2000);
        expect(service.status().card).toMatchObject({ state: "1 press today" });
        service.stop();
    });
});

/** Discord's pipe, stood in for on a pipe of its own: it says READY and answers commands. */
async function fakePipe(
    behave: (
        frame: { op: number; body: Record<string, unknown> },
        reply: (op: number, body: object) => void,
    ) => void,
) {
    const path = `\\\\?\\pipe\\decky-test-${Math.random().toString(36).slice(2)}`;
    const server = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        const reply = (op: number, body: object): void => {
            const json = Buffer.from(JSON.stringify(body));
            const head = Buffer.alloc(8);
            head.writeUInt32LE(op, 0);
            head.writeUInt32LE(json.length, 4);
            socket.write(Buffer.concat([head, json]));
        };
        socket.on("data", (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32LE(4)) {
                const op = buffer.readUInt32LE(0);
                const body = JSON.parse(buffer.subarray(8, 8 + buffer.readUInt32LE(4)).toString());
                buffer = buffer.subarray(8 + buffer.readUInt32LE(4));
                behave({ op, body }, reply);
            }
        });
        socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    return { path, server };
}

describe("Discord's local pipe", () => {
    it("shakes hands as Decky's application, and matches each answer to its command", async () => {
        const heard: { op: number; body: Record<string, unknown> }[] = [];
        const { path, server } = await fakePipe((frame, reply) => {
            heard.push(frame);
            if (frame.op === 0) reply(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } });
            else if (frame.body.cmd === "SET_ACTIVITY")
                reply(1, { cmd: "SET_ACTIVITY", nonce: frame.body.nonce, data: { ok: true } });
            else
                reply(1, {
                    cmd: frame.body.cmd,
                    evt: "ERROR",
                    nonce: frame.body.nonce,
                    data: { message: "No." },
                });
        });
        // A pipe that isn't there is passed over for the next.
        const ipc = await DiscordIpc.connect(DISCORD_APP_ID, [`${path}-missing`, path]);
        expect(heard[0]).toEqual({ op: 0, body: { v: 1, client_id: DISCORD_APP_ID } });
        await expect(ipc.request("SET_ACTIVITY", { pid: 1 })).resolves.toEqual({ ok: true });
        await expect(ipc.request("AUTHORIZE")).rejects.toThrow("No.");
        const closed = vi.fn();
        ipc.onClose = closed;
        ipc.close();
        expect(closed).not.toHaveBeenCalled();
        server.close();
    });

    it("answers Discord's pings, and hears it go", async () => {
        const pongs: unknown[] = [];
        let drop: (() => void) | null = null;
        const { path, server } = await fakePipe((frame, reply) => {
            if (frame.op === 0) {
                reply(1, { cmd: "DISPATCH", evt: "READY", data: {} });
                reply(3, { n: 7 });
                drop = () => reply(2, { code: 1000, message: "Bye" });
            }
            if (frame.op === 4) pongs.push(frame.body);
        });
        const ipc = await DiscordIpc.connect(DISCORD_APP_ID, [path]);
        const gone = new Promise<void>((resolve) => (ipc.onClose = resolve));
        await vi.waitFor(() => expect(pongs).toEqual([{ n: 7 }]));
        drop!();
        await gone;
        await expect(ipc.request("SET_ACTIVITY")).rejects.toThrow(/gone/);
        server.close();
    });

    it("says Discord isn't running when no pipe answers", async () => {
        await expect(
            DiscordIpc.connect(DISCORD_APP_ID, ["\\\\?\\pipe\\decky-none"]),
        ).rejects.toThrow("Discord isn't running.");
    });
});
