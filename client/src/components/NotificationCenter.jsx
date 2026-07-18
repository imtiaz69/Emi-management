import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, CircleAlert, CircleCheck, Info, PackageSearch, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useNotifications } from "../context/NotificationContext.jsx";

function relativeTime(value) {
  const date = dayjs(value);
  const minutes = Math.max(0, dayjs().diff(date, "minute"));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = dayjs().diff(date, "hour");
  if (hours < 24) return `${hours}h ago`;
  const days = dayjs().diff(date, "day");
  if (days < 7) return `${days}d ago`;
  return date.format("DD MMM YYYY");
}

function NotificationIcon({ item }) {
  if (item.category === "inventory") return <PackageSearch size={17} />;
  if (item.category === "risk" || item.severity === "critical") return <ShieldAlert size={17} />;
  if (item.severity === "success") return <CircleCheck size={17} />;
  if (item.severity === "warning") return <CircleAlert size={17} />;
  return <Info size={17} />;
}

function notificationTitle(item) {
  if (item.title && item.title !== "Notification") return item.title;
  return String(item.messageType || "Notification")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function NotificationItem({ item, compact = false, onOpen }) {
  return (
    <button
      className={`notification-item ${item.isRead ? "" : "unread"} severity-${item.severity || "info"} ${compact ? "compact" : ""}`}
      type="button"
      onClick={() => onOpen(item)}
    >
      <span className="notification-item-icon"><NotificationIcon item={item} /></span>
      <span className="notification-item-copy">
        <strong>{notificationTitle(item)}</strong>
        <span>{item.message}</span>
        <small>{relativeTime(item.sentAt || item.createdAt)}</small>
      </span>
      {!item.isRead && <span className="notification-unread-dot" aria-label="Unread" />}
    </button>
  );
}

export default function NotificationCenter({ onViewAll, variant = "dashboard" }) {
  const navigate = useNavigate();
  const { notifications, unreadCount, connected, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function openNotification(item) {
    if (!item.isRead) await markRead(item._id);
    setOpen(false);
    if (item.actionUrl) navigate(item.actionUrl);
  }

  function viewAll() {
    setOpen(false);
    onViewAll?.();
  }

  return (
    <div className={`notification-center notification-center-${variant}`} ref={rootRef}>
      <button
        className={variant === "dashboard" ? "dashboard-icon-button notification-trigger" : "notification-pill notification-trigger"}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${unreadCount} unread notifications`}
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={variant === "dashboard" ? 19 : 17} />
        {unreadCount > 0 && <strong className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</strong>}
      </button>

      {open && (
        <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-popover-header">
            <div>
              <h2>Notifications</h2>
              <span className={`socket-state ${connected ? "connected" : ""}`}>
                {connected ? "Live updates on" : "Reconnecting"}
              </span>
            </div>
            {unreadCount > 0 && (
              <button className="icon-text-button" type="button" onClick={() => markAllRead()} title="Mark all as read">
                <CheckCheck size={16} /> Mark all read
              </button>
            )}
          </div>
          <div className="notification-popover-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">
                <Bell size={24} />
                <strong>You are all caught up</strong>
                <span>Important account activity will appear here.</span>
              </div>
            ) : (
              notifications.slice(0, 7).map((item) => (
                <NotificationItem key={item._id} item={item} compact onOpen={openNotification} />
              ))
            )}
          </div>
          {onViewAll && notifications.length > 0 && (
            <button className="notification-view-all" type="button" onClick={viewAll}>
              View all notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { relativeTime };
