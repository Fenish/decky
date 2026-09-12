/*---------------------------------------------------------------
 * OBS Studio for the widgets that show it. While any key shows an OBS
 * output, Decky keeps a link to OBS - trying again every few seconds while
 * OBS is closed - and puts what OBS says of each output into those keys'
 * widget state. Without a link, the keys say why: OBS not found, closed, its
 * WebSocket server off, or its password refused.
 *
 * A touch on a key arms a countdown of OBS_ARM_S seconds; another touch
 * meanwhile calls it off. When it runs out, OBS is asked to start the
 * output, or to stop it if it runs.
 *
 * OBS's card in the window can start OBS too (open), from where the finder
 * knows it is installed.
 *--------------------------------------------------------------*/

import type { Reply } from "../../../shared/api";
import { isWidgetKey, keyAddress } from "../../../shared/config";
import type { DeckConfig } from "../../../shared/config";
import type { IntegrationStatus } from "../../../shared/integrations/integration";
import type { PresenceFacts } from "../../../shared/presence";
import { obsIntegration } from "../../../shared/integrations/obs";
import type { WidgetState } from "../../../shared/widgets";
import { OBS_ARM_S, OBS_TYPES, obsRunTime } from "../../../shared/widgets/obs";
import type { ObsHealth, ObsOutput, ObsState, ObsType } from "../../../shared/widgets/obs";
import type { WidgetStore } from "../../widgets/widget-state";
import type { IntegrationService } from "../integration";
import {
    askedValues,
    loadIntegrationValues,
    saveIntegrationValues,
    shownValues,
} from "../settings-store";
import type { IntegrationValues } from "../settings-store";
import type { ObsFinder } from "./obs-finder";
import { ObsLink, ObsLinkError } from "./obs-link";
import type { ObsSocket } from "./obs-link";

/** OBS's own default: this PC, port 4455. */
const DEFAULT_ADDRESS = "localhost:4455";

/** A host and a port, as OBS's address is given. */
export function validObsAddress(value: string): boolean {
    const match = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(value);
    return match !== null && Number(match[2]) >= 1 && Number(match[2]) <= 65535;
}

type Data = Record<string, unknown>;
type Output = Omit<ObsState, "health">;

/**
 * When to try OBS again: soon while it may be starting, seldom while it is
 * not on the PC. A refused password waits for Settings to change it.
 */
const RETRY_MS: Record<Exclude<ObsHealth, "ready">, number | null> = {
    closed: 3000,
    off: 3000,
    missing: 15_000,
    denied: null,
};

/** How long OBS may take to start when Decky opens it, and how often it is tried meanwhile. */
const START_WAIT_MS = 30_000;
const START_LOOK_MS = 1500;

/** Each output as OBS names it: reading it, starting and stopping it, and the event that tells of it. */
const OUTPUTS: Record<
    ObsOutput,
    { status: string; start: string; stop: string; event: string; read: (data: Data) => Output }
> = {
    record: {
        status: "GetRecordStatus",
        start: "StartRecord",
        stop: "StopRecord",
        event: "RecordStateChanged",
        read: (data) => ({
            active: data.outputActive === true,
            paused: data.outputPaused === true,
            ms: Number(data.outputDuration) || 0,
        }),
    },
    stream: {
        status: "GetStreamStatus",
        start: "StartStream",
        stop: "StopStream",
        event: "StreamStateChanged",
        read: (data) => ({
            active: data.outputActive === true,
            reconnecting: data.outputReconnecting === true,
            ms: Number(data.outputDuration) || 0,
        }),
    },
};
const OUTPUT_NAMES = Object.keys(OUTPUTS) as ObsOutput[];

/**
 * What each state OBS reports an output in does to what its keys show, as
 * OBS's events tell of it - in order. The time is kept here from those, so
 * no status needs asking for: asked for meanwhile, OBS can answer out of
 * order (its requests run on a pool of threads), and a status from before a
 * stop would keep a key running. Starting and stopping change nothing yet.
 */
const STATES: Record<string, (output: Output, now: number) => Output> = {
    OBS_WEBSOCKET_OUTPUT_STARTED: (_output, now) => ({ active: true, ms: 0, at: now }),
    OBS_WEBSOCKET_OUTPUT_STOPPED: () => ({ active: false }),
    OBS_WEBSOCKET_OUTPUT_PAUSED: (output, now) => ({
        ...output,
        paused: true,
        ms: obsRunTime(output, now),
        at: now,
    }),
    OBS_WEBSOCKET_OUTPUT_RESUMED: (output, now) => ({ ...output, paused: false, at: now }),
    OBS_WEBSOCKET_OUTPUT_RECONNECTING: (output) => ({ ...output, reconnecting: true }),
    OBS_WEBSOCKET_OUTPUT_RECONNECTED: (output) => ({ ...output, reconnecting: false }),
};

export class ObsService implements IntegrationService {
    readonly id = "obs";
    private values: IntegrationValues = { address: "", password: "" };
    private keys: { address: string; output: ObsOutput }[] = [];
    private link: ObsLink | null = null;
    private opening: Promise<void> | null = null;
    private health: ObsHealth = "closed";
    private version = "";
    private readonly outputs: Record<ObsOutput, Output> = {
        record: { active: false },
        stream: { active: false },
    };
    private retry: ReturnType<typeof setTimeout> | null = null;
    private readonly countdowns = new Map<string, ReturnType<typeof setTimeout>>();
    private stopped = false;

    constructor(
        private readonly store: WidgetStore,
        private settingsPath: string,
        private readonly finder: ObsFinder,
        private readonly onStatus: (status: IntegrationStatus) => void,
        private readonly openSocket?: (url: string) => ObsSocket,
    ) {}

    /** The settings of the profile now in use, in place of the last one's. */
    async usePath(path: string): Promise<void> {
        this.settingsPath = path;
        await this.load();
    }

    async load(): Promise<void> {
        this.values = await loadIntegrationValues(this.settingsPath, obsIntegration);
    }

    /** Where OBS's WebSocket server is: as saved, else OBS's default. */
    private get address(): string {
        const saved = this.values.address ?? "";
        return validObsAddress(saved) ? saved : DEFAULT_ADDRESS;
    }

    /** Follow the profile: a link to OBS while any key shows an output, none without. */
    sync(config: DeckConfig): void {
        this.keys = config.pages.flatMap((page) =>
            Object.entries(page.keys).flatMap(([cell, key]) => {
                if (key.action.kind !== "widget" || !isWidgetKey(page, Number(cell))) return [];
                const { type } = key.action.widget;
                if (!Object.hasOwn(OBS_TYPES, type)) return [];
                const address = keyAddress(page.id, Number(cell));
                return [{ address, output: OBS_TYPES[type as ObsType] }];
            }),
        );
        if (!this.keys.length) return this.disconnect();
        this.publish();
        void this.connect();
    }

    status(): IntegrationStatus {
        const shown = shownValues(obsIntegration, { ...this.values, address: this.address });
        return {
            id: this.id,
            health: this.health,
            version: this.health === "ready" ? this.version : "",
            ...shown,
        };
    }

    /** Try OBS now, as Settings asks: with no key showing it, the link closes again after. */
    async check(): Promise<IntegrationStatus> {
        await this.connect(true);
        return this.status();
    }

    /** Where OBS is, and its password (left null, the saved one stays); then try it. */
    async save(asked: unknown): Promise<IntegrationStatus> {
        const values = askedValues(obsIntegration, this.values, asked);
        if (!values || !validObsAddress(values.address ?? ""))
            throw new Error("Give OBS's address as host:port, such as localhost:4455.");
        this.values = values;
        await saveIntegrationValues(this.settingsPath, obsIntegration, values);
        this.drop();
        return this.check();
    }

    /**
     * A touch on a key showing `output`: arm its countdown, or call it off.
     * Returns what happens; `failed` hears if OBS then refuses.
     */
    touch(address: string, output: ObsOutput, failed: (error: unknown) => void): string {
        const armed = this.countdowns.get(address);
        if (armed) {
            clearTimeout(armed);
            this.countdowns.delete(address);
            this.setArming(address, undefined);
            return "Called off.";
        }
        // OBS cannot be reached: try again, and say why, as Settings does.
        if (this.health !== "ready") {
            void this.connect();
            return obsIntegration.says[this.health]("");
        }
        const start = !this.outputs[output].active;
        this.setArming(address, { until: Date.now() + OBS_ARM_S * 1000, start });
        const timer = setTimeout(() => {
            this.countdowns.delete(address);
            this.setArming(address, undefined);
            // Started or stopped some other way meanwhile: nothing more to do.
            if (this.outputs[output].active === start) return;
            if (!this.link) return failed(new Error(obsIntegration.says.closed("")));
            this.link.request(start ? OUTPUTS[output].start : OUTPUTS[output].stop).catch(failed);
        }, OBS_ARM_S * 1000);
        this.countdowns.set(address, timer);
        return `${start ? "Starting" : "Stopping"} in ${OBS_ARM_S} seconds; touch again to call it off.`;
    }

    /**
     * OBS's outputs as they stand, for Decky's card on Discord: since when each
     * runs, or paused; null while it is off or OBS is out of reach.
     */
    presenceOutputs(): Pick<PresenceFacts, "record" | "stream"> {
        const now = Date.now();
        const running = (output: ObsOutput): Output | null =>
            this.health === "ready" && this.outputs[output].active ? this.outputs[output] : null;
        const record = running("record");
        const stream = running("stream");
        return {
            record: record
                ? record.paused
                    ? "paused"
                    : { since: now - obsRunTime(record, now) }
                : null,
            stream: stream ? { since: now - obsRunTime(stream, now) } : null,
        };
    }

    stop(): void {
        this.stopped = true;
        this.disconnect();
    }

    /**
     * Start OBS, unless it runs, then try it until it answers - it takes a few
     * seconds to start its WebSocket server - for up to START_WAIT_MS. Not ok
     * only with no OBS to start; how it stands after is its status.
     */
    async open(): Promise<Reply> {
        if (!(await this.finder.running()) && !(await this.finder.launch()))
            return {
                ok: false,
                message: "Decky found no OBS to start. Open it yourself, or install it again.",
            };
        const until = Date.now() + START_WAIT_MS;
        for (;;) {
            await this.connect(true);
            if (this.health === "ready" || this.health === "denied") break;
            if (this.stopped || Date.now() >= until) break;
            await new Promise((resolve) => setTimeout(resolve, START_LOOK_MS));
        }
        return { ok: true, message: obsIntegration.says[this.health](this.version) };
    }

    /** Open a link, unless one is open or opening; `once` closes it again with no key showing OBS. */
    private connect(once = false): Promise<void> {
        if (this.stopped) return Promise.resolve();
        if (this.link) return Promise.resolve();
        this.opening ??= this.reach(once).finally(() => (this.opening = null));
        return this.opening;
    }

    private async reach(once: boolean): Promise<void> {
        this.clearRetry();
        try {
            const link = await ObsLink.open(
                this.address,
                this.values.password ?? "",
                this.openSocket,
            );
            this.link = link;
            this.health = "ready";
            link.onEvent = (type, data) => {
                const output = OUTPUT_NAMES.find((name) => OUTPUTS[name].event === type);
                const state = STATES[String(data.outputState)];
                if (!output || !state) return;
                this.outputs[output] = state(this.outputs[output], Date.now());
                this.publish();
            };
            link.onEnd = (denied) => {
                this.link = null;
                if (!this.stopped) void this.unreachable(denied).then(() => this.publish());
            };
            this.version = String((await link.request("GetVersion")).obsVersion ?? "");
            await Promise.all(OUTPUT_NAMES.map((output) => this.read(output)));
            if ((once && !this.keys.length) || this.stopped) this.drop();
        } catch (error) {
            if (this.link) return;
            await this.unreachable(error instanceof ObsLinkError && error.reason === "denied");
        } finally {
            this.publish();
        }
    }

    /** Why there is no link: the password, or what the finder says of OBS. Try again later. */
    private async unreachable(denied: boolean): Promise<void> {
        this.health = denied
            ? "denied"
            : (await this.finder.running())
              ? "off"
              : (await this.finder.installed())
                ? "closed"
                : "missing";
        for (const output of OUTPUT_NAMES) this.outputs[output] = { active: false };
        const wait = RETRY_MS[this.health as Exclude<ObsHealth, "ready">];
        this.clearRetry();
        if (wait !== null && this.keys.length && !this.stopped)
            this.retry = setTimeout(() => void this.connect(), wait);
    }

    /** What OBS says of an output as the link opens; its events keep it after (STATES). */
    private async read(output: ObsOutput): Promise<void> {
        const link = this.link;
        if (!link) return;
        try {
            const data = await link.request(OUTPUTS[output].status);
            this.outputs[output] = { ...OUTPUTS[output].read(data), at: Date.now() };
        } catch {
            // The link's end says why.
        }
    }

    /** Every OBS key's state as OBS stands now, keeping a countdown armed on it. */
    private publish(): void {
        for (const { address, output } of this.keys) {
            const current = this.store.get(address);
            const obs: ObsState = {
                health: this.health,
                ...(this.health === "ready" ? this.outputs[output] : { active: false }),
            };
            const next: WidgetState = {
                ...(current?.arming ? { arming: current.arming } : {}),
                obs,
            };
            if (JSON.stringify(current) !== JSON.stringify(next))
                this.store.set(address, next, false);
        }
        this.onStatus(this.status());
    }

    private setArming(address: string, arming: WidgetState["arming"]): void {
        const { arming: _old, ...rest } = this.store.get(address) ?? {};
        this.store.set(address, arming ? { ...rest, arming } : rest, false);
    }

    private disconnect(): void {
        this.clearRetry();
        for (const [address, timer] of this.countdowns) {
            clearTimeout(timer);
            this.setArming(address, undefined);
        }
        this.countdowns.clear();
        this.drop();
    }

    /** Close the link without it counting as lost: nothing to find out, nothing to retry. */
    private drop(): void {
        const link = this.link;
        this.link = null;
        if (!link) return;
        link.onEnd = null;
        link.close();
    }

    private clearRetry(): void {
        if (this.retry) clearTimeout(this.retry);
        this.retry = null;
    }
}
