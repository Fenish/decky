import { whole } from "./widget-kind";
import type { WidgetKind } from "./widget-kind";

/** How long a host takes to answer, asked every `interval` seconds. */
export type PingWidget = {
    type: "ping";
    host: string;
    interval: number;
};

// A host name or IPv4 address, or an IPv6 one. Never anything starting with a
// dash: the host is handed to ping.exe as an argument.
const HOST_NAME =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV6 = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;

export function validPingHost(host: string): boolean {
    return HOST_NAME.test(host) || IPV6.test(host);
}

export const pingKind: WidgetKind<PingWidget> = {
    type: "ping",
    label: "Ping",
    icon: "Activity",
    words: "latency internet server",
    defaults: () => ({ type: "ping", host: "google.com", interval: 5 }),
    valid: (w) => typeof w.host === "string" && validPingHost(w.host) && whole(w.interval, 5, 3600),
};
