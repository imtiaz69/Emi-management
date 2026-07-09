const { z } = require("zod");

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
        }))
      });
    }
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
        }))
      });
    }
    req.validatedQuery = result.data;
    return next();
  };
}

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");
const optionalObjectId = z.preprocess((value) => (value === "" || value === null ? undefined : value), objectId.optional());
const formBoolean = z.preprocess((value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean());

module.exports = { formBoolean, objectId, optionalObjectId, validateBody, validateQuery, z };
