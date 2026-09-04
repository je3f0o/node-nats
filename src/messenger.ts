/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : messenger.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-09-04
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {readFileSync} from "node:fs";
import {connect}      from "@nats-io/transport-node";
import {
  nkeyAuthenticator,
  tokenAuthenticator,
  credsAuthenticator,
  usernamePasswordAuthenticator,
} from "@nats-io/nats-core";
import type {
  Status,
  TlsOptions,
  Subscription,
  Authenticator,
  NatsConnection,
  ConnectionOptions,
} from "@nats-io/nats-core";

export interface Encoder<T> {
  encode(message: T)        : {finish(): Uint8Array};
  decode(input: Uint8Array) : T;
}

export const jsonEncoder = <T>(): Encoder<T> => ({
  encode: (msg)   => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
  decode: (input) => JSON.parse(Buffer.from(input).toString()),
});

export interface Endpoint<Req, Res> {
  gateway  : string;
  api      : string;
  req      : Encoder<Req>;
  res      : Encoder<Res>;
  timeout? : number;
  payload? : any;
}

export interface Config {
  tls?  : TlsOptions;
  url?  : string;
  name? : string;

  // ── Credentials ────────────────────────────────────────────────────────
  // Pick one. `authenticator` wins, then creds, nkey, token, user/pass.
  // Every field is optional and none was here before, so a caller that
  // passes none connects anonymously exactly as it always did — which is
  // what lets the server keep accepting today's clients while they are
  // rolled over one at a time.
  //
  // TLS is not authentication: `tls` proves the SERVER to this client, and
  // says nothing about who this client is. These fields are that half.
  user?          : string;
  pass?          : string;
  token?         : string;
  nkey?          : string;              // seed, "SU…"
  creds?         : string | Uint8Array; // a .creds file's CONTENTS
  credsFile?     : string;              // …or the path to read it from
  authenticator? : Authenticator;

  // ── Connection ─────────────────────────────────────────────────────────
  /** Inbox prefix for request(). A user whose subject permissions are
   *  narrowed still needs its replies to land somewhere it may subscribe;
   *  without this they arrive on `_INBOX.>` and are denied. */
  inboxPrefix? : string;
  /** Every connection event — disconnect, reconnect, server error, close.
   *  For a health endpoint or a metric; the events are logged regardless. */
  onStatus?    : (status: Status) => void;
  /** Merged last: the @nats-io options this interface does not name. */
  options?     : Partial<ConnectionOptions>;
}

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
const DEFAULTS: Partial<ConnectionOptions> = {
  reconnect            : true,
  maxReconnectAttempts : -1,
  reconnectTimeWait    : 2_000,
  waitOnFirstConnect   : true,
  ignoreAuthErrorAbort : true,
  pingInterval         : 20_000,
  maxPingOut           : 3,
};

// Nothing reports on a connection that has not been made yet: `nc.status()`
// exists only once there IS an nc, so an app stuck on its very first connect
// is silent — measured, `events: (nothing)`. This is the only thing standing
// between "waiting for NATS" and "hung for no visible reason".
const waiting = (tag: string, url: string) => {
  const started = Date.now();
  const timer   = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    console.warn(`${tag} still connecting to NATS at '${url}' — ${secs}s`);
  }, 10_000);
  timer.unref?.();
  return () => clearInterval(timer);
};

const bytesOf = (value: string | Uint8Array): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : value;

const authOf = (config: Config): Authenticator | undefined => {
  const {user, pass, nkey, creds, token, credsFile} = config;

  if (config.authenticator) return config.authenticator;
  if (credsFile) return credsAuthenticator(readFileSync(credsFile));
  if (creds)     return credsAuthenticator(bytesOf(creds));
  if (nkey)      return nkeyAuthenticator(bytesOf(nkey));
  if (token)     return tokenAuthenticator(token);
  if (user)      return usernamePasswordAuthenticator(user, pass);

  return undefined;
};

// `nats://user:pass@host:4222`. nats-core does NOT read credentials out of
// the url — it only ever looks at the options — so this does it here, and
// authenticating a deployed service becomes one changed NATS_URL rather than
// two new environment variables in every project that has one.
//
// The stripped url is what gets logged, so a password never reaches a log.
const fromUrl = (url: string): {url: string; user?: string; pass?: string} => {
  try {
    const parsed = new URL(url);
    if (!parsed.username) return {url};

    return {
      url  : `${parsed.protocol}//${parsed.host}`,
      user : decodeURIComponent(parsed.username),
      pass : decodeURIComponent(parsed.password),
    };
  } catch {
    return {url};   // not a url this can parse — hand it over untouched
  }
};

