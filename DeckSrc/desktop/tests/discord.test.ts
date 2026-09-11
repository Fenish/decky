import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfig, validateConfig } from "../src/shared/config";
import type { DeckConfig, KeyConfig } from "../src/shared/config";
import type { IntegrationStatus } from "../src/shared/integrations/integration";
import { WidgetStore } from "../src/main/widgets/widget-state";

// Windows' credential protection, stood in for: "encrypted" is reversible here.
vi.mock("electron", () => ({
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(`sealed:${text}`),
        decryptString: (sealed: Buffer) => sealed.toString().replace(/^sealed:/, ""),
    },
    net: { fetch: vi.fn() },
    shell: { openExternal: vi.fn(async () => {}) },
}));

const { DiscordService, STREAMKIT_ID } =
    await import("../src/main/integrations/discord/discord-service");
type Link = import("../src/main/integrations/discord/discord-service").DiscordLink;
const { AppControls } = await import("../src/main/actions/app-controls");
const { KeyStateStore } = await import("../src/main/actions/key-state");

const CHANNEL = "1328777481595125844";
/** A server's text channel, and a direct message's. */
const TEXT = "1328777481595125999";
const GUILD = "1328777481595120000";
const DM = "1328777481595126000";
const user = (id: string, name: string, avatar: string | null = null) => ({
    user: { id, username: name.toLowerCase(), global_name: name, avatar },
    nick: null,
    voice_state: { mute: false, deaf: false },
});
const devices = (...names: string[]) =>
    names.map((name, i) => ({ id: i === 0 ? "default" : `device-${i}`, name }));

/** Discord, stood in for: what it answers each command, and every command asked. */
function fakeDiscord() {
    const asked: { cmd: string; args?: Record<string, unknown>; evt?: string }[] = [];
    const world = {
        running: true,
        token: "good-token",
        scopes: [
            "rpc",
            "rpc.voice.write",
            "rpc.video.write",
            "rpc.screenshare.write",
            "rpc.notifications.read",
        ],
        voice: {
            mute: false,
            deaf: false,
            noise_suppression: true,
            echo_cancellation: true,
            automatic_gain_control: false,
            input: {
                device_id: "default",
                available_devices: devices("Default", "Microphone (HyperX Cloud II)"),
            },
            output: {
                device_id: "device-2",
                available_devices: devices(
                    "Default",
                    "Speakers (Realtek)",
                    "Headphones (Arctis 7)",
                ),
            },
        } as Record<string, unknown>,
        current: null as string | null,
        members: [user("111", "Ada", "abc"), user("222", "Bo")],
    };
    const links: Link[] = [];
    const answer: Record<string, (args: Record<string, unknown>) => unknown> = {
        AUTHORIZE: () => ({ code: "the-code" }),
        AUTHENTICATE: (args) => {
            if (args.access_token !== world.token) throw new Error("Invalid OAuth2 access token");
            return {
                user: { id: "999", username: "fenish", global_name: "Fenish" },
                scopes: world.scopes,
            };
        },
        GET_VOICE_SETTINGS: () => world.voice,
        GET_SELECTED_VOICE_CHANNEL: () =>
            world.current ? { id: world.current, name: "General" } : null,
        GET_CHANNEL: (args) => {
            if (args.channel_id === TEXT) return { id: TEXT, name: "chat", guild_id: GUILD };
            if (args.channel_id === DM) throw new Error("Unknown channel");
            return { id: CHANNEL, name: "General", voice_states: world.members };
        },
        SUBSCRIBE: () => ({}),
        UNSUBSCRIBE: () => ({}),
        SET_VOICE_SETTINGS: (args) => ({ ...world.voice, ...args }),
        TOGGLE_VIDEO: () => null,
        TOGGLE_SCREENSHARE: () => null,
        SELECT_VOICE_CHANNEL: (args) => {
            world.current = (args.channel_id as string | null) ?? null;
            return null;
        },
    };
    const connect = vi.fn(async (clientId: string): Promise<Link> => {
        expect(clientId).toBe(STREAMKIT_ID);
        if (!world.running) throw new Error("Discord isn't running.");
        const link: Link = {
            onClose: null,
            onEvent: null,
            request: async (cmd, args = {}, evt) => {
                asked.push({ cmd, args, ...(evt ? { evt } : {}) });
                return answer[cmd]!(args);
            },
            close: vi.fn(),
        };
        links.push(link);
        return link;
    });
    /** Discord says something unasked, on the newest link. */
    const tell = (event: string, data: Record<string, unknown>) =>
        links.at(-1)!.onEvent?.(event, data);
    return { asked, world, links, connect, tell };
}

const files: string[] = [];
function discord(
    fake = fakeDiscord(),
    path = join(tmpdir(), `decky-discord-${Math.random().toString(36).slice(2)}.json`),
) {
    files.push(path, `${path}.widgets`);
    const store = new WidgetStore(`${path}.widgets`, () => {});
    const statuses: IntegrationStatus[] = [];
    const capture = { camera: false, screen: false };
    const host = { request: vi.fn(async () => ({ ...capture })), hold: vi.fn() };
    const onControls = vi.fn();
    const focus = vi.fn();
    const visit = vi.fn(async () => {});
    const service = new DiscordService({
        store,
        settingsPath: path,
        finder: {
            installed: async () => true,
            running: async () => true,
            launch: async () => true,
        },
        host,
        onStatus: (status) => statuses.push(status),
        onControls,
        connect: fake.connect,
        exchange: async (code) => {
            expect(code).toBe("the-code");
            return fake.world.token;
        },
        image: async (url) => `data:image/png;base64,${Buffer.from(url).toString("base64")}`,
        focus,
        visit,
    });
    return { service, fake, store, statuses, capture, host, onControls, focus, visit, path };
}

/** The URL an avatar's data URL was made of (the fake `image` keeps it). */
const urlOf = (avatar: string | undefined) =>
    Buffer.from(avatar!.split(",")[1]!, "base64").toString();

/** Until the keys' own link answers: Discord's voice settings are known then. */
const linked = (service: InstanceType<typeof DiscordService>) =>
    vi.waitFor(() => expect(service.controlState("mute")).not.toBeNull());

const key = (
    action: KeyConfig["action"],
    behavior: KeyConfig["behavior"] = "normal",
): KeyConfig => ({
    label: "",
    icon: "Mic",
    color: "#eeeeee",
    behavior,
    action,
});
function profile(keys: Record<number, KeyConfig>): DeckConfig {
    const config = createConfig();
    config.pages[0]!.keys = keys;
    return config;
}

afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(files.splice(0).map((file) => rm(file, { force: true })));
});

describe("Discord for the keys that use it", () => {
    it("waits for permission, then asks for it as StreamKit and keeps it", async () => {
        const { service, fake, path } = discord();
        await service.load();
        service.sync(
            profile({ 0: key({ kind: "app", app: "discord", control: "mute" }, "toggle") }),
        );
        await vi.waitFor(() => expect(service.status().health).toBe("off"));
        expect(fake.connect).not.toHaveBeenCalled();

        expect(await service.authorize()).toMatchObject({ ok: true });
        expect(fake.asked[0]).toMatchObject({
            cmd: "AUTHORIZE",
            args: {
                client_id: STREAMKIT_ID,
                scopes: expect.arrayContaining(["rpc", "rpc.video.write"]),
            },
        });
        expect(service.status()).toMatchObject({ health: "ready", version: "Fenish" });
        // Kept for the next start, encrypted: a new service connects with it.
        const next = discord(fake, path).service;
        await next.load();
        next.sync(profile({ 0: key({ kind: "app", app: "discord", control: "mute" }, "toggle") }));
        await vi.waitFor(() => expect(next.status().health).toBe("ready"));
        service.stop();
        next.stop();
    });

    it("follows mute and deafen as Discord says, and switches them", async () => {
        const { service, fake, onControls } = discord();
        await service.authorize();
        service.sync(
            profile({ 0: key({ kind: "app", app: "discord", control: "mute" }, "toggle") }),
        );
        await vi.waitFor(() => expect(service.controlState("mute")).toBe(false));
        expect(fake.asked).toContainEqual({
            cmd: "SUBSCRIBE",
            args: {},
            evt: "VOICE_SETTINGS_UPDATE",
        });
        // Muted in Discord itself: the key follows.
        onControls.mockClear();
        fake.tell("VOICE_SETTINGS_UPDATE", { mute: true, deaf: false });
        expect(service.controlState("mute")).toBe(true);
        expect(onControls).toHaveBeenCalled();
        // From the deck: shown at once, asked of Discord.
        expect(await service.press("deafen")).toMatchObject({ ok: true });
        expect(service.controlState("deafen")).toBe(true);
        expect(fake.asked.at(-1)).toMatchObject({
            cmd: "SET_VOICE_SETTINGS",
            args: { deaf: true },
        });
        // Deafened, you are muted too, though Discord's own mute stays off: a
        // press asks for mute off, which undeafens, as Discord's mic button does.
        fake.tell("VOICE_SETTINGS_UPDATE", { mute: false, deaf: true });
        expect(service.controlState("mute")).toBe(true);
        expect(await service.press("mute")).toMatchObject({ ok: true });
        expect(fake.asked.at(-1)).toMatchObject({
            cmd: "SET_VOICE_SETTINGS",
            args: { mute: false },
        });
        service.stop();
    });

    it("reads camera and screen share from Windows, and brings Discord up to share", async () => {
        const { service, fake, capture, host, focus } = discord();
        await service.authorize();
        service.sync(
            profile({ 0: key({ kind: "app", app: "discord", control: "share" }, "toggle") }),
        );
        expect(host.hold).toHaveBeenCalledWith("discord", true);
        await linked(service);
        await vi.waitFor(() => expect(host.request).toHaveBeenCalledWith("capture"));
        // Starting a share: Discord's picker is brought up to be seen.
        expect(await service.press("share")).toMatchObject({ ok: true });
        expect(fake.asked.at(-1)).toMatchObject({ cmd: "TOGGLE_SCREENSHARE" });
        expect(focus).toHaveBeenCalledTimes(1);
        capture.screen = true;
        await vi.waitFor(() => expect(service.controlState("share")).toBe(true), { timeout: 3000 });
        // Stopping it asks nothing to be seen: Discord stays where it is.
        expect(await service.press("share")).toMatchObject({ ok: true });
        expect(focus).toHaveBeenCalledTimes(1);
        // No key needs it: Windows is let go.
        service.sync(profile({}));
        expect(host.hold).toHaveBeenLastCalledWith("discord", false);
        service.stop();
    });

    it("switches noise suppression, echo cancellation and automatic gain, and leaves a call", async () => {
        const { service, fake } = discord();
        await service.authorize();
        service.sync(
            profile({
                0: key({ kind: "app", app: "discord", control: "noise" }, "toggle"),
                1: key({ kind: "app", app: "discord", control: "leave" }),
            }),
        );
        await vi.waitFor(() => expect(service.controlState("noise")).toBe(true));
        expect(service.controlState("echo")).toBe(true);
        expect(service.controlState("gain")).toBe(false);
        expect(await service.press("gain")).toMatchObject({ ok: true });
        expect(service.controlState("gain")).toBe(true);
        expect(fake.asked.at(-1)).toMatchObject({
            cmd: "SET_VOICE_SETTINGS",
            args: { automatic_gain_control: true },
        });
        // Changed in Discord: followed, the rest of its settings kept.
        fake.tell("VOICE_SETTINGS_UPDATE", { ...fake.world.voice, noise_suppression: false });
        expect(service.controlState("noise")).toBe(false);
        // Leave call: ON while in one; pressed outside one, it says so.
        expect(service.controlState("leave")).toBe(false);
        expect(await service.press("leave")).toMatchObject({ ok: false });
        fake.tell("VOICE_CHANNEL_SELECT", { channel_id: CHANNEL });
        expect(service.controlState("leave")).toBe(true);
        expect(await service.press("leave")).toMatchObject({ ok: true });
        expect(fake.asked.at(-1)).toMatchObject({
            cmd: "SELECT_VOICE_CHANNEL",
            args: { channel_id: null },
        });
        service.stop();
    });

    it("shows the call you are in and who speaks in it, and leaves it", async () => {
        const { service, fake, store } = discord();
        await service.authorize();
        service.sync(profile({ 4: key({ kind: "widget", widget: { type: "discord-call" } }) }));
        await linked(service);
        expect(store.get("home:4")?.voice).toMatchObject({ health: "ready", members: [] });
        const failed = vi.fn();
        expect(service.leave(failed)).toMatch(/aren't in a call/);
        // You join a call in Discord: the key shows it, and follows who speaks there.
        fake.world.current = CHANNEL;
        fake.tell("VOICE_CHANNEL_SELECT", { channel_id: CHANNEL });
        await vi.waitFor(() =>
            expect(store.get("home:4")?.voice?.members.map((m) => m.name)).toEqual(["Ada", "Bo"]),
        );
        expect(store.get("home:4")?.voice).toMatchObject({ name: "General", joined: true });
        expect(fake.asked).toContainEqual({
            cmd: "SUBSCRIBE",
            args: { channel_id: CHANNEL },
            evt: "SPEAKING_START",
        });
        fake.tell("SPEAKING_START", { user_id: "222" });
        expect(store.get("home:4")?.voice?.members.map((m) => m.speaking === true)).toEqual([
            false,
            true,
        ]);
        fake.tell("SPEAKING_STOP", { user_id: "222" });
        expect(store.get("home:4")?.voice?.members.some((m) => m.speaking)).toBe(false);
        // A tap leaves it.
        expect(service.leave(failed)).toMatch(/Leaving/);
        await vi.waitFor(() =>
            expect(fake.asked.at(-1)).toMatchObject({
                cmd: "SELECT_VOICE_CHANNEL",
                args: { channel_id: null },
            }),
        );
        fake.tell("VOICE_CHANNEL_SELECT", { channel_id: null });
        expect(store.get("home:4")?.voice).toMatchObject({ members: [], joined: false });
        expect(fake.asked).toContainEqual({
            cmd: "UNSUBSCRIBE",
            args: { channel_id: CHANNEL },
            evt: "SPEAKING_START",
        });
        expect(failed).not.toHaveBeenCalled();
        service.stop();
    });

    it("moves Discord to its next microphone, and output, round again after the last", async () => {
        const { service, fake, store } = discord();
        await service.authorize();
        service.sync(
            profile({
                0: key({ kind: "widget", widget: { type: "discord-input" } }),
                1: key({ kind: "widget", widget: { type: "discord-output" } }),
            }),
        );
        await vi.waitFor(() =>
            expect(store.get("home:0")?.choice).toEqual({
                reachable: true,
                name: "Default",
                index: 0,
                count: 2,
            }),
        );
        const failed = vi.fn();
        expect(service.nextDevice("input", failed)).toMatch(/HyperX Cloud II/);
        expect(store.get("home:0")?.choice).toMatchObject({ index: 1 });
        expect(fake.asked.at(-1)).toMatchObject({
            cmd: "SET_VOICE_SETTINGS",
            args: { input: { device_id: "device-1" } },
        });
        // The output was on the last: the first comes next.
        expect(store.get("home:1")?.choice).toMatchObject({ name: "Headphones (Arctis 7)" });
        expect(service.nextDevice("output", failed)).toMatch(/Default/);
        expect(store.get("home:1")?.choice).toMatchObject({ name: "Default", index: 0, count: 3 });
        expect(failed).not.toHaveBeenCalled();
        service.stop();
    });

    it("keeps a switcher out of reach until Discord, just started, has listed its devices", async () => {
        const { service, fake, store } = discord();
        const listed = fake.world.voice.input;
        // Just started: the device it uses is known, the list not yet - Discord's
        // stand-in holds its place, under the id of the default device.
        fake.world.voice = {
            ...fake.world.voice,
            input: {
                device_id: "default",
                available_devices: [{ id: "default", name: "No Input Devices" }],
            },
        };
        await service.authorize();
        const shown: unknown[] = [];
        const set = store.set.bind(store);
        store.set = (address, state, persist) => {
            if (address === "home:0") shown.push(state.choice);
            return set(address, state, persist);
        };
        service.sync(profile({ 0: key({ kind: "widget", widget: { type: "discord-input" } }) }));
        await linked(service);
        // Discord says its settings as soon as it is subscribed to: still no list.
        fake.tell("VOICE_SETTINGS_UPDATE", fake.world.voice);
        await vi.waitFor(() =>
            expect(fake.asked.some((asked) => asked.cmd === "GET_SELECTED_VOICE_CHANNEL")).toBe(
                true,
            ),
        );
        // Then its media engine lists them: one change, straight to the device.
        fake.tell("VOICE_SETTINGS_UPDATE", { ...fake.world.voice, input: listed });
        expect(store.get("home:0")?.choice).toEqual({
            reachable: true,
            name: "Default",
            index: 0,
            count: 2,
        });
        expect(shown.filter((choice) => (choice as { reachable: boolean }).reachable)).toHaveLength(
            1,
        );
        service.stop();
    });

    it("counts notifications, keeps them, and opens the last one's conversation", async () => {
        const { service, fake, store, visit, focus, path } = discord();
        await service.authorize();
        service.sync(
            profile({ 0: key({ kind: "widget", widget: { type: "discord-notifications" } }) }),
        );
        await linked(service);
        expect(store.get("home:0")?.inbox).toEqual({ health: "ready", unread: 0 });
        expect(fake.asked).toContainEqual({
            cmd: "SUBSCRIBE",
            args: {},
            evt: "NOTIFICATION_CREATE",
        });
        // With none, a tap brings Discord up as it was.
        expect(service.openInbox(vi.fn())).toMatch(/Opening Discord/);
        expect(focus).toHaveBeenCalled();
        const note = (channel: string, id: string, name: string) =>
            fake.tell("NOTIFICATION_CREATE", {
                channel_id: channel,
                icon_url: `https://cdn.discordapp.com/avatars/${id}/face.png`,
                title: `${name} (#chat)`,
                message: { author: { id, username: name.toLowerCase(), global_name: name } },
            });
        note(DM, "111", "Ada");
        note(TEXT, "222", "Bo");
        await vi.waitFor(() => expect(store.get("home:0")?.inbox?.from?.avatar).toBeDefined());
        const inbox = store.get("home:0")!.inbox!;
        expect(inbox).toMatchObject({ unread: 2, from: { name: "Bo" } });
        expect(urlOf(inbox.from!.avatar)).toBe("https://cdn.discordapp.com/avatars/222/face.png");
        // Kept: Decky started again shows them still, with the token.
        await vi.waitFor(async () =>
            expect(JSON.parse(await readFile(path, "utf8")).inbox).toMatchObject({ unread: 2 }),
        );
        const again = discord(fakeDiscord(), path);
        await again.service.load();
        again.service.sync(
            profile({ 0: key({ kind: "widget", widget: { type: "discord-notifications" } }) }),
        );
        await linked(again.service);
        expect(again.store.get("home:0")?.inbox).toMatchObject({
            health: "ready",
            unread: 2,
            from: { name: "Bo" },
        });
        again.service.stop();
        // A tap opens Bo's channel, in its server, and counts again from nothing.
        const failed = vi.fn();
        expect(service.openInbox(failed)).toMatch(/conversation/);
        await vi.waitFor(() =>
            expect(visit).toHaveBeenCalledWith(`discord://-/channels/${GUILD}/${TEXT}`),
        );
        expect(store.get("home:0")?.inbox).toEqual({ health: "ready", unread: 0 });
        // A direct message's: among your direct messages.
        note(DM, "111", "Ada");
        service.openInbox(failed);
        await vi.waitFor(() =>
            expect(visit).toHaveBeenLastCalledWith(`discord://-/channels/@me/${DM}`),
        );
        expect(failed).not.toHaveBeenCalled();
        service.stop();
    });

    it("leaves only the notifications key waiting when the permission predates them", async () => {
        const { service, fake, store } = discord();
        fake.world.scopes = fake.world.scopes.filter((scope) => scope !== "rpc.notifications.read");
        await service.authorize();
        service.sync(
            profile({
                0: key({ kind: "widget", widget: { type: "discord-notifications" } }),
                1: key({ kind: "app", app: "discord", control: "mute" }, "toggle"),
            }),
        );
        await linked(service);
        expect(store.get("home:0")?.inbox?.health).toBe("denied");
        expect(service.status().health).toBe("ready");
        expect(service.controlState("mute")).toBe(false);
        expect(fake.asked.some((asked) => asked.evt === "NOTIFICATION_CREATE")).toBe(false);
        service.stop();
    });

    it("shows who is in a voice channel, with avatars, and joins or leaves it", async () => {
        const { service, fake, store } = discord();
        await service.authorize();
        const config = profile({
            4: key({ kind: "widget", widget: { type: "discord-channel", channel: CHANNEL } }),
        });
        service.sync(config);
        await vi.waitFor(() =>
            expect(store.get("home:4")?.voice?.members.map((m) => m.avatar !== undefined)).toEqual([
                true,
                true,
            ]),
        );
        const voice = store.get("home:4")!.voice!;
        expect(voice).toMatchObject({ health: "ready", name: "General", joined: false });
        expect(voice.members.map((m) => m.name)).toEqual(["Ada", "Bo"]);
        // Ada's own avatar; Bo has none, so Discord's default for him.
        expect(Buffer.from(voice.members[0]!.avatar!.split(",")[1]!, "base64").toString()).toBe(
            "https://cdn.discordapp.com/avatars/111/abc.png?size=64",
        );
        expect(Buffer.from(voice.members[1]!.avatar!.split(",")[1]!, "base64").toString()).toMatch(
            /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/,
        );
        // Someone joins: Discord's event makes it read the channel again.
        fake.world.members.push(user("333", "Cy"));
        fake.tell("VOICE_STATE_CREATE", {});
        await vi.waitFor(() => expect(store.get("home:4")?.voice?.members).toHaveLength(3));
        // A tap joins; Discord says you are in it; a tap leaves.
        const failed = vi.fn();
        expect(service.joinOrLeave(CHANNEL, failed)).toMatch(/Joining/);
        await vi.waitFor(() =>
            expect(fake.asked.at(-1)).toMatchObject({
                cmd: "SELECT_VOICE_CHANNEL",
                args: { channel_id: CHANNEL, force: true },
            }),
        );
        fake.tell("VOICE_CHANNEL_SELECT", { channel_id: CHANNEL });
        expect(store.get("home:4")?.voice?.joined).toBe(true);
        expect(service.joinOrLeave(CHANNEL, failed)).toMatch(/Leaving/);
        await vi.waitFor(() =>
            expect(fake.asked.at(-1)).toMatchObject({ args: { channel_id: null } }),
        );
        expect(failed).not.toHaveBeenCalled();
        expect(await service.call("currentChannel")).toBeNull();
        service.stop();
    });

    it("asks for permission again when Discord refuses the token", async () => {
        const { service, fake } = discord();
        await service.authorize();
        fake.world.token = "another-token";
        service.sync(
            profile({ 0: key({ kind: "app", app: "discord", control: "mute" }, "toggle") }),
        );
        // A fresh link, as after a restart.
        (service as unknown as { drop(): void }).drop();
        service.sync(
            profile({ 0: key({ kind: "app", app: "discord", control: "mute" }, "toggle") }),
        );
        await vi.waitFor(() => expect(service.status().health).toBe("denied"));
        expect(await service.press("mute")).toMatchObject({ ok: false });
        service.stop();
    });
});

describe("keys with an app's control", () => {
    it("are valid as toggles, and name a control the app has", () => {
        const good = profile({
            0: key({ kind: "app", app: "discord", control: "camera" }, "toggle"),
        });
        expect(() => validateConfig(good)).not.toThrow();
        const bad = profile({
            0: key({ kind: "app", app: "discord", control: "teleport" }, "toggle"),
        });
        expect(() => validateConfig(bad)).toThrow();
    });

    it("follow the app's state as toggles, however it was switched", () => {
        const config = profile({
            0: key({ kind: "app", app: "discord", control: "mute" }, "toggle"),
            1: key({ kind: "app", app: "discord", control: "mute" }, "normal"),
        });
        const keyStates = new KeyStateStore();
        let muted: boolean | null = null;
        const shown: string[] = [];
        const controls = new AppControls(
            { config } as never,
            keyStates,
            { showToggles: (page: string) => (shown.push(page), null) } as never,
            { discord: { controlState: () => muted } } as never,
        );
        controls.refresh();
        expect(shown).toEqual([]);
        muted = true;
        controls.refresh();
        expect(keyStates.snapshot()).toEqual({ "home:0": true });
        expect(shown).toEqual(["home"]);
        // A press does not flip it: the app's word does.
        expect(keyStates.complete("home", 0, config.pages[0]!.keys[0]!, true)).toBe(false);
        muted = false;
        controls.refresh();
        expect(keyStates.snapshot()).toEqual({});
    });
});
