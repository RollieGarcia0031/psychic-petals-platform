import { getAuth } from 'firebase-admin/auth';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Missing or malformed Authorization header.',
    });
  }

  const idToken = header.slice(7);

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
}
