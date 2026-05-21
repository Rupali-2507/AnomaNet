import { useEffect, useRef } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

export function useAlertStream(onAlert: (alert: any) => void) {
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () =>
        new SockJS(`${process.env.NEXT_PUBLIC_API_URL}/ws/alerts`),
      connectHeaders: {
        Authorization: `Bearer ${localStorage.getItem("anomanet_token") ?? ""}`,
      },
      onConnect: () => {
        client.subscribe("/topic/alerts", (msg) => {
          try { onAlert(JSON.parse(msg.body)); } catch {}
        });
      },
      reconnectDelay: 5000,
    });
    client.activate();
    clientRef.current = client;
    return () => { client.deactivate(); };
  }, []);
}