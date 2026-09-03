import type { Status, TlsOptions, Subscription, Authenticator, NatsConnection, ConnectionOptions } from "@nats-io/nats-core";
export interface Encoder<T> {
    encode(message: T): {
        finish(): Uint8Array;
    };
    decode(input: Uint8Array): T;
}
export declare const jsonEncoder: <T>() => Encoder<T>;
export interface Endpoint<Req, Res> {
    gateway: string;
    api: string;
    req: Encoder<Req>;
    res: Encoder<Res>;
    timeout?: number;
    payload?: any;
}
export interface Config {
    tls?: TlsOptions;
    url?: string;
    name?: string;
    user?: string;
    pass?: string;
    token?: string;
    nkey?: string;
    creds?: string | Uint8Array;
    credsFile?: string;
    authenticator?: Authenticator;
    /** Inbox prefix for request(). A user whose subject permissions are
     *  narrowed still needs its replies to land somewhere it may subscribe;
     *  without this they arrive on `_INBOX.>` and are denied. */
    inboxPrefix?: string;
    /** Every connection event — disconnect, reconnect, server error, close.
     *  For a health endpoint or a metric; the events are logged regardless. */
    onStatus?: (status: Status) => void;
    /** Merged last: the @nats-io options this interface does not name. */
    options?: Partial<ConnectionOptions>;
}
export declare class Messenger {
    private _nc?;
    private _name?;
    private _onStatus?;
    get nc(): NatsConnection;
    get name(): string | undefined;
    get connected(): boolean;
    connect(config?: Config): Promise<void>;
    /** Stop listening and let in-flight work finish. Safe before connect(). */
    close(): Promise<void>;
    private watch;
    request<Req, Res>(endpoint: Endpoint<Req, Res>): Promise<Res>;
    publish<T>(subject: string, enc: Encoder<T>, payload: T): void;
    subscribe<T>(subject: string, enc: Encoder<T>, handler: (msg: T, subject: string) => Promise<void> | void, opts?: {
        queue?: string;
    }): Subscription;
    serve<Req, Res>(api: string, req: Encoder<Req>, res: Encoder<Res>, handler: (req: Req) => Promise<Res> | Res): void;
}
