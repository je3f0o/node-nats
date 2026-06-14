import { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { Messenger } from "./messenger";
export interface GqlReq {
    query: string;
    token?: string;
    variables?: Record<string, any>;
    operationName?: string;
}
export interface GqlRes {
    data?: any;
    errors?: any[];
}
export declare const GqlReqEncoder: import("./messenger").Encoder<GqlReq>;
export declare const GqlResEncoder: import("./messenger").Encoder<GqlRes>;
type Unwrap<T> = T extends Record<string, any> ? T[keyof Omit<T, "__typename">] : T;
export declare class GqlClientMessenger extends Messenger {
    close(): Promise<void>;
    query<T, V extends Record<string, any>>(gateway: string, doc: TypedDocumentNode<T, V>, vars?: V, token?: string): Promise<Unwrap<T>>;
}
export {};
