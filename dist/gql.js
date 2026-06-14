"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GqlClientMessenger = exports.GqlResEncoder = exports.GqlReqEncoder = void 0;
/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : gql.ts
 * Created at  : 2026-05-21
 * Updated at  : 2026-06-14
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
const graphql_1 = require("graphql");
const messenger_1 = require("./messenger");
exports.GqlReqEncoder = (0, messenger_1.jsonEncoder)();
exports.GqlResEncoder = (0, messenger_1.jsonEncoder)();
class GqlClientMessenger extends messenger_1.Messenger {
    async close() {
        await this.nc.close();
    }
    async query(gateway, doc, vars, token) {
        const payload = {
            query: (0, graphql_1.print)(doc),
            token: token,
            variables: vars,
        };
        const res = await this.request({
            gateway,
            api: "gql",
            req: exports.GqlReqEncoder,
            res: exports.GqlResEncoder,
            payload: payload,
        });
        if (res.errors && res.errors.length > 0) {
            throw new Error(res.errors[0].message);
        }
        const data = res.data;
        const keys = Object.keys(data).filter(k => k !== "__typename");
        if (keys.length === 1) {
            return data[keys[0]];
        }
        return data;
    }
}
exports.GqlClientMessenger = GqlClientMessenger;
