/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : gql.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-05-22
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {print}             from "graphql";
import {TypedDocumentNode} from "@graphql-typed-document-node/core";
import {
  Config,
  Encoder,
  Messenger,
} from "./messenger";

export interface GqlReq {
  query          : string;
  token?         : string;
  variables?     : Record<string, any>;
  operationName? : string;
}

export interface GqlRes {
  data?   : any;
  errors? : any[];
}

export const GqlReqEncoder: Encoder<GqlReq> = {
  encode: (msg)   => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
  decode: (input) => JSON.parse(Buffer.from(input).toString()),
};

export const GqlResEncoder: Encoder<GqlRes> = {
  encode: (msg)   => ({ finish: () => Buffer.from(JSON.stringify(msg)) }),
  decode: (input) => JSON.parse(Buffer.from(input).toString()),
};

type Unwrap<T> = T extends Record<string, any>
  ? T[keyof Omit<T, "__typename">]
  : T;

export class GqlClientMessenger {
  private messenger!: Messenger;

  async connect(config?: Config) {
    this.messenger = new Messenger();
    await this.messenger.connect(config);
  }

  async close() {
    await this.messenger.nc.close();
  }

  async request<T, V extends Record<string, any>>(
    gateway : string,
    doc     : TypedDocumentNode<T, V>,
    vars?   : V,
    token?  : string
  ) {
    const payload: GqlReq = {
      query     : print(doc),
      token     : token,
      variables : vars,
    };

    const res = await this.messenger.request<GqlReq, GqlRes>({
      gateway,
      api     : "gql",
      req     : GqlReqEncoder,
      res     : GqlResEncoder,
      payload : payload,
    });

    if (res.errors && res.errors.length > 0) {
      console.log(res);
      throw new Error(res.errors[0].message);
    }

    const data = res.data as Record<string, any>;
    const keys = Object.keys(data).filter(k => k !== "__typename");

    if (keys.length === 1) {
      return data[keys[0]] as Unwrap<T>;
    }

    return data as Unwrap<T>;
  }
}