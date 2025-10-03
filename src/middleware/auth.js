import jwt from 'jsonwebtoken';

export function authenticate(req, res, next) {
  // DISABLE_AUTH etkinse yerelde kimlik doğrulamayı atla (test amaçlı)
  const disabled = (process.env.DISABLE_AUTH || '').toString().toLowerCase();
  if (disabled === '1' || disabled === 'true' || disabled === 'yes') {
    // Aşağı akıştaki kontroller için varsayılan admin benzeri kullanıcı kimliği ver
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    return next();
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change_this_secret');
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
