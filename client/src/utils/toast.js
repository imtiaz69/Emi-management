import { toast } from "react-toastify";

export function getErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  return error?.response?.data?.message || error?.message || fallback;
}

export function notifySuccess(message) {
  toast.success(message);
}

export function notifyError(error, fallback) {
  toast.error(getErrorMessage(error, fallback));
}

export function notifyInfo(message) {
  toast.info(message);
}

export function notifyWarning(message) {
  toast.warning(message);
}
