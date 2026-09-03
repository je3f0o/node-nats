# nats-client

A small, typed [NATS](https://nats.io/) client for Node.js. It wraps the
official `@nats-io` packages and provides three messaging patterns on top of a
simple pluggable `Encoder` interface:

- **Request / Reply** — `request()` and `serve()`
- **Publish / Subscribe** — `publish()` and `subscribe()`
- **GraphQL over NATS** — `GqlClientMessenger`

## Installation

```sh
npm install
npm run build
```

## Encoders

Every message is serialized through an `Encoder<T>`, so you can use JSON,
Protobuf, or anything else. A generic JSON encoder is built in:

```ts
import {jsonEncoder} from "nats-client";

interface Event { id: string; at: number; }

const codec = jsonEncoder<Event>();
```

To plug in your own format, implement the `Encoder<T>` interface:

```ts
import {Encoder} from "nats-client";

const myCodec: Encoder<Event> = {
  encode: (msg)   => ({ finish: () => /* Uint8Array */ }),
  decode: (input) => /* Event */,
};
```

## Connecting

```ts
import {Messenger} from "nats-client";

const messenger = new Messenger();
await messenger.connect({ name: "orders", url: "nats://localhost:4222" });
```

Both `name` and `url` are optional. `url` defaults to
`nats://localhost:4222`; `name` is used as the gateway prefix for `serve()`.

### Authentication

TLS is not authentication: `tls` proves the *server* to this client and says
nothing about who the client is. These options are the other half, and all of
them are optional — pass none and the client connects anonymously, exactly as
it did before authentication existed.

```ts
await messenger.connect({
  name : "orders",
  url  : "nats://user:pass@nats.example.com:4222",   // simplest
});
```

Credentials may ride in the url, so a deployed service authenticates through
the `NATS_URL` it already reads from its environment — one changed variable,
no new code. Percent-encode anything exotic in the password (`/` → `%2F`).
The url is stripped before it is logged, so the password never reaches a log.

Or pass them explicitly. One is picked, in this order:

| Option          | For                                            |
| --------------- | ---------------------------------------------- |
| `authenticator` | anything the `@nats-io` packages support       |
| `credsFile`     | path to a `.creds` file (NGS / operator mode)  |
| `creds`         | the same file's contents                       |
| `nkey`          | an nkey seed, `"SU…"`                          |
| `token`         | a server `authorization { token: … }`          |
| `user` / `pass` | a server `authorization { users: [ … ] }`      |

An explicit option always beats one found in the url.

A wrong password **fails** rather than retrying forever: `@nats-io` aborts on
repeated authentication errors, so bad credentials surface as a rejected
`connect()` instead of hiding inside a reconnect loop that looks like a
network problem.

### Staying connected

The client is configured to outlive its bus. A NATS restart, a dropped route
or a machine that vanished must never end the service:

| Default                     | Why                                          |
| --------------------------- | -------------------------------------------- |
| `maxReconnectAttempts: -1`  | the library otherwise gives up after 10 tries (~20s) and closes the connection — leaving a live process holding a dead client, subscribed to nothing |
| `waitOnFirstConnect: true`  | a service that boots while NATS is down waits for it instead of crashing |
| `pingInterval: 20s`, `maxPingOut: 3` | a peer that disappeared without a FIN is found in about a minute, not after the 2-minute default ping |

Subscriptions — including everything registered with `serve()` — are restored
by the client when it reconnects; nothing has to be re-registered.

Every connection event is logged, and can be observed:

```ts
await messenger.connect({
  name     : "orders",
  url      : process.env.NATS_URL,
  onStatus : (s) => { if (s.type === "reconnect") metrics.reconnects++; },
});

messenger.connected;   // false while the bus is gone
```

Override any of it with `options`, which is merged last:

```ts
await messenger.connect({url, options: {waitOnFirstConnect: false}});
```

### Restricted subjects

A user whose subject permissions are narrowed also needs somewhere for its
replies to land — `request()` subscribes to an inbox, and the default
`_INBOX.>` is denied along with everything else. Give it a prefix the
server allows:

```ts
await messenger.connect({url, inboxPrefix: "_INBOX.orders"});
```

## Publish / Subscribe

`publish()` fires a message on a subject with no reply expected.
`subscribe()` registers a handler and returns the underlying NATS
`Subscription` (call `.unsubscribe()` to stop).

```ts
// Subscriber
const sub = messenger.subscribe<Event>("orders.created", codec, (event, subject) => {
  console.log(`got ${event.id} on ${subject}`);
});

// Publisher
messenger.publish<Event>("orders.created", codec, { id: "abc", at: Date.now() });

// Later
sub.unsubscribe();
```

Pass a `queue` to load-balance delivery across a group of subscribers:

```ts
messenger.subscribe<Event>("orders.created", codec, handler, { queue: "workers" });
```

Handler errors are caught and logged, so a throwing handler won't tear down
the subscription.

## Request / Reply

```ts
// Server (requires a `name` on connect)
messenger.serve("ping", codec, codec, async (req) => {
  return { id: req.id, at: Date.now() };
});

// Client
const res = await messenger.request<Event, Event>({
  gateway : "orders",
  api     : "ping",
  req     : codec,
  res     : codec,
  payload : { id: "abc", at: 0 },
  timeout : 5000,
});
```

The subject is built as `${gateway}.${api}`.

## GraphQL over NATS

`GqlClientMessenger` extends `Messenger`, so it inherits `connect`, `publish`,
`subscribe`, `serve`, and `request`, and adds a typed `query()` that sends
GraphQL documents to a gateway's `gql` API:

```ts
import {GqlClientMessenger} from "nats-client";

const client = new GqlClientMessenger();
await client.connect();

const data = await client.query("orders", MyQueryDocument, { id: "abc" });
await client.close();
```

## License

[MIT](./LICENSE)
