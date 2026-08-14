import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { api } from "./api-client.js";

type KeyStore = {
  [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] };
};

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw, BufferJSON.reviver) as T;
  } catch {
    return fallback;
  }
}

export async function loadAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const remote = await api.getAuth(accountId);
  const creds: AuthenticationCreds = parseJson(remote.creds_json, initAuthCreds());
  const keys: KeyStore = parseJson(remote.keys_json, {});

  const saveCreds = async () => {
    await api.putAuth(
      accountId,
      JSON.stringify(creds, BufferJSON.replacer),
      JSON.stringify(keys, BufferJSON.replacer)
    );
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const value = keys[type]?.[id];
          if (value) {
            if (type === "app-state-sync-key" && value) {
              data[id] = proto.Message.AppStateSyncKeyData.fromObject(
                value as object
              ) as unknown as SignalDataTypeMap[typeof type];
            } else {
              data[id] = value as SignalDataTypeMap[typeof type];
            }
          }
        }
        return data;
      },
      set: async (data) => {
        for (const type_ of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const bucket = keys[type_] || (keys[type_] = {});
          Object.assign(bucket, data[type_]);
        }
        await saveCreds();
      },
    },
  };

  return { state, saveCreds };
}
