import { NatsConnection } from "@nats-io/nats-core";
export interface Encoder<T> {
    encode(message: T): {
        finish(): Uint8Array;
    };
    decode(input: Uint8Array): T;
}
export interface Endpoint<Req, Res> {
    gateway: string;
    api: string;
    req: Encoder<Req>;
    res: Encoder<Res>;
    timeout?: number;
    payload?: any;
}
export interface Config {
    name?: string;
    url?: string;
}
export declare class Messenger {
    private _nc;
    private _name;
    get nc(): NatsConnection;
    get name(): string | undefined;
    connect(config?: Config): Promise<void>;
    request<Req, Res>(endpoint: Endpoint<Req, Res>): Promise<Res>;
    serve<Req, Res>(api: string, req: Encoder<Req>, res: Encoder<Res>, handler: (req: Req) => Promise<Res> | Res): void;
}
