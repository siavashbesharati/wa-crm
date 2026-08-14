/**
 * Database-backed Baileys AuthenticationState (production pattern).
 *
 * Prefer this over useMultiFileAuthState — creds + Signal keys are stored
 * encrypted in the API (wa_auth_states) and reloaded on every connector restart
 * so users do not re-scan QR / re-enter pairing code.
 *
 * Requirements from Baileys session docs:
 * - Persist BOTH creds and keys together (BufferJSON for Buffer/Uint8Array)
 * - keys.set must write (or delete null entries) BEFORE resolving
 * - Listen for creds.update and save promptly
 * - Wrap keys with makeCacheableSignalKeyStore in the socket (session.ts)
 */
import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { api } from "./api-client.js";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

type KeyStore = {
  [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] };
};

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw, BufferJSON.reviver) as T;
  } catch (err) {
    log.warn({ err }, "auth JSON parse failed — starting fresh creds/keys");
    return fallback;
  }
}

export async function loadAuthState(accountId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  flush: () => Promise<void>;
  hasPersistedSession: boolean;
}> {
  const remote = await api.getAuth(accountId);
  const creds: AuthenticationCreds = parseJson(remote.creds_json, initAuthCreds());
  const keys: KeyStore = parseJson(remote.keys_json, {});
  const hasPersistedSession = !!(remote.creds_json && remote.creds_json.length > 8);

  if (hasPersistedSession) {
    log.info(
      {
        accountId,
        registered: !!creds.registered,
        me: (creds.me as { id?: string } | undefined)?.id || "",
      },
      "loaded persisted WhatsApp auth"
    );
  } else {
    log.info({ accountId }, "no persisted auth — will need QR or pairing code");
  }

  /** Serialize writes so concurrent keys.set / creds.update cannot race. */
  let saveChain: Promise<void> = Promise.resolve();

  const persistNow = async () => {
    await api.putAuth(
      accountId,
      JSON.stringify(creds, BufferJSON.replacer),
      JSON.stringify(keys, BufferJSON.replacer)
    );
  };

  const saveCreds = async () => {
    saveChain = saveChain
      .then(async () => {
        try {
          await persistNow();
        } catch (err) {
          log.error({ err, accountId }, "persist auth failed — retrying once");
          await new Promise((r) => setTimeout(r, 400));
          await persistNow();
        }
      })
      .catch((err) => {
        log.error({ err, accountId }, "persist auth gave up");
      });
    await saveChain;
  };

  const flush = async () => {
    await saveChain;
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const value = keys[type]?.[id];
          if (value == null) continue;
          if (type === "app-state-sync-key") {
            data[id] = proto.Message.AppStateSyncKeyData.fromObject(
              value as object
            ) as unknown as SignalDataTypeMap[typeof type];
          } else {
            data[id] = value as SignalDataTypeMap[typeof type];
          }
        }
        return data;
      },
      set: async (data) => {
        // Must persist before resolving (Baileys session docs).
        for (const type_ of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const entries = data[type_];
          if (!entries) continue;
          const bucket = keys[type_] || (keys[type_] = {});
          for (const [id, value] of Object.entries(entries)) {
            if (value == null) {
              delete bucket[id];
            } else {
              bucket[id] = value as SignalDataTypeMap[typeof type_];
            }
          }
          if (Object.keys(bucket).length === 0) {
            delete keys[type_];
          }
        }
        await saveCreds();
      },
      clear: async () => {
        for (const k of Object.keys(keys) as (keyof SignalDataTypeMap)[]) {
          delete keys[k];
        }
        await saveCreds();
      },
    },
  };

  return { state, saveCreds, flush, hasPersistedSession };
}
