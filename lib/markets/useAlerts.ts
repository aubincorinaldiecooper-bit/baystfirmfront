"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ALERTS_STORAGE_KEY,
  createAlertTracker,
  evaluateAlerts,
  parseAlertRules,
  type AlertFiring,
  type AlertRule,
} from "./alerts";
import type { MarketsState } from "./state";

type NotificationState = NotificationPermission | "unsupported";

function saveRules(rules: AlertRule[]): void {
  try {
    window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(rules));
  } catch {}
}

function currentNotificationPermission(): NotificationState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

export function useAlerts(state: MarketsState) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [firings, setFirings] = useState<AlertFiring[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationState>("default");
  const rulesRef = useRef<AlertRule[]>([]);
  const trackerRef = useRef(createAlertTracker());
  const permissionRef = useRef<NotificationState>("default");

  useEffect(() => {
    let loaded: AlertRule[] = [];
    try {
      loaded = parseAlertRules(window.localStorage.getItem(ALERTS_STORAGE_KEY));
    } catch {
      loaded = [];
    }
    rulesRef.current = loaded;
    setRules(loaded);
    saveRules(loaded);

    const permission = currentNotificationPermission();
    permissionRef.current = permission;
    setNotificationPermission(permission);
  }, []);

  useEffect(() => {
    if (
      !state.snapshotLoaded &&
      state.events === 0 &&
      Object.keys(state.classifications).length === 0
    ) {
      return;
    }
    const result = evaluateAlerts(rules, state, trackerRef.current);
    trackerRef.current = result.tracker;
    if (result.firings.length === 0) return;

    setFirings((current) =>
      [...result.firings, ...current]
        .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
        .slice(0, 50),
    );
    if (permissionRef.current === "granted" && typeof window !== "undefined" && "Notification" in window) {
      for (const firing of result.firings) {
        try {
          new window.Notification("Market alert", { body: firing.message });
        } catch {
          break;
        }
      }
    }
  }, [state, rules]);

  const addRule = useCallback((rule: AlertRule) => {
    const next = [...rulesRef.current, rule];
    rulesRef.current = next;
    setRules(next);
    saveRules(next);
  }, []);

  const removeRule = useCallback((id: string) => {
    const next = rulesRef.current.filter((rule) => rule.id !== id);
    rulesRef.current = next;
    setRules(next);
    saveRules(next);
  }, []);

  const requestNotifications = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      permissionRef.current = "unsupported";
      setNotificationPermission("unsupported");
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      permissionRef.current = permission;
      setNotificationPermission(permission);
    } catch {
      permissionRef.current = "denied";
      setNotificationPermission("denied");
    }
  }, []);

  return { rules, firings, notificationPermission, addRule, removeRule, requestNotifications };
}
