/*---------------------------------------------------------------
 * Discord for the keys that use it, through its local RPC as Discord
 * StreamKit - Discord's own overlay app, whose permission any user can give
 * (Decky's own application cannot get RPC). While any key uses Discord,
 * Decky keeps a link to it, trying again every few seconds while it is
 * closed, and follows what it says:
 *
 *  - its voice settings, the moment they change (VOICE_SETTINGS_UPDATE):
 *    mute, deafen, noise suppression, echo cancellation, automatic gain, and
 *    the microphone and output it uses among the ones it could;
 *  - camera and screen share, which Discord's RPC does not say: Windows'
 *    record of what Discord uses, read every second while a key has them;
 *  - each voice channel a key shows, and the call you are in: who is in it,
 *    their avatars, whether you are, and who speaks - in your call only, as
 *    Discord says it for no other. Voice state events do not name their
 *    channel, so any of them reads the channels again, and a slow read keeps
 *    them current besides;
 *  - its notifications (NOTIFICATION_CREATE): how many came since the key was
 *    last tapped, and from whom - kept with the token, so a restart keeps
 *    them. Discord says only what comes while Decky is linked: no RPC reads
 *    unread counts.
 *
 * Controls (CONTROLS) are keys' actions; a toggle key's ON follows them
 * (AppControls, onControls). Widget keys show what STATES makes of Discord,
 * and their taps are methods here (joinOrLeave, leave, nextDevice,
 * openInbox). Permission is asked once (authorize): Discord shows
 * StreamKit's Authorize, StreamKit's server turns its code into a token that
 * lasts 7 days, kept here encrypted (safeStorage). A token refused or run out
 * asks for permission again; one given before notifications were asked for
 * leaves only the notifications key waiting for it.
 *--------------------------------------------------------------*/

import { net, safeStorage, shell } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Reply } from "../../../shared/api";
import { isWidgetKey, keyAddress } from "../../../shared/config";
import type { DeckConfig } from "../../../shared/config";
import { discordIntegration } from "../../../shared/integrations/discord";
import type {
    IntegrationHealth,
    IntegrationStatus,
} from "../../../shared/integrations/integration";
import type { Widget, WidgetState } from "../../../shared/widgets";
import type {
    DeviceFlow,
    DiscordInbox,
    DiscordWidget,
    VoiceChannel,
    VoiceMember,
} from "../../../shared/widgets/discord";
import { choiceOf, nextChoice } from "../../../shared/widgets/choice";
import type { Choice } from "../../../shared/widgets/choice";
import { DiscordIpc } from "../../discord/discord-ipc";
import type { WidgetStore } from "../../widgets/widget-state";
import type { IntegrationService } from "../integration";
import type { DiscordFinder } from "./discord-finder";

/** Discord StreamKit Overlay: the application Decky asks for RPC as. */
export const STREAMKIT_ID = "207646673902501888";
const TOKEN_URL = "https://streamkit.discord.com/overlay/token";
const NOTIFICATIONS = "rpc.notifications.read";
/** Voice settings, the camera and screen share toggles, and notifications. */
const SCOPES = [
    "rpc",
    "rpc.voice.write",
    "rpc.video.write",
    "rpc.screenshare.write",
    NOTIFICATIONS,
];
/** When to try Discord again; without permission, only when asked. */
const RETRY_MS: Record<Exclude<IntegrationHealth, "ready">, number | null> = {
    closed: 3000,
    missing: 15_000,
    off: null,
    denied: null,
};
const CAPTURE_MS = 1000;
const CHANNELS_MS = 15_000;
/** How long Discord's Authorize may wait for a click. */
const AUTHORIZE_MS = 120_000;
/** How long Open Discord waits for it to start, and how often it tries it meanwhile. */
const START_WAIT_MS = 30_000;
const START_LOOK_MS = 1500;
/** How long joining or leaving a channel may take Discord. */
const MOVE_MS = 15_000;
const VOICE_STATE_EVENTS = ["VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE"];
const SPEAKING_EVENTS = ["SPEAKING_START", "SPEAKING_STOP"];
const FLOWS: readonly DeviceFlow[] = ["input", "output"];
/** Each flow's device as a message says it. */
const DEVICE_WORDS: Record<DeviceFlow, string> = { input: "microphone", output: "output" };
/**
 * Discord's voice switches, by the control that flips each: its field in
 * Discord's voice settings, and one that turns it on too. Deafened, you are
 * muted - Discord counts you so - though its `mute` stays as you left it; a
 * press then asks for mute off, and Discord undeafens you, as its own mic
 * button does.
 */
