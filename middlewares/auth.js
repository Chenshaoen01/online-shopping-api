const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET; // 確保環境變數中包含密鑰

// 檢查 JWT token 是否有效
const verifyJWT = (req, res, next) => {
  const token = req.cookies.jwt; // 從 Cookie 中取得 JWT
  if (!token) {
    return res.status(401).send({ message: "沒有權限執行此操作" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // 驗證 token
    req.user = decoded; // 將解碼後的資料存入 req.user，供後續使用
    next();
  } catch (err) {
    return res.status(401).send({ message: "無效的身份驗證 token。" });
  }
};

// 檢查是否為系統管理員
const verifyAdmin = (req, res, next) => {
  if (req.user && req.user.user_authority === "admin") {
    next(); // 通過驗證
  } else {
    return res.status(403).send({ message: "沒有權限執行此操作。" });
  }
};

// 檢查 CSRF token 是否有效
const verifyCsrfTokenWithSecret = (token) => {
  if (!token) return false;

  const [csrfToken, signature] = token.split('.');
  if (!csrfToken || !signature) {
    return false;
  }

  const CSRF_SECRET = process.env.CSRF_SECRET;
  const expectedSignature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(csrfToken)
    .digest('hex');

  return expectedSignature === signature;
};

// CSRF middleware
const verifyCsrfToken = (req, res, next) => {
  const csrfToken = req.headers['x-csrf-token']; // 從 Header 中取得 CSRF token
  if (!csrfToken) {
    return res.status(403).send({ message: "沒有權限執行此操作" });
  }

  if (!verifyCsrfTokenWithSecret(csrfToken)) {
    return res.status(403).send({ message: "沒有權限執行此操作" });
  }

  next(); // CSRF token 驗證通過
};

module.exports = {
    verifyJWT,
    verifyAdmin,
    verifyCsrfToken
}