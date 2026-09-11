import { describe, expect, it } from "vitest";
import { ObsLink, ObsLinkError, obsAuthentication } from "../src/main/integrations/obs/obs-link";
import { FakeObs } from "./fake-obs";

describe("the link to OBS", () => {
    it("answers OBS's challenge as obs-websocket's documentation does", () => {
        // The worked example in obs-websocket 5's protocol documentation.
        expect(
            obsAuthentication(
                "supersecretpassword",
                "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
                "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=",
            ),
        ).toBe("1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=");
    });

    it("identifies, asking only for output events, and gets answers by request id", async () => {
        const obs = new FakeObs();
        const link = await ObsLink.open("localhost:4455", "", obs.open);
        const identify = obs.sent.find((m) => m.op === 1)!;
        expect(identify.d).toEqual({ rpcVersion: 1, eventSubscriptions: 64 });
        expect(await link.request("GetVersion")).toEqual({ obsVersion: "31.0.2" });
        obs.answers.StartRecord = () => new Error("Recording is already active.");
        await expect(link.request("StartRecord")).rejects.toThrow("Recording is already active.");
    });

    it("gives the password where OBS asks for one, and says so when OBS refuses it", async () => {
        const obs = new FakeObs();
        obs.password = "supersecretpassword";
        obs.expected = obsAuthentication(obs.password, obs.salt, obs.challenge);
        await expect(
            ObsLink.open("localhost:4455", obs.password, obs.open),
        ).resolves.toBeInstanceOf(ObsLink);
        const wrong = ObsLink.open("localhost:4455", "guess", obs.open);
        await expect(wrong).rejects.toMatchObject({ reason: "denied" });
        // None given where OBS wants one: refused before anything is sent.
        await expect(ObsLink.open("localhost:4455", "", obs.open)).rejects.toMatchObject({
            reason: "denied",
        });
    });

    it("says OBS did not answer when nothing is there", async () => {
        const obs = new FakeObs();
        obs.reachable = false;
        const error = await ObsLink.open("localhost:4455", "", obs.open).catch((e) => e);
        expect(error).toBeInstanceOf(ObsLinkError);
        expect(error.reason).toBe("unreachable");
    });

    it("passes events on, and says when OBS goes", async () => {
        const obs = new FakeObs();
        const link = await ObsLink.open("localhost:4455", "", obs.open);
        const events: string[] = [];
        let ended: boolean | null = null;
        link.onEvent = (type) => events.push(type);
        link.onEnd = (denied) => (ended = denied);
        obs.event("RecordStateChanged", { outputActive: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(events).toEqual(["RecordStateChanged"]);
        const pending = link.request("GetRecordStatus");
        obs.quit();
        await expect(pending).rejects.toThrow("OBS went away.");
        expect(ended).toBe(false);
    });
});
