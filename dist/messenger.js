"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Messenger = exports.jsonEncoder = void 0;
/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : messenger.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-06-25
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
const transport_node_1 = require("@nats-io/transport-node");
const jsonEncoder = () => ({
    encode: (msg) => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
    decode: (input) => JSON.parse(Buffer.from(input).toString()),
});
exports.jsonEncoder = jsonEncoder;
class Messenger {
    _nc;
    _name;
    get nc() { return this._nc; }
    get name() { return this._name; }
    async connect(config) {
        const url = config?.url ?? "nats://localhost:4222";
        this._nc = await (0, transport_node_1.connect)({ servers: url, tls: config?.tls });
        this._name = config?.name;
        console.log(`[${this.name ?? "Unnamed"}] Connected to NATS to '${url}'`);
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