const SWITCHES: Record<string, { field: string; also?: string }> = {
    mute: { field: "mute", also: "deaf" },
    deafen: { field: "deaf" },
    noise: { field: "noise_suppression" },
    echo: { field: "echo_cancellation" },
    gain: { field: "automatic_gain_control" },
};
/** Discord's stand-in device (its id), all a list holds before its media engine has listed any, or with none. */
const NO_DEVICE = "default";

/** Whether Discord has listed a flow's devices: more than its stand-in. */
const listed = (list: { id: string }[]): boolean =>
    list.length > 1 || (list.length === 1 && list[0]!.id !== NO_DEVICE);

/** The link to Discord, as this needs it (DiscordIpc). */
export interface DiscordLink {
    request(
        cmd: string,
        args?: Record<string, unknown>,
        evt?: string,
        timeoutMs?: number,
    ): Promise<unknown>;
    onClose: (() => void) | null;
    onEvent: ((event: string, data: Record<string, unknown>) => void) | null;
    close(): void;
}

/** What the service is made of; what is left out is the real thing (tests stand in for it). */
export interface DiscordParts {
    store: WidgetStore;
    settingsPath: string;
    finder: DiscordFinder;
    /** The Windows helper: camera and screen capture (windows-host.ps1's "capture"). */
    host: {
        request<T>(op: string): Promise<T>;
        hold(who: string, needed: boolean): void;
    };
    onStatus: (status: IntegrationStatus) => void;
    /** A control's state changed: keys that follow it catch up (AppControls). */
    onControls: () => void;
    connect?: (clientId: string) => Promise<DiscordLink>;
    /** StreamKit's server: a code for a token. */
    exchange?: (code: string) => Promise<string>;
    /** An image, as a data URL; null when it cannot be had. */
    image?: (url: string) => Promise<string | null>;
    /** Bring Discord to the front, over what the user was doing, as it was left. */
    focus?: () => void;
    /** Open a discord:// link: Discord goes there. */
    visit?: (url: string) => Promise<void>;
    /** A line for discord.log: how the link came and went, and Discord's devices. */
    log?: (line: string) => void;
}

type Data = Record<string, unknown>;
/** A person in a channel, with where their avatar is. */
type Member = { id: string; name: string; url: string };
type DiscordKey = { address: string; widget: DiscordWidget };
/** The notifications since the key was last tapped: how many, the last one's sender, and where. */
type Inbox = { unread: number; from?: { name: string; url: string }; channel?: string };

