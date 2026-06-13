/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : messenger.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-05-21
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {connect}        from "@nats-io/transport-node";
import {NatsConnection} from "@nats-io/nats-core";

export interface Encoder<T> {
  encode(message: T)        : {finish(): Uint8Array};
  decode(input: Uint8Array) : T;
}

export interface Endpoint<Req, Res> {
  gateway  : string;
  api      : string;
  req      : Encoder<Req>;
  res      : Encoder<Res>;
  timeout? : number;
  payload? : any;
}

export interface Config {
  name? : string;
  url?  : string;
}

export class Messenger {
  private _nc!   : NatsConnection;
  private _name! : string | undefined;

  get nc()   { return this._nc;   }
  get name() { return this._name; }

  async connect(config?: Config) {
    const url  = config?.url ?? "nats://localhost:4222";
    this._nc   = await connect({servers: url});
    this._name = config?.name;
    console.log(`[${this.name ?? "Unnamed"}] Connected to NATS to '${url}'`);
  }

  async request<Req, Res>(endpoint : Endpoint<Req, Res>) {
    const timeout  = endpoint.timeout ?? 5000;
    const subject  = `${endpoint.gateway}.${endpoint.api}`;
    const reqBytes = endpoint.req.encode(endpoint.payload).finish();
    const msg      = await this.nc.request(subject, reqBytes, {timeout});

    return endpoint.res.decode(msg.data);
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