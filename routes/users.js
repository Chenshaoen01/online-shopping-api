const express = require('express');
const router = express.Router();
const pool = require('@helpers/connection');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios')
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { verifyJWT, verifyAdmin } = require('@middlewares/auth')
require('dotenv').config();

router.use(bodyParser.json());

const JWT_SECRET = process.env.JWT_SECRET;

const generateCsrfToken = () => {
  const csrfToken = crypto.randomBytes(16).toString('hex'); // 隨機生成 token
  const csrfSecret = process.env.CSRF_SECRET; // 從環境變數獲取密鑰
  const signature = crypto
    .createHmac('sha256', csrfSecret)
    .update(csrfToken)
    .digest('hex'); // 計算簽名
  return `${csrfToken}.${signature}`; // 返回帶簽名的 token
};

// Middleware: 驗證 JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer token

  if (token == null) {
    return res.status(401).send({ message: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).send({ message: 'Invalid token' });
    }
    req.user = user; // 在請求對象上存儲已驗證的用戶信息
    next(); // 繼續處理請求
  });
}

// 輔助函數：根據 token 中的用戶 ID 查詢數據庫
async function getQueryById(id) {
  const [result] = await pool.query("SELECT * FROM user WHERE user_id=?", [id]);
  return result;
}

// 使用驗證過的 token 查詢用戶資料
router.get('/checkLogin', verifyJWT, async function(req, res) {
  return res.status(200).send({ message: 'Token Valid' });
});

// 使用驗證過的 token 查詢用戶資料
router.get('/getUser/:id', authenticateToken, async function(req, res) {
  // 這裡可以通過驗證過的 token 來獲取 req.user.user_id
  if (req.user.user_id !== req.params.id) {
    return res.status(403).send({ message: 'You do not have access to this user' });
  }

  try {
    const userData = await getQueryById(req.params.id);
    if (!userData) {
      return res.status(404).send({ message: 'User not found' });
    }
    res.send(userData);
  } catch (error) {
    res.status(500).send({ message: 'Database error', error });
  }
});

// 註冊
router.post('/register', async (req, res) => {
  const { user_name, user_email, user_tel, user_password } = req.body;

  if (!user_name || !user_email || !user_tel || !user_password) {
    return res.status(400).send({ message: "註冊資料未完整填寫" });
  }

  try {
    // 生成 UUID
    const user_id = uuidv4();
  
    // 雜湊密碼
    const hashedPassword = await bcrypt.hash(user_password, 10);
    
    const [matchEmailUser] = await pool.query(
      "SELECT * FROM user WHERE user_email = ?",
      [user_email]
    );

    if(matchEmailUser.length > 0) {
      res.status(400).send({ message: "該 Email 已被註冊" });
      return
    }

    await pool.query(
      "INSERT INTO user (user_id, user_name, user_email, user_tel, user_password, user_authority) VALUES (?, ?, ?, ?, ?, ?)",[user_id, user_name, user_email, user_tel, hashedPassword, "customer"]
    );
    res.status(201).send({ message: "用戶註冊成功。" });
  } catch (err) {
    res.status(500).send({ message: "數據庫錯誤。", error: err });
  }
});

// 登入
router.post('/login', async (req, res) => {
  const { user_email, user_password } = req.body;

  if (!user_email || !user_password) {
    return res.status(400).send({ message: "Email 和密碼是必填的。" });
  }

  const [users] = await pool.query(
    "SELECT * FROM user WHERE user_email = ?",
    [user_email]
  );

  if (users.length === 0) {
    return res.status(401).send({ message: "Email 或密碼不正確。" });
  }

  const user = users[0];

  // 比較密碼與存儲的雜湊值
  const passwordMatch = await bcrypt.compare(user_password, user.user_password);

  if (!passwordMatch) {
    return res.status(401).send({ message: "Email 或密碼不正確。" });
  }

  // 從請求中獲取 domain
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const url = new URL(origin);
  const domain = url.hostname;

  // 驗證 domain 是否在允許的範圍內
  const allowedDomains = [`${process.env.ADMIN_SYSTEM_DOMAIN}`, `${process.env.CUSTOMER_SYSTEM_DOMAIN}`];
  if (!allowedDomains.includes(domain)) {
    return res.status(403).send({ message: "不允許的來源。" });
  }

  // 生成 JWT token、CSRF Token
  const JWTPayload = { 
    user_id: user.user_id,
    user_authority: user.user_authority 
  }
  const token = jwt.sign(JWTPayload, JWT_SECRET, { expiresIn: '24h' });

  const csrfToken = generateCsrfToken();

  // 將 JWT 存入 HttpOnly Cookie
  if(process.env.NODE_ENV === 'production') {
    res.setHeader('Set-Cookie', [`jwt=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 1000}`]);
  } else {
    res.setHeader('Set-Cookie', [`jwt=${token}; HttpOnly; Max-Age=${60 * 60 * 24 * 1000}; Path=/;`]);
  }

  res.status(200).send({message: "登入成功", csrfToken: csrfToken});
});