function textOf(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** A user's name, as Discord shows it: their display name, else their username. */
function nameOf(user: unknown): string {
    const u = (user ?? {}) as Data;
    return textOf(u.global_name) || textOf(u.username);
}

/** Where a user's avatar is: their own, or Discord's default for them. */
function avatarUrl(user: Data): string {
    const id = textOf(user.id);
    const hash = textOf(user.avatar);
    if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
    const index = /^\d+$/.test(id) ? Number((BigInt(id) >> 22n) % 6n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function memberOf(state: unknown): Member | null {
    const s = (state ?? {}) as Data;
    const user = (s.user ?? {}) as Data;
    const id = textOf(user.id);
    if (!id) return null;
    return { id, name: textOf(s.nick) || nameOf(user), url: avatarUrl(user) };
}

const isDiscordWidget = (widget: Widget): widget is DiscordWidget =>
    widget.type.startsWith("discord-");
/** The keys that show a voice channel's people. */
const VOICE_TYPES = new Set<string>(["discord-channel", "discord-call"]);

/** The notifications counted, as they were kept; nothing, from anything else. */
function inboxOf(saved: unknown): Inbox {
    const s = (saved ?? {}) as Data;
    const from = (s.from ?? {}) as Data;
    const name = textOf(from.name);
    if (typeof s.unread !== "number" || !Number.isInteger(s.unread) || s.unread < 1 || !name)
        return { unread: 0 };
    const channel = textOf(s.channel);
    return {
        unread: s.unread,
        from: { name, url: textOf(from.url) },
        ...(channel ? { channel } : {}),
    };
}

/** Voice settings with what Discord just said over them; its devices, a level deeper. */
function mergeSettings(previous: Data | null, said: unknown): Data {
    const now = (said ?? {}) as Data;
    const merged: Data = { ...previous, ...now };
    for (const flow of FLOWS)
        merged[flow] = { ...(previous?.[flow] as Data), ...(now[flow] as Data) };
    return merged;
}

/** A flow's devices, as Discord lists them, and the one it uses. */
function devicesOf(settings: Data | null, flow: DeviceFlow) {
    const part = (settings?.[flow] ?? {}) as Data;
    const list = (Array.isArray(part.available_devices) ? part.available_devices : [])
        .map((device) => ({ id: textOf((device as Data).id), name: textOf((device as Data).name) }))
        .filter((device) => device.id);
    return { list, id: textOf(part.device_id) };
}

/**
 * StreamKit's server, through Electron's network (Node's own is reset by
 * Discord on this PC). A code is good once: only the network is tried again.
 */
async function streamkitToken(code: string): Promise<string> {
    let data: Data | null = null;
    let last: unknown = null;
    for (let attempt = 1; attempt <= 3 && !data; attempt++) {
        try {
            const reply = await net.fetch(TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            });
            data = (await reply.json()) as Data;
        } catch (error) {
            last = error;
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
    }
    if (!data) throw last instanceof Error ? last : new Error("StreamKit could not be reached.");
    // A bad code is answered with {}: only a token is a yes.
    if (typeof data.access_token !== "string" || !data.access_token)
        throw new Error("Discord gave no permission.");
    return data.access_token;
}

async function fetchImage(url: string): Promise<string | null> {
    try {
        const reply = await net.fetch(url);
        if (!reply.ok) return null;
        const type = reply.headers.get("content-type") ?? "image/png";
        return `data:${type};base64,${Buffer.from(await reply.arrayBuffer()).toString("base64")}`;
    } catch {
        return null;
    }
}

export class DiscordService implements IntegrationService {
    readonly id = "discord";
    private token = "";
    /** What the token lets Decky do, as Discord said on connecting. */
    private scopes = new Set<string>();
    private health: IntegrationHealth = "closed";
    private account = "";
    private link: DiscordLink | null = null;
    private opening: Promise<void> | null = null;
    /** Discord's voice settings, as it last said them. */
    private settings: Data | null = null;
    private capture = { camera: false, screen: false };
    private capturing = false;
    /** The voice channel you are in. */
    private current: string | null = null;
    /** The channel whose speaking Discord tells, and who speaks there now. */
    private speakingIn: string | null = null;
    private readonly speaking = new Set<string>();
    /** The channels keys show: their name and who is in them. */
    private readonly channels = new Map<string, { name: string; members: Member[] }>();
    private readonly subscribed = new Set<string>();
    private readonly avatars = new Map<string, string | null>();
    private inbox: Inbox = { unread: 0 };
    private saving: Promise<void> = Promise.resolve();
    /** The devices last written to discord.log. */
    private devicesSaid = "";
    private keys: DiscordKey[] = [];
    private controls = new Set<string>();
    private needed = false;
    private stopped = false;
    private retry: ReturnType<typeof setTimeout> | null = null;
    private captureTimer: ReturnType<typeof setInterval> | null = null;
    private channelsTimer: ReturnType<typeof setInterval> | null = null;
    private reread: ReturnType<typeof setTimeout> | null = null;
    private readonly connectTo: (clientId: string) => Promise<DiscordLink>;
    private readonly exchange: (code: string) => Promise<string>;
    private readonly image: (url: string) => Promise<string | null>;
    private readonly focus: () => void;
    private readonly visit: (url: string) => Promise<void>;

    constructor(private readonly parts: DiscordParts) {
        this.connectTo = parts.connect ?? ((id) => DiscordIpc.connect(id));
        this.exchange = parts.exchange ?? streamkitToken;
        this.image = parts.image ?? fetchImage;
        // Started again, a running Discord comes up as it was; a discord:// link would go to Home.
        this.focus = parts.focus ?? (() => void parts.finder.launch().catch(() => {}));
        this.visit = parts.visit ?? ((url) => shell.openExternal(url));
    }

    /**
     * The settings of the profile now in use: its own permission and its own
     * notifications, read in place of the last profile's.
     */
    async usePath(path: string): Promise<void> {
        this.parts.settingsPath = path;
        this.inbox = { unread: 0 };
        this.token = "";
        await this.load();
    }

    async load(): Promise<void> {
        try {
            const saved = JSON.parse(await readFile(this.parts.settingsPath, "utf8")) as Data;
            this.inbox = inboxOf(saved.inbox);
            if (typeof saved.token === "string" && saved.token)
                this.token = safeStorage.decryptString(Buffer.from(saved.token, "base64"));
        } catch {
            // No permission kept yet.
        }
    }

    /** Follow the profile: a link to Discord while any key uses it, none without. */
    sync(config: DeckConfig): void {
        const controls = new Set<string>();
        const keys: DiscordKey[] = [];
        for (const page of config.pages)
            for (const [cell, key] of Object.entries(page.keys)) {
                const action = key.action;
                if (action.kind === "app" && action.app === "discord") controls.add(action.control);
                if (
                    action.kind === "widget" &&
                    isDiscordWidget(action.widget) &&
                    isWidgetKey(page, Number(cell))
                )
                    keys.push({
                        address: keyAddress(page.id, Number(cell)),
                        widget: action.widget,
                    });
            }
        this.controls = controls;
        this.keys = keys;
        this.needed = controls.size > 0 || keys.length > 0;
        this.watchCapture(controls.has("camera") || controls.has("share"));
        if (!this.needed) {
            this.disconnect();
            this.parts.onControls();
            return;
        }
        this.publish();
        if (this.link) {
            void this.listenTo(this.current);
            void this.readChannels();
        } else void this.connect();
        this.parts.onControls();
    }

    status(): IntegrationStatus {
        return {
            id: this.id,
            health: this.health,
            version: this.health === "ready" ? this.account : "",
            values: {},
            saved: {},
        };
    }

    /** Try Discord now, as its card asks: with no key using it, the link closes again after. */
    async check(): Promise<IntegrationStatus> {
        await this.connect(true);
        return this.status();
    }

    save(): Promise<IntegrationStatus> {
        return Promise.reject(new Error("Discord has no settings: Authorize instead."));
    }

    /** Ask Discord's permission: its Authorize, clicked, gives a token Decky keeps. */
    async authorize(): Promise<Reply> {
        let link: DiscordLink;
        try {
            link = await this.connectTo(STREAMKIT_ID);
        } catch {
            await this.unreachable();
            this.publish();
            return { ok: false, message: discordIntegration.says[this.health]("") };
        }
        try {
            const answer = (await link.request(
                "AUTHORIZE",
                { client_id: STREAMKIT_ID, scopes: SCOPES },
                undefined,
                AUTHORIZE_MS,
            )) as Data | undefined;
            const code = textOf(answer?.code);
            if (!code) throw new Error("Discord gave no permission.");
            this.token = await this.exchange(code);
            await this.keep();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                message: /denied|cancel/i.test(message)
                    ? "Discord's Authorize wasn't clicked."
                    : `Discord gave no permission: ${message}`,
            };
        } finally {
            link.close();
        }
        // Start over, with the new token.
        this.drop();
        await this.connect(true);
        return {
            ok: this.health === "ready",
            message: discordIntegration.says[this.health](this.account),
        };
    }

    /** Start Discord, unless it runs, and try it until it answers, for up to START_WAIT_MS. */
    async open(): Promise<Reply> {
        const { finder } = this.parts;
        if (!(await finder.running()) && !(await finder.launch()))
            return { ok: false, message: "Decky found no Discord to start." };
        const until = Date.now() + START_WAIT_MS;
        for (;;) {
            await this.connect(true);
            if (this.health !== "closed" && this.health !== "missing") break;
            if (this.stopped || Date.now() >= until) break;
            await new Promise((resolve) => setTimeout(resolve, START_LOOK_MS));
        }
        return { ok: true, message: discordIntegration.says[this.health](this.account) };
    }

    /**
     * A control's state, for toggle keys that follow it; null while Discord has
     * not said - and while it is out of reach, when its keys look disabled and
     * show OFF (the window draws only their OFF pictures so).
     */
    controlState(control: string): boolean | null {
        if (this.health !== "ready") return null;
        return this.CONTROLS[control]?.state() ?? null;
    }

    /** A key with a control pressed: Discord is asked to switch it. */
    async press(control: string): Promise<Reply> {
        const handler = this.CONTROLS[control];
        if (!handler) return { ok: false, message: "Discord has no such control." };
        const link = this.ready();
        if (!link) return { ok: false, message: this.unready() };
        try {
            await handler.press(link);
            return { ok: true, message: `${discordIntegration.controls![control]!.label}: done.` };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * A tap on a voice channel's key: join it, or leave it while you are in it.
     * Answers at once; `failed` hears if Discord then refuses.
     */
    joinOrLeave(channel: string, failed: (error: unknown) => void): string {
        if (!channel) return "Pick the voice channel in the key's settings first.";
        const link = this.ready();
        if (!link) return this.unready();
        const leaving = this.current === channel;
        link.request(
            "SELECT_VOICE_CHANNEL",
            leaving ? { channel_id: null } : { channel_id: channel, force: true },
            undefined,
            MOVE_MS,
        ).catch(failed);
        return leaving ? "Leaving the voice channel." : "Joining the voice channel.";
    }

    /** A tap on the call's key: you leave the call you are in. */
    leave(failed: (error: unknown) => void): string {
        const link = this.ready();
        if (!link) return this.unready();
        if (!this.current) return "You aren't in a call.";
        link.request("SELECT_VOICE_CHANNEL", { channel_id: null }, undefined, MOVE_MS).catch(
            failed,
        );
        return "Leaving the call.";
    }

    /** A tap on a device switcher: Discord moves to its next microphone, or output. */
    nextDevice(flow: DeviceFlow, failed: (error: unknown) => void): string {
        const link = this.ready();
        if (!link) return this.unready();
        const { list, id } = devicesOf(this.settings, flow);
        if (!listed(list) || list.length < 2) return `Discord has no other ${DEVICE_WORDS[flow]}.`;
        const next = nextChoice(list, id)!;
        this.setVoice(link, { [flow]: { device_id: next.id } }).catch(failed);
        return `Discord's ${DEVICE_WORDS[flow]}: ${next.name}.`;
    }

    /**
     * A tap on the notifications key: the last one's conversation opens in
     * Discord, and the count starts again. With none, Discord comes up.
     */
    openInbox(failed: (error: unknown) => void): string {
        const { channel } = this.inbox;
        this.inbox = { unread: 0 };
        this.publish();
        void this.keep();
        if (!channel) {
            this.focus();
            return "Opening Discord.";
        }
        void this.conversation(channel)
            .then((url) => this.visit(url))
            .catch(failed);
        return "Opening the conversation in Discord.";
    }

    /** What the window asks of Discord by name: the voice channel you are in, for a key's settings. */
    async call(name: string): Promise<unknown> {
        const asked = this.CALLS[name];
        if (!asked) throw new Error("Discord has no such thing to ask.");
        if (!this.link) await this.connect(true);
        const link = this.link;
        if (this.health !== "ready" || !link)
            throw new Error(discordIntegration.says[this.health](""));
        try {
            return await asked(link);
        } finally {
            if (!this.needed) this.drop();
        }
    }

    stop(): void {
        this.stopped = true;
        this.disconnect();
    }

    /** Each control: its state as Discord (or Windows) says, and switching it. */
    private readonly CONTROLS: Record<
        string,
        { state: () => boolean | null; press: (link: DiscordLink) => Promise<unknown> }
    > = {
        ...Object.fromEntries(
            Object.entries(SWITCHES).map(([control, { field, also }]) => {
                const state = (): boolean | null =>
                    this.settings
                        ? this.settings[field] === true ||
                          (also !== undefined && this.settings[also] === true)
                        : null;
                // Off when it shows on, on when it shows off.
                const press = (link: DiscordLink) =>
                    this.setVoice(link, { [field]: state() !== true });
                return [control, { state, press }];
            }),
        ),
        camera: {
            state: () => this.capture.camera,
            press: async (link) => {
                await link.request("TOGGLE_VIDEO");
                this.readCaptureSoon();
            },
        },
        // Starting, Discord opens its picker for what to share: brought up to be seen.
        share: {
            state: () => this.capture.screen,
            press: async (link) => {
                const starting = !this.capture.screen;
                await link.request("TOGGLE_SCREENSHARE");
                if (starting) this.focus();
                this.readCaptureSoon();
            },
        },
        leave: {
            state: () => (this.health === "ready" ? this.current !== null : null),
            press: async (link) => {
                if (!this.current) throw new Error("You aren't in a call.");
                await link.request(
                    "SELECT_VOICE_CHANNEL",
                    { channel_id: null },
                    undefined,
                    MOVE_MS,
                );
            },
        },
    };

    /** What the window can ask of Discord (call). */
    private readonly CALLS: Record<string, (link: DiscordLink) => Promise<unknown>> = {
        currentChannel: async (link) => {
            const channel = (await link.request("GET_SELECTED_VOICE_CHANNEL")) as Data | null;
            const id = textOf(channel?.id);
            return id ? { id, name: textOf(channel?.name) } : null;
        },
    };

    /** What each event Decky subscribes to changes. */
    private readonly EVENTS: Record<string, (data: Data) => void> = {
        VOICE_SETTINGS_UPDATE: (data) => {
            this.settings = mergeSettings(this.settings, data);
            this.sayDevices();
            this.parts.onControls();
            this.publish();
        },
        VOICE_CHANNEL_SELECT: (data) => {
            this.current = textOf(data.channel_id) || null;
            this.speaking.clear();
            this.parts.onControls();
            this.publish();
            void this.listenTo(this.current);
            this.rereadSoon();
        },
        SPEAKING_START: (data) => this.speaks(textOf(data.user_id), true),
        SPEAKING_STOP: (data) => this.speaks(textOf(data.user_id), false),
        NOTIFICATION_CREATE: (data) => {
            const author = ((data.message as Data | undefined)?.author ?? {}) as Data;
            const url = textOf(data.icon_url) || (textOf(author.id) ? avatarUrl(author) : "");
            const channel = textOf(data.channel_id);
            this.inbox = {
                unread: this.inbox.unread + 1,
                from: { name: nameOf(author) || textOf(data.title), url },
                ...(channel ? { channel } : {}),
            };
            this.publish();
            void this.keep();
            void this.fetchAvatars();
        },
        ...Object.fromEntries(VOICE_STATE_EVENTS.map((event) => [event, () => this.rereadSoon()])),
    };

    /** What each Discord key shows, from what Discord says now. */
    private readonly STATES: {
        [T in DiscordWidget["type"]]: (widget: Extract<DiscordWidget, { type: T }>) => WidgetState;
    } = {
        "discord-channel": (widget) => ({ voice: this.voiceIn(widget.channel, widget.name ?? "") }),
        "discord-call": () => ({ voice: this.voiceIn(this.current ?? "", "") }),
        "discord-input": () => ({ choice: this.device("input") }),
        "discord-output": () => ({ choice: this.device("output") }),
        "discord-notifications": () => ({ inbox: this.inboxShown() }),
    };

    /** A voice channel as a key shows it: who is in it, with avatars once fetched, and who speaks. */
    private voiceIn(channel: string, name: string): VoiceChannel {
        const ready = this.health === "ready" && channel !== "";
        const known = this.channels.get(channel);
        const joined = ready && this.current === channel;
        const members: VoiceMember[] = ready
            ? (known?.members ?? []).map(({ id, name: who, url }) => {
                  const avatar = this.avatars.get(url);
                  return {
                      id,
                      name: who,
                      ...(avatar ? { avatar } : {}),
                      ...(joined && this.speaking.has(id) ? { speaking: true } : {}),
                  };
              })
            : [];
        return { health: this.health, name: known?.name || name, members, joined };
    }

    /**
     * The device a switcher shows. Just started, Discord says its settings
     * before its media engine has listed the devices - its list holds only a
     * stand-in then ("No Input Devices") - and again once it has: until then
     * the key stays out of reach, so it changes once, straight to the device.
     */
    private device(flow: DeviceFlow): Choice {
        const { list, id } = devicesOf(this.settings, flow);
        return choiceOf(list, id, this.health === "ready" && listed(list));
    }

    /** A line in discord.log. */
    private say(line: string): void {
        this.parts.log?.(line);
    }

    /** Discord's devices in discord.log, when they changed: how many, and the one in use. */
    private sayDevices(): void {
        const line = FLOWS.map((flow) => {
            const { list, id } = devicesOf(this.settings, flow);
            const using = list.find((device) => device.id === id)?.name ?? "none";
            return `${flow} ${list.length} (using "${using}")`;
        }).join(", ");
        if (line === this.devicesSaid) return;
        this.devicesSaid = line;
        this.say(`devices: ${line}`);
    }

    /** The notifications; a permission given before they were asked for is as none. */
    private inboxShown(): DiscordInbox {
        const health =
            this.health === "ready" && !this.scopes.has(NOTIFICATIONS) ? "denied" : this.health;
        const { unread, from } = this.inbox;
        if (!from) return { health, unread };
        const avatar = this.avatars.get(from.url);
        return { health, unread, from: avatar ? { name: from.name, avatar } : { name: from.name } };
    }

    /** Someone in your call started or stopped speaking. */
    private speaks(user: string, speaking: boolean): void {
        if (!user || this.speaking.has(user) === speaking) return;
        if (speaking) this.speaking.add(user);
        else this.speaking.delete(user);
        this.publish();
    }

    /** Who speaks, followed in `channel` - the call you are in, while a voice key shows one. */
    private async listenTo(channel: string | null): Promise<void> {
        const link = this.link;
        if (!link) return;
        const wanted = this.keys.some(({ widget }) => VOICE_TYPES.has(widget.type))
            ? channel
            : null;
        const was = this.speakingIn;
        if (wanted === was) return;
        this.speakingIn = wanted;
        for (const event of SPEAKING_EVENTS) {
            if (was) await link.request("UNSUBSCRIBE", { channel_id: was }, event).catch(() => {});
            if (wanted)
                await link.request("SUBSCRIBE", { channel_id: wanted }, event).catch(() => {});
        }
    }

    /** A voice setting changed from a key: shown at once; Discord's own word follows. */
    private async setVoice(link: DiscordLink, change: Data): Promise<void> {
        this.settings = mergeSettings(this.settings, change);
        this.parts.onControls();
        this.publish();
        await link.request("SET_VOICE_SETTINGS", change);
    }

    /** The link, while Discord is ready; else null, and Discord tried again. */
    private ready(): DiscordLink | null {
        if (this.health === "ready" && this.link) return this.link;
        void this.connect();
        return null;
    }

    /** Why a key cannot use Discord this moment (ready() said so). */
    private unready(): string {
        return this.health === "ready"
            ? "Decky is still reaching Discord: try again in a moment."
            : discordIntegration.says[this.health]("");
    }

    /** Where a channel is in Discord: in its server, or among your direct messages. */
    private async conversation(channel: string): Promise<string> {
        let guild = "";
        try {
            const found = (await this.link?.request("GET_CHANNEL", { channel_id: channel })) as
                Data | undefined;
            guild = textOf(found?.guild_id);
        } catch {
            // A direct message's channel may not be Decky's to read: among your direct messages.
        }
        return `discord://-/channels/${guild || "@me"}/${channel}`;
    }

    /** Open a link, unless one is open or opening; `once` closes it again with no key using Discord. */
    private connect(once = false): Promise<void> {
        if (this.stopped || this.link) return Promise.resolve();
        this.opening ??= this.reach(once).finally(() => (this.opening = null));
        return this.opening;
    }

    private async reach(once: boolean): Promise<void> {
        this.clearRetry();
        if (!this.token) {
            this.health = "off";
            return this.publish();
        }
        let link: DiscordLink;
        try {
            link = await this.connectTo(STREAMKIT_ID);
        } catch {
            await this.unreachable();
            return this.publish();
        }
        try {
            const auth = (await link.request("AUTHENTICATE", { access_token: this.token })) as
                Data | undefined;
            this.account = nameOf(auth?.user);
            this.scopes = new Set(Array.isArray(auth?.scopes) ? auth.scopes.map(String) : []);
        } catch (error) {
            link.close();
            // Discord went, or did not answer: tried again later, the token kept.
            if (/did not answer|is gone|closed the pipe/i.test(String(error))) {
                await this.unreachable();
                return this.publish();
            }
            // Refused, or run out: permission is asked for again.
            this.say("permission refused: Authorize again");
            this.health = "denied";
            this.token = "";
            await this.keep().catch(() => {});
            return this.publish();
        }
        this.link = link;
        this.health = "ready";
        const linkedAt = Date.now();
        this.say("linked");
        link.onEvent = (event, data) => this.EVENTS[event]?.(data);
        link.onClose = () => {
            this.say(`link closed after ${((Date.now() - linkedAt) / 1000).toFixed(1)} s`);
            this.forget();
            void this.unreachable().then(() => {
                this.publish();
                this.parts.onControls();
            });
        };
        try {
            this.settings = mergeSettings(null, await link.request("GET_VOICE_SETTINGS"));
            this.sayDevices();
            for (const event of ["VOICE_SETTINGS_UPDATE", "VOICE_CHANNEL_SELECT"])
                await link.request("SUBSCRIBE", {}, event);
            if (this.scopes.has(NOTIFICATIONS))
                await link.request("SUBSCRIBE", {}, "NOTIFICATION_CREATE").catch(() => {});
            const selected = (await link.request("GET_SELECTED_VOICE_CHANNEL")) as Data | null;
            this.current = textOf(selected?.id) || null;
        } catch {
            // The link's end says why.
        }
        if (once && !this.needed) {
            this.drop();
            return this.publish();
        }
        await this.readChannels();
        void this.listenTo(this.current);
        this.channelsTimer ??= setInterval(() => void this.readChannels(), CHANNELS_MS);
        this.parts.onControls();
    }

    /** Why there is no link, from what the finder says; try again later. */
    private async unreachable(): Promise<void> {
        const was = this.health;
        if (!this.token) this.health = "off";
        else this.health = (await this.parts.finder.installed()) ? "closed" : "missing";
        if (this.health !== was) this.say(`Discord ${this.health}`);
        const wait = RETRY_MS[this.health as Exclude<IntegrationHealth, "ready">];
        this.clearRetry();
        if (wait !== null && this.needed && !this.stopped)
            this.retry = setTimeout(() => void this.connect(), wait);
    }

    /** The channels keys show: each voice channel key's, and the call's while a key shows it. */
    private channelsShown(): Set<string> {
        const shown = new Set<string>();
        for (const { widget } of this.keys) {
            if (widget.type === "discord-channel" && widget.channel) shown.add(widget.channel);
            if (widget.type === "discord-call" && this.current) shown.add(this.current);
        }
        return shown;
    }

    /** Who is in each channel a key shows, as Discord says; those no key shows are let go. */
    private async readChannels(): Promise<void> {
        const link = this.link;
        if (!link || this.health !== "ready") return;
        const wanted = this.channelsShown();
        for (const id of [...this.channels.keys()]) if (!wanted.has(id)) this.channels.delete(id);
        for (const id of wanted) {
            try {
                const channel = (await link.request("GET_CHANNEL", { channel_id: id })) as Data;
                const states = Array.isArray(channel?.voice_states) ? channel.voice_states : [];
                this.channels.set(id, {
                    name: textOf(channel?.name),
                    members: states.map(memberOf).filter((m): m is Member => m !== null),
                });
                if (!this.subscribed.has(id)) {
                    this.subscribed.add(id);
                    for (const event of VOICE_STATE_EVENTS)
                        await link.request("SUBSCRIBE", { channel_id: id }, event).catch(() => {});
                }
            } catch {
                // Gone, or not visible to you: shown empty.
                this.channels.set(id, { name: "", members: [] });
            }
        }
        this.publish();
        void this.fetchAvatars();
    }

    /**
     * Avatars keys show and not fetched yet, each once; the keys are drawn
     * again as they come. Those no key shows any more are let go.
     */
    private async fetchAvatars(): Promise<void> {
        const urls = new Set(
            [...this.channels.values()].flatMap((channel) => channel.members.map((m) => m.url)),
        );
        if (this.inbox.from?.url) urls.add(this.inbox.from.url);
        for (const url of [...this.avatars.keys()]) if (!urls.has(url)) this.avatars.delete(url);
        let fetched = false;
        for (const url of urls) {
            if (this.avatars.has(url)) continue;
            this.avatars.set(url, null);
            const image = await this.image(url);
            if (!image || !this.avatars.has(url)) continue;
            this.avatars.set(url, image);
            fetched = true;
        }
        if (fetched) this.publish();
    }

    /** Voice state events come in bursts: the channels are read again once they settle. */
    private rereadSoon(): void {
        if (this.reread) clearTimeout(this.reread);
        this.reread = setTimeout(() => {
            this.reread = null;
            void this.readChannels();
        }, 300);
    }

    /** Every Discord key's state, as Discord stands now. */
    private publish(): void {
        for (const { address, widget } of this.keys) {
            const next = (this.STATES[widget.type] as (widget: DiscordWidget) => WidgetState)(
                widget,
            );
            if (JSON.stringify(this.parts.store.get(address)) !== JSON.stringify(next))
                this.parts.store.set(address, next, false);
        }
        this.parts.onStatus(this.status());
    }

    /** Camera and screen share, from Windows, while a key has either. */
    private watchCapture(on: boolean): void {
        if (on === (this.captureTimer !== null)) return;
        this.parts.host.hold("discord", on);
        if (!on) {
            clearInterval(this.captureTimer!);
            this.captureTimer = null;
            this.capture = { camera: false, screen: false };
            return;
        }
        this.captureTimer = setInterval(() => void this.readCapture(), CAPTURE_MS);
        void this.readCapture();
    }

    private async readCapture(): Promise<void> {
        if (this.capturing) return;
        this.capturing = true;
        try {
            const read = await this.parts.host.request<{ camera?: boolean; screen?: boolean }>(
                "capture",
            );
            const next = { camera: read.camera === true, screen: read.screen === true };
            if (next.camera !== this.capture.camera || next.screen !== this.capture.screen) {
                this.capture = next;
                this.parts.onControls();
            }
        } catch {
            // Read again next time.
        } finally {
            this.capturing = false;
        }
    }

    /** A camera or share just switched: Windows is asked again shortly, not in a second. */
    private readCaptureSoon(): void {
        for (const wait of [400, 1200]) setTimeout(() => void this.readCapture(), wait);
    }

    private disconnect(): void {
        this.clearRetry();
        this.watchCapture(false);
        this.drop();
        this.channels.clear();
    }

    /** What only a link knew: gone with it. */
    private forget(): void {
        this.link = null;
        this.settings = null;
        this.devicesSaid = "";
        this.current = null;
        this.speakingIn = null;
        this.speaking.clear();
        this.subscribed.clear();
        this.stopChannels();
    }

    /** Close the link without it counting as lost; what it said goes with it. */
    private drop(): void {
        const link = this.link;
        this.forget();
        if (!link) return;
        link.onClose = null;
        link.onEvent = null;
        link.close();
    }

    private stopChannels(): void {
        if (this.channelsTimer) clearInterval(this.channelsTimer);
        this.channelsTimer = null;
        if (this.reread) clearTimeout(this.reread);
        this.reread = null;
    }

    private clearRetry(): void {
        if (this.retry) clearTimeout(this.retry);
        this.retry = null;
    }

    /**
     * What is kept for the next start: the token, encrypted (none kept when
     * Windows cannot encrypt it), and the notifications counted. One write at
     * a time, the newest last.
     */
    private keep(): Promise<void> {
        this.saving = this.saving.catch(() => {}).then(() => this.write());
        return this.saving;
    }

    private async write(): Promise<void> {
        const sealed =
            this.token && safeStorage.isEncryptionAvailable()
                ? safeStorage.encryptString(this.token).toString("base64")
                : "";
        const path = this.parts.settingsPath;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
            `${path}.tmp`,
            JSON.stringify({ token: sealed, inbox: this.inbox }),
            "utf8",
        );
        await rename(`${path}.tmp`, path);
    }
}
