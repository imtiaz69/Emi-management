const AuditLog = require("../models/AuditLog");

async function writeAudit(actorId, action, entityType, entityId, metadata = {}, options = {}) {
  return AuditLog.create([{ actorId, action, entityType, entityId, metadata }], options).then((docs) => docs[0]);
}

module.exports = { writeAudit };
