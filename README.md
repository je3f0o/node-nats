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
Protobuf, or anything else:

```ts
import {Encoder} from "nats-client";

interface Event { id: string; at: number; }

const JsonEncoder: Encoder<Event> = {
  encode: (msg)   => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
  decode: (input) => JSON.parse(Buffer.from(input).toString()),
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

## Publish / Subscribe

`publish()` fires a message on a subject with no reply expected.
`subscribe()` registers a handler and returns the underlying NATS
`Subscription` (call `.unsubscribe()` to stop).

```ts
// Subscriber
const sub = messenger.subscribe<Event>("orders.created", JsonEncoder, (event, subject) => {
  console.log(`got ${event.id} on ${subject}`);
});

// Publisher
messenger.publish<Event>("orders.created", JsonEncoder, { id: "abc", at: Date.now() });

// Later
sub.unsubscribe();
```

Pass a `queue` to load-balance delivery across a group of subscribers:

```ts
messenger.subscribe<Event>("orders.created", JsonEncoder, handler, { queue: "workers" });
```

Handler errors are caught and logged, so a throwing handler won't tear down
the subscription.

## Request / Reply

```ts
// Server (requires a `name` on connect)
messenger.serve("ping", JsonEncoder, JsonEncoder, async (req) => {
  return { id: req.id, at: Date.now() };
});

// Client
const res = await messenger.request<Event, Event>({
  gateway : "orders",
  api     : "ping",
  req     : JsonEncoder,
  res     : JsonEncoder,
  payload : { id: "abc", at: 0 },
  timeout : 5000,
});
```

The subject is built as `${gateway}.${api}`.

## GraphQL over NATS

`GqlClientMessenger` sends typed GraphQL documents to a gateway's `gql` API:

```ts
import {GqlClientMessenger} from "nats-client";

const client = new GqlClientMessenger();
await client.connect();

const data = await client.request("orders", MyQueryDocument, { id: "abc" });
await client.close();
```

## License

[MIT](./LICENSE)
