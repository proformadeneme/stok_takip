export function requireRole(roles = []) {
  const allow = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (allow.length === 0 || allow.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}
