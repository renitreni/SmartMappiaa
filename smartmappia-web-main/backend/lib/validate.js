// ---------------------------------------------------------------------
// Tiny request-body validation layer (no new dependencies).
//
// validateBody(schema) returns Express middleware that checks req.body
// against a small per-route schema, REJECTS unknown fields, coerces
// nothing silently, and replaces req.body with only the validated
// fields — so controllers never see injected extras.
//
//   validateBody({
//     name:     { type: 'string', required: true, maxLength: 120 },
//     quantity: { type: 'integer', min: 1, max: 50 },
//     lat:      { type: 'number', nullable: true },
//     item_type:{ type: 'string', enum: ['meal_package', 'drink_dessert_addon'] },
//     params:   { type: 'object' },
//   })
//
// Rules per field: type ('string'|'number'|'integer'|'boolean'|'object'),
// required, nullable, enum, min/max (numbers), maxLength (strings/objects
// where objects are capped by their JSON size).
// ---------------------------------------------------------------------

function checkField(name, value, rule, errors) {
  if (value === undefined) {
    if (rule.required) errors.push(`${name} is required`);
    return undefined;
  }
  if (value === null) {
    if (rule.nullable) return null;
    errors.push(`${name} must not be null`);
    return undefined;
  }

  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${name} must be a string`);
        return undefined;
      }
      const trimmed = value.trim();
      if (rule.required && !trimmed) {
        errors.push(`${name} must not be empty`);
        return undefined;
      }
      const maxLength = rule.maxLength || 2000;
      if (trimmed.length > maxLength) {
        errors.push(`${name} must be at most ${maxLength} characters`);
        return undefined;
      }
      if (rule.enum && !rule.enum.includes(trimmed)) {
        errors.push(`${name} must be one of: ${rule.enum.join(', ')}`);
        return undefined;
      }
      return trimmed;
    }
    case 'number':
    case 'integer': {
      const n = Number(value);
      if (typeof value === 'boolean' || value === '' || !Number.isFinite(n)) {
        errors.push(`${name} must be a number`);
        return undefined;
      }
      if (rule.type === 'integer' && !Number.isInteger(n)) {
        errors.push(`${name} must be an integer`);
        return undefined;
      }
      if (rule.min != null && n < rule.min) {
        errors.push(`${name} must be >= ${rule.min}`);
        return undefined;
      }
      if (rule.max != null && n > rule.max) {
        errors.push(`${name} must be <= ${rule.max}`);
        return undefined;
      }
      return n;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`${name} must be a boolean`);
        return undefined;
      }
      return value;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${name} must be an object`);
        return undefined;
      }
      const maxLength = rule.maxLength || 4000;
      if (JSON.stringify(value).length > maxLength) {
        errors.push(`${name} is too large`);
        return undefined;
      }
      return value;
    }
    default:
      errors.push(`${name} has an unknown validation type`);
      return undefined;
  }
}

function validateBody(schema) {
  return (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    // Reject anything the route did not declare (prevents mass assignment).
    for (const key of Object.keys(body)) {
      if (!schema[key]) errors.push(`Unknown field: ${key}`);
    }

    const cleaned = {};
    for (const [name, rule] of Object.entries(schema)) {
      const value = checkField(name, body[name], rule, errors);
      if (value !== undefined) cleaned[name] = value;
    }

    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = cleaned;
    return next();
  };
}

module.exports = { validateBody };