export class Messenger {
  private _nc?       : NatsConnection;
  private _name?     : string;
  private _closing   = false;
  private _onStatus? : (status: Status) => void;

  // Reaching for the connection before connect() used to hand back undefined
  // and fail somewhere further in, on a line that had nothing to do with it.
  get nc(): NatsConnection {
    if (!this._nc) throw new Error("NATS is not connected — call connect()");
    return this._nc;
  }

  get name()      { return this._name; }
  get connected() { return !!this._nc && !this._nc.isClosed(); }

  async connect(config?: Config) {
    const from = fromUrl(config?.url ?? "nats://localhost:4222");
    const auth = authOf({
      ...config,
      user : config?.user ?? from.user,
      pass : config?.pass ?? from.pass,
    });

    this._name     = config?.name;
    this._closing  = false;
    this._onStatus = config?.onStatus;

    const stop = waiting(`[${config?.name ?? "Unnamed"}]`, from.url);
    try {
      this._nc = await connect({
        ...DEFAULTS,
        servers       : from.url,
        tls           : config?.tls,
        name          : config?.name,
        authenticator : auth,
        inboxPrefix   : config?.inboxPrefix,
        ...config?.options,
      });
    } finally {
      stop();
    }

    console.log(`[${this.name ?? "Unnamed"}] Connected to NATS to '${from.url}'`);
    this.watch();
  }

  /** Stop listening and let in-flight work finish. Safe before connect(). */
  async close() {
    this._closing = true;
    if (this._nc && !this._nc.isClosed()) await this._nc.close();
  }

  // The connection narrates its own life. Left unread, a service that lost
  // the bus for ten minutes and came back says nothing at all — and a
  // service that lost it FOR GOOD says nothing either, which is the case
  // worth shouting about.
  private watch() {
    const nc  = this._nc!;
    const tag = `[${this.name ?? "Unnamed"}]`;

    void (async () => {
      for await (const status of nc.status()) {
        try { this._onStatus?.(status); } catch { /* never our problem */ }

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
            if (this._closing) console.log(`${tag} NATS closed`);
            else console.error(`${tag} NATS connection CLOSED — no reconnect`);
            break;
        }
      }
    })().catch(() => { /* the iterator ends with the connection */ });

    // Resolves with an error only when the connection died of one; either
    // way this is the end of the line, and it is not an event above.
    void nc.closed().then((err) => {
      if (err) console.error(`${tag} NATS closed:`, err.message);
    }).catch(() => {});

  }

  async request<Req, Res>(endpoint : Endpoint<Req, Res>) {
    const timeout  = endpoint.timeout ?? 5000;
    const subject  = `${endpoint.gateway}.${endpoint.api}`;
    const reqBytes = endpoint.req.encode(endpoint.payload).finish();
    const msg      = await this.nc.request(subject, reqBytes, {timeout});

    return endpoint.res.decode(msg.data);
  }

  publish<T>(subject: string, enc: Encoder<T>, payload: T) {
    const bytes = enc.encode(payload).finish();
    this.nc.publish(subject, bytes);
  }

  subscribe<T>(
    subject : string,
    enc     : Encoder<T>,
    handler : (msg: T, subject: string) => Promise<void> | void,
    opts?   : {queue?: string}
  ): Subscription {
    return this.nc.subscribe(subject, {
      queue: opts?.queue,
      callback: (err, msg) => {
        if (err) return console.error(err);

        (async () => {
          try {
            await handler(enc.decode(msg.data), msg.subject);
          } catch (error) {
            console.error("Error processing message", error);
          }
        })();
      }
    });
  }

  serve<Req, Res>(
    api     : string,
    req     : Encoder<Req>,
    res     : Encoder<Res>,
    handler : (req: Req) => Promise<Res> | Res
  ) {
    if (!this.name) throw new Error("serve() api requires gateway name");

    this.nc.subscribe(`${this.name}.${api}`, {
      callback: (err, msg) => {
        if (err) return console.error(err);

        (async () => {
          try {
            const requestData  = req.decode(msg.data);
            const responseData = await handler(requestData);
            const resBytes     = res.encode(responseData).finish();

            msg.respond(resBytes);
          } catch (error) {
            console.error("Error processing reply", error);
          }
        })();
      }
    });
  }
}
