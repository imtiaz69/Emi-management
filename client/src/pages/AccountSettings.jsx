import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";
import { notifyError, notifySuccess } from "../utils/toast.js";

export default function AccountSettings() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name || "", phone: user?.phone || "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });

  const saveAccount = useMutation({
    mutationFn: async () => api.patch("/auth/account", profile),
    onSuccess: ({ data }) => {
      updateUser(data.user);
      notifySuccess("Account updated successfully.");
    },
    onError: (err) => notifyError(err, "Unable to update account.")
  });

  const changePassword = useMutation({
    mutationFn: async () => api.patch("/auth/change-password", passwords),
    onSuccess: () => {
      setPasswords({ currentPassword: "", newPassword: "" });
      notifySuccess("Password changed successfully.");
    },
    onError: (err) => notifyError(err, "Unable to change password.")
  });

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Account settings</h1>
          <p>Update profile details and change your password.</p>
        </div>
      </div>
      <div className="work-grid">
        <section className="panel">
          <h2>Profile</h2>
          <div className="form-grid compact">
            <label>Name
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </label>
            <label>Phone
              <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </label>
          </div>
          <button className="button" onClick={() => saveAccount.mutate()} disabled={saveAccount.isPending}>Save profile</button>
        </section>
        <section className="panel">
          <h2>Change password</h2>
          <div className="form-grid compact">
            <label>Current password
              <input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} />
            </label>
            <label>New password
              <input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} />
            </label>
          </div>
          <button className="button" onClick={() => changePassword.mutate()} disabled={!passwords.currentPassword || !passwords.newPassword || changePassword.isPending}>Change password</button>
        </section>
      </div>
    </section>
  );
}
