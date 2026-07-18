import { useMemo, useState } from "react";
import { Bell, CheckCheck, Inbox, RefreshCcw, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { NotificationItem } from "./NotificationCenter.jsx";
import { useNotifications } from "../context/NotificationContext.jsx";

export default function NotificationInbox() {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    connected,
    isLoading,
    isUpdating,
    markRead,
    markAllRead,
    removeNotification,
    refresh
  } = useNotifications();
  const [filter, setFilter] = useState("all");
  const visible = useMemo(
    () => (filter === "unread" ? notifications.filter((item) => !item.isRead) : notifications),
    [filter, notifications]
  );

  async function openNotification(item) {
    if (!item.isRead) await markRead(item._id);
    if (item.actionUrl) navigate(item.actionUrl);
  }

  return (
    <section className="panel notification-inbox">
      <div className="section-heading notification-inbox-heading">
        <div>
          <span className="eyebrow"><Bell size={15} /> Real-time alerts</span>
          <h2>Notification inbox</h2>
          <p>Payment reminders, account decisions, order activity, risk warnings, and inventory alerts.</p>
        </div>
        <div className="notification-inbox-actions">
          <span className={`socket-state ${connected ? "connected" : ""}`}>
            {connected ? "Live" : "Reconnecting"}
          </span>
          <button className="icon-button" type="button" onClick={() => refresh()} title="Refresh notifications">
            <RefreshCcw size={17} />
          </button>
          <button className="secondary-button" type="button" onClick={() => markAllRead()} disabled={!unreadCount || isUpdating}>
            <CheckCheck size={17} /> Mark all read
          </button>
        </div>
      </div>

      <div className="notification-filter" role="group" aria-label="Notification filter">
        <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>
          All <span>{notifications.length}</span>
        </button>
        <button className={filter === "unread" ? "active" : ""} type="button" onClick={() => setFilter("unread")}>
          Unread <span>{unreadCount}</span>
        </button>
      </div>

      <div className="notification-inbox-list">
        {isLoading ? (
          <p className="hint">Loading notifications...</p>
        ) : visible.length === 0 ? (
          <div className="notification-empty inbox">
            <Inbox size={28} />
            <strong>{filter === "unread" ? "No unread notifications" : "No notifications yet"}</strong>
            <span>Your important updates will be kept here.</span>
          </div>
        ) : (
          visible.map((item) => (
            <div className="notification-inbox-row" key={item._id}>
              <NotificationItem item={item} onOpen={openNotification} />
              <button
                className="notification-delete"
                type="button"
                onClick={() => removeNotification(item._id)}
                aria-label={`Remove ${item.title || "notification"}`}
                title="Remove notification"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
