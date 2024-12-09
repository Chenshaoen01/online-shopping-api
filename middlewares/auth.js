const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET; // 確保環境變數中包含密鑰

// 檢查 JWT token 是否有效
const verifyJWT = (req, res, next) => {
  const token = req.cookies.jwt; // 從 Cookie 中取得 JWT
  if (!token) {
    return res.status(401).send({ message: "未提供身份驗證 token。" });
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

// 檢驗csrfToken是否有效
const verifyCsrfToken = (token) => {
  const csrfSecret = process.env.CSRF_SECRET; // 從環境變數獲取密鑰
  const [csrfToken, signature] = token.split('.'); // 拆分 token 和簽名

  if (!csrfToken || !signature) {
    return false; // 格式錯誤
  }

  const expectedSignature = crypto
    .createHmac('sha256', csrfSecret)
    .update(csrfToken)
    .digest('hex'); // 計算期望的簽名

  return expectedSignature === signature; // 簽名是否匹配
};

module.exports = {
    verifyJWT,
    verifyAdmin,
    verifyCsrfToken
}