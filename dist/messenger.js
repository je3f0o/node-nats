"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Messenger = exports.jsonEncoder = void 0;
/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : messenger.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-09-04
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
const node_fs_1 = require("node:fs");
const transport_node_1 = require("@nats-io/transport-node");
const nats_core_1 = require("@nats-io/nats-core");
const jsonEncoder = () => ({
    encode: (msg) => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
    decode: (input) => JSON.parse(Buffer.from(input).toString()),
});
exports.jsonEncoder = jsonEncoder;
// A service must outlive its bus. NATS restarts, the network blinks, and
// neither may end the process:
//
//  maxReconnectAttempts  the library gives up after 10 tries (~20s) and
//                        CLOSES the connection. The process then stays up
//                        holding a dead client, subscribed to nothing and
//                        answering no request — the worst possible shape of
//                        failure, because nothing looks wrong. -1 keeps it
//                        trying for as long as the service runs.
//  waitOnFirstConnect    a service that BOOTS while NATS is down otherwise
//                        gets a rejected promise and exits.
//  pingInterval          a peer that vanished without a FIN (a killed
//  maxPingOut            container, a dropped route) is otherwise noticed
//                        only after the 2-minute default ping. Three 20s
//                        pings find it in about a minute, and the reconnect
//                        starts there instead.
//
//  ignoreAuthErrorAbort  ⛔ MEASURED, and it decides the shape of everything
//                        else. A server that cannot reach its authoriser
//                        answers `Authorization Violation` — the SAME error as
//                        a wrong password, with nothing to tell them apart.
//                        Clients abort reconnecting after two identical auth
//                        errors, so an app that restarts while the authoriser
//                        is down dies and stays dead. With this, it waits and
//                        connects itself when the authoriser returns (18s in
//                        the test).
//
// The behaviour it replaces — a wrong password failing fast — was only worth
// having because the alternative was an invisible hang. So the retry is made
// LOUD instead: see waiting() below. A wrong password is now a line every ten
// seconds rather than an exit, which is the better of the two failures.
const DEFAULTS = {
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2_000,
    waitOnFirstConnect: true,
    ignoreAuthErrorAbort: true,
    pingInterval: 20_000,
    maxPingOut: 3,
};
// Nothing reports on a connection that has not been made yet: `nc.status()`
// exists only once there IS an nc, so an app stuck on its very first connect
// is silent — measured, `events: (nothing)`. This is the only thing standing
// between "waiting for NATS" and "hung for no visible reason".
const waiting = (tag, url) => {
    const started = Date.now();
    const timer = setInterval(() => {
        const secs = Math.round((Date.now() - started) / 1000);
        console.warn(`${tag} still connecting to NATS at '${url}' — ${secs}s`);
    }, 10_000);
    timer.unref?.();
    return () => clearInterval(timer);
};
const bytesOf = (value) => typeof value === "string" ? new TextEncoder().encode(value) : value;
const authOf = (config) => {
    const { user, pass, nkey, creds, token, credsFile } = config;
    if (config.authenticator)
        return config.authenticator;
    if (credsFile)
        return (0, nats_core_1.credsAuthenticator)((0, node_fs_1.readFileSync)(credsFile));
    if (creds)
        return (0, nats_core_1.credsAuthenticator)(bytesOf(creds));
    if (nkey)
        return (0, nats_core_1.nkeyAuthenticator)(bytesOf(nkey));
    if (token)
        return (0, nats_core_1.tokenAuthenticator)(token);
    if (user)
        return (0, nats_core_1.usernamePasswordAuthenticator)(user, pass);
    return undefined;
};
// `nats://user:pass@host:4222`. nats-core does NOT read credentials out of
// the url — it only ever looks at the options — so this does it here, and
// authenticating a deployed service becomes one changed NATS_URL rather than
// two new environment variables in every project that has one.
//
// The stripped url is what gets logged, so a password never reaches a log.
const fromUrl = (url) => {
    try {
        const parsed = new URL(url);
        if (!parsed.username)
            return { url };
        return {
            url: `${parsed.protocol}//${parsed.host}`,
            user: decodeURIComponent(parsed.username),
            pass: decodeURIComponent(parsed.password),
        };
    }
    catch {
        return { url }; // not a url this can parse — hand it over untouched
    }
};
class Messenger {
    _nc;
    _name;
    _closing = false;
    _onStatus;
    // Reaching for the connection before connect() used to hand back undefined
    // and fail somewhere further in, on a line that had nothing to do with it.
    get nc() {
        if (!this._nc)
            throw new Error("NATS is not connected — call connect()");
        return this._nc;
    }
    get name() { return this._name; }
    get connected() { return !!this._nc && !this._nc.isClosed(); }
    async connect(config) {
        const from = fromUrl(config?.url ?? "nats://localhost:4222");
        const auth = authOf({
            ...config,
            user: config?.user ?? from.user,
            pass: config?.pass ?? from.pass,
        });
        this._name = config?.name;
        this._closing = false;
        this._onStatus = config?.onStatus;
        const stop = waiting(`[${config?.name ?? "Unnamed"}]`, from.url);
        try {
            this._nc = await (0, transport_node_1.connect)({
                ...DEFAULTS,
                servers: from.url,
                tls: config?.tls,
                name: config?.name,
                authenticator: auth,
                inboxPrefix: config?.inboxPrefix,
                ...config?.options,
            });
        }
        finally {
            stop();
        }
        console.log(`[${this.name ?? "Unnamed"}] Connected to NATS to '${from.url}'`);
        this.watch();
    }
    /** Stop listening and let in-flight work finish. Safe before connect(). */
    async close() {
        this._closing = true;
        if (this._nc && !this._nc.isClosed())
            await this._nc.close();
    }
    // The connection narrates its own life. Left unread, a service that lost
    // the bus for ten minutes and came back says nothing at all — and a
    // service that lost it FOR GOOD says nothing either, which is the case
    // worth shouting about.
    watch() {
        const nc = this._nc;
        const tag = `[${this.name ?? "Unnamed"}]`;
        void (async () => {
            for await (const status of nc.status()) {
                try {
                    this._onStatus?.(status);
                }
                catch { /* never our problem */ }
                switch (status.type) {
                    case "disconnect":
                        console.warn(`${tag} NATS disconnected from ${status.server}`);
                        break;
                    case "reconnecting":
                        console.warn(`${tag} NATS reconnecting…`);
                        break;
                    case "reconnect":
                        console.log(`${tag} NATS reconnected to ${status.server}`);
                        break;
                    case "staleConnection":
                        console.warn(`${tag} NATS connection went stale`);
                        break;
                    case "error":
                        console.error(`${tag} NATS server error:`, status.error.message);
                        break;
                    // A close is either a shutdown we asked for or the end of the
                    // service's reach — and the difference is the whole message.
                    case "close":
                        if (this._closing)
                            console.log(`${tag} NATS closed`);
                        else
                            console.error(`${tag} NATS connection CLOSED — no reconnect`);
                        break;
                }
            }
        })().catch(() => { });
        // Resolves with an error only when the connection died of one; either
        // way this is the end of the line, and it is not an event above.
        void nc.closed().then((err) => {
            if (err)
                console.error(`${tag} NATS closed:`, err.message);
        }).catch(() => { });
    }
    async request(endpoint) {
        const timeout = endpoint.timeout ?? 5000;
        const subject = `${endpoint.gateway}.${endpoint.api}`;
        const reqBytes = endpoint.req.encode(endpoint.payload).finish();
        const msg = await this.nc.request(subject, reqBytes, { timeout });
        return endpoint.res.decode(msg.data);
    }
    publish(subject, enc, payload) {
        const bytes = enc.encode(payload).finish();
        this.nc.publish(subject, bytes);
    }
    subscribe(subject, enc, handler, opts) {
        return this.nc.subscribe(subject, {
            queue: opts?.queue,
            callback: (err, msg) => {
                if (err)
                    return console.error(err);
                (async () => {
                    try {
                        await handler(enc.decode(msg.data), msg.subject);
                    }
                    catch (error) {
                        console.error("Error processing message", error);
                    }
                })();
            }
        });
    }
    serve(api, req, res, handler) {
        if (!this.name)
            throw new Error("serve() api requires gateway name");
        this.nc.subscribe(`${this.name}.${api}`, {
            callback: (err, msg) => {
                if (err)
                    return console.error(err);
                (async () => {
                    try {
                        const requestData = req.decode(msg.data);
                        const responseData = await handler(requestData);
                        const resBytes = res.encode(responseData).finish();
                        msg.respond(resBytes);
                    }
                    catch (error) {
                        console.error("Error processing reply", error);
                    }
                })();
            }
        });
    }
}
exports.Messenger = Messenger;