// google登入
router.post('/googleLogin', async (req, res) => {
  const { access_token } = req.body;

  if (!access_token) {
    return res.status(400).send({ message: "Access token 是必填的。" });
  }

  try {
    // 使用 Google API 獲取用戶信息
    const response = await axios.get(
      `https://www.googleapis.com/oauth2/v1/userinfo?alt=json&access_token=${access_token}`
    );
    const { email, name } = response.data;
    if (!email) {
      return res.status(400).send({ message: "無法從 Google API 獲取 Email。" });
    }

    // 檢查用戶是否已存在於資料庫中
    const [users] = await pool.query(
      "SELECT * FROM user WHERE user_email = ?",
      [email]
    );

    let user;

    if (users.length === 0) {
      // 如果用戶不存在，新增用戶
      const user_id = uuidv4();
      const defaultPassword = uuidv4(); // 設定一個隨機密碼，供日後重置使用
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);

      await pool.query(
        "INSERT INTO user (user_id, user_name, user_email, user_tel, user_password, user_authority) VALUES (?, ?, ?, ?, ?, ?)",
        [
          user_id,
          name || "Google User",
          email,
          "", // 電話號碼可以留空
          hashedPassword,
          "customer",
        ]
      );

      user = {
        user_id,
        user_name: name || "Google User",
        user_email: email,
        user_authority: "customer",
      };
    } else {
      // 如果用戶已存在
      user = users[0];
    }

    // 從請求中獲取 domain
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const url = new URL(origin);
    const domain = url.hostname;
    
    // 驗證 domain 是否在允許的範圍內
    const allowedDomains = [`${process.env.ADMIN_SYSTEM_DOMAIN}`, `${process.env.CUSTOMER_SYSTEM_DOMAIN}`];
    if (!allowedDomains.includes(domain)) {
      return res.status(403).send({ message: "不允許的來源。" });
    }

    // 生成 JWT token、CSRF Token
    const JWTPayload = { 
      user_id: user.user_id,
      user_authority: user.user_authority 
    }
    const token = jwt.sign(JWTPayload, JWT_SECRET, { expiresIn: '24h' });
  
    const csrfToken = generateCsrfToken();
  
    // 將 JWT 存入 HttpOnly Cookie
    if(process.env.NODE_ENV === 'production') {
      res.setHeader('Set-Cookie', [
        `jwt=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 1000}`
      ]);
    } else {
      res.setHeader('Set-Cookie', [
        `jwt=${token}; HttpOnly; Max-Age=${60 * 60 * 24 * 1000}; Path=/;`
      ]);
    }

    res.status(200).send({message: "登入成功", csrfToken: csrfToken});
  } catch (err) {
    res.status(500).send({ message: "登入失敗。", error: err.message });
  }
});


router.post('/logout', (req, res) => {
  // 移除csrfToken、JWTToken
  if(process.env.NODE_ENV === 'production') {
    res.setHeader('Set-Cookie', [
      `jwt=''; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
      `csrfToken=''; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`
    ]);
  } else {
    res.setHeader('Set-Cookie', [
      `jwt=''; HttpOnly; Max-Age=0; Path=/;`,
      `csrfToken=''; HttpOnly; Max-Age=0 Path=/`
    ]);
  }

  res.status(200).send({ message: "登出成功" });
});


// 通過 ID 獲取用戶資料
router.get('/getUserInfo', async function(req, res) {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  try {
    // 驗證並解碼 JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const [userData] = await getQueryById(user_id);
    res.send(userData);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

// 系統管理員帳號，通過 ID 獲取用戶資料
router.get('/getAdminUserInfo', verifyJWT, verifyAdmin, async function(req, res) {
  // 從 Cookie 中取得 JWT token
  const token = req.cookies.jwt;

  if (!token) {
    return res.status(401).json({ message: "未登入。" });
  }

  try {
    // 驗證並解碼 JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const user_id = decoded.user_id;

    const [userData] = await getQueryById(user_id);
    res.send(userData);
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "JWT token 無效或已過期。" });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;