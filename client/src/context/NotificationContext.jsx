import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api } from "../api/http";
import { useAuth } from "./AuthContext.jsx";
import { notifyInfo, notifySuccess, notifyWarning } from "../utils/toast.js";

const NotificationContext = createContext(null);
const emptyFeed = { items: [], unreadCount: 0, total: 0 };

function addNotification(feed, notification) {
  const current = feed?.items ? feed : emptyFeed;
  if (current.items.some((item) => item._id === notification._id)) return current;
  return {
    ...current,
    items: [notification, ...current.items].slice(0, 100),
    unreadCount: current.unreadCount + (notification.isRead ? 0 : 1),
    total: current.total + 1
  };
}

function showRealtimeToast(notification) {
  const message = `${notification.title}: ${notification.message}`;
  if (notification.severity === "critical" || notification.severity === "warning") {
    notifyWarning(message);
  } else if (notification.severity === "success") {
    notifySuccess(message);
  } else {
    notifyInfo(message);
  }
}

export function NotificationProvider({ children }) {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const feedQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications?limit=100")).data,
    enabled: Boolean(token && user),
    initialData: token && user ? undefined : emptyFeed,
    refetchInterval: 60_000
  });

  useEffect(() => {
    if (!token || !user) {
      setConnected(false);
      queryClient.setQueryData(["notifications"], emptyFeed);
      return undefined;
    }

    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelayMax: 5000
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("notification:new", (notification) => {
      queryClient.setQueryData(["notifications"], (current) => addNotification(current, notification));
      showRealtimeToast(notification);
    });
    socket.on("identity:session.updated", ({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["identity-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["identity-verification", sessionId] });
    });
    socket.on("identity:session.completed", ({ sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["identity-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["identity-verification", sessionId] });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [queryClient, token, user?._id]);

  const markReadMutation = useMutation({
    mutationFn: async (notificationId) => (await api.patch(`/notifications/${notificationId}/read`)).data,
    onSuccess: (updated) => {
      queryClient.setQueryData(["notifications"], (feed) => {
        const current = feed?.items ? feed : emptyFeed;
        const wasUnread = current.items.some((item) => item._id === updated._id && !item.isRead);
        return {
          ...current,
          items: current.items.map((item) => (item._id === updated._id ? updated : item)),
          unreadCount: Math.max(0, current.unreadCount - (wasUnread ? 1 : 0))
        };
      });
    }
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => api.patch("/notifications/read-all"),
    onSuccess: () => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData(["notifications"], (feed) => {
        const current = feed?.items ? feed : emptyFeed;
        return {
          ...current,
          unreadCount: 0,
          items: current.items.map((item) => ({ ...item, isRead: true, readAt: item.readAt || readAt }))
        };
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (notificationId) => {
      await api.delete(`/notifications/${notificationId}`);
      return notificationId;
    },
    onSuccess: (notificationId) => {
      queryClient.setQueryData(["notifications"], (feed) => {
        const current = feed?.items ? feed : emptyFeed;
        const removed = current.items.find((item) => item._id === notificationId);
        return {
          ...current,
          items: current.items.filter((item) => item._id !== notificationId),
          unreadCount: Math.max(0, current.unreadCount - (removed && !removed.isRead ? 1 : 0)),
          total: Math.max(0, current.total - 1)
        };
      });
    }
  });

  const value = useMemo(
    () => ({
      notifications: feedQuery.data?.items || [],
      unreadCount: feedQuery.data?.unreadCount || 0,
      total: feedQuery.data?.total || 0,
      isLoading: feedQuery.isLoading,
      connected,
      markRead: (id) => markReadMutation.mutateAsync(id),
      markAllRead: () => markAllReadMutation.mutateAsync(),
      removeNotification: (id) => deleteMutation.mutateAsync(id),
      refresh: feedQuery.refetch,
      isUpdating: markReadMutation.isPending || markAllReadMutation.isPending || deleteMutation.isPending
    }),
    [
      connected,
      deleteMutation.isPending,
      feedQuery.data,
      feedQuery.isLoading,
      feedQuery.refetch,
      markAllReadMutation.isPending,
      markReadMutation.isPending
    ]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used within NotificationProvider");
  return value;
}
