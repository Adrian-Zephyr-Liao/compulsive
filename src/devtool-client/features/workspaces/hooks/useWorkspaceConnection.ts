import { useCallback, useEffect, useRef, useState } from "react";
import { connectDevframe, DevframeConnectionError, type DevframeRpcClient } from "devframe/client";

import { useI18n } from "../../../app/i18n.js";
import type { DevtoolState } from "../../../../devtool.js";
import type { ConnectionState, WorkspaceRpc } from "../types.js";
import { describeError } from "../utils/errors.js";

export interface WorkspaceConnection {
  connectionState: ConnectionState;
  fatalError: string;
  getRpc: () => Promise<WorkspaceRpc>;
}

export function useWorkspaceConnection(
  onState: (state: DevtoolState) => void,
): WorkspaceConnection {
  const { t } = useI18n();
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [fatalError, setFatalError] = useState("");
  const rpcPromiseRef = useRef<Promise<WorkspaceRpc> | null>(null);
  const translateRef = useRef(t);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    let activeClient: DevframeRpcClient | undefined;
    let stopConnectionStatus: (() => void) | undefined;
    let reconnectPromise: Promise<WorkspaceRpc> | undefined;
    let reconnectTimer: number | undefined;
    let wakeReconnectDelay: (() => void) | undefined;
    let reconnectAttempt = 0;
    let disposed = false;

    async function waitForReconnectHost(): Promise<void> {
      const url =
        activeClient?.connection.metaBaseUrl ?? new URL("./__connection.json", document.baseURI);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Devframe connection check failed: ${response.status}`);
    }

    async function loadState(rpc: WorkspaceRpc, reconnecting: boolean): Promise<DevtoolState> {
      const request = rpc.call("get-state");
      if (!reconnecting) return request;
      let timer: number | undefined;
      try {
        return await Promise.race([
          request,
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error(translateRef.current("connection.reconnectTimeout"))),
              5_000,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    }

    async function connectRpc(reconnecting = false): Promise<WorkspaceRpc> {
      setConnectionState(reconnecting ? "reconnecting" : "connecting");
      let client: DevframeRpcClient | undefined;
      try {
        if (reconnecting) await waitForReconnectHost();
        client = await connectDevframe();
        const connectedClient = client;
        const previousClient = activeClient;
        stopConnectionStatus?.();
        activeClient = connectedClient;
        stopConnectionStatus = connectedClient.events.on("connection:status", (status) => {
          if (connectedClient !== activeClient) return;
          if (status === "unauthorized") {
            setConnectionState("failed");
            setFatalError(
              describeError(
                connectedClient.connectionError ??
                  translateRef.current("connection.authorizationFailed"),
              ),
            );
          } else if (status === "disconnected" || status === "error") {
            void reconnect(
              connectedClient.connectionError ?? translateRef.current("connection.closed"),
            ).catch(() => undefined);
          }
        });
        previousClient?.close?.();
        const rpc = connectedClient.scope("compulsive").rpc;
        onState(await loadState(rpc, reconnecting));
        if (connectedClient !== activeClient)
          throw new Error(translateRef.current("connection.replaced"));
        reconnectAttempt = 0;
        setFatalError("");
        setConnectionState("connected");
        return rpc;
      } catch (error) {
        if (client && client === activeClient) {
          stopConnectionStatus?.();
          stopConnectionStatus = undefined;
          activeClient = undefined;
          client.close?.();
        }
        setFatalError(describeError(error));
        if (error instanceof DevframeConnectionError && error.kind === "auth") {
          setConnectionState("failed");
        }
        throw error;
      }
    }

    function reconnect(error: unknown): Promise<WorkspaceRpc> {
      if (error instanceof DevframeConnectionError && error.kind === "auth") {
        setConnectionState("failed");
        setFatalError(describeError(error));
        return Promise.reject(error);
      }
      if (reconnectPromise) return reconnectPromise;
      setConnectionState("reconnecting");
      setFatalError(describeError(error));
      const promise = (async () => {
        while (!disposed) {
          const delay = Math.min(500 * 2 ** reconnectAttempt, 5_000);
          reconnectAttempt += 1;
          await new Promise<void>((resolve) => {
            wakeReconnectDelay = resolve;
            reconnectTimer = window.setTimeout(resolve, delay);
          });
          reconnectTimer = undefined;
          wakeReconnectDelay = undefined;
          if (disposed) break;
          try {
            return await connectRpc(true);
          } catch (connectionError) {
            if (
              connectionError instanceof DevframeConnectionError &&
              connectionError.kind === "auth"
            ) {
              throw connectionError;
            }
            setFatalError(describeError(connectionError));
          }
        }
        throw new Error(translateRef.current("connection.closed"));
      })();
      reconnectPromise = promise;
      rpcPromiseRef.current = promise;
      void promise
        .finally(() => {
          if (reconnectPromise === promise) reconnectPromise = undefined;
        })
        .catch(() => undefined);
      return promise;
    }

    const initialPromise = connectRpc().catch((error) => reconnect(error));
    rpcPromiseRef.current = initialPromise;
    void initialPromise.catch((error) => {
      if (!disposed) {
        setConnectionState("failed");
        setFatalError(describeError(error));
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      wakeReconnectDelay?.();
      stopConnectionStatus?.();
      activeClient?.close?.();
    };
  }, [onState]);

  const getRpc = useCallback(async (): Promise<WorkspaceRpc> => {
    if (!rpcPromiseRef.current) throw new Error(translateRef.current("connection.notStarted"));
    return rpcPromiseRef.current;
  }, []);

  return { connectionState, fatalError, getRpc };
}
