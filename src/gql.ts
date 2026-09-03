/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : gql.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-09-03
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import {print}             from "graphql";
import {TypedDocumentNode} from "@graphql-typed-document-node/core";
import {
  Messenger,
  jsonEncoder,
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

export const GqlReqEncoder = jsonEncoder<GqlReq>();
export const GqlResEncoder = jsonEncoder<GqlRes>();

type Unwrap<T> = T extends Record<string, any>
  ? T[keyof Omit<T, "__typename">]
  : T;

export class GqlClientMessenger extends Messenger {
  async query<T, V extends Record<string, any>>(
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

    const res = await this.request<GqlReq, GqlRes>({
      gateway,
      api     : "gql",
      req     : GqlReqEncoder,
      res     : GqlResEncoder,
      payload : payload,
    });

    if (res.errors && res.errors.length > 0) {
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