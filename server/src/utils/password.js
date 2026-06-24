function isStrongPassword(password = "") {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

module.exports = { isStrongPassword };
