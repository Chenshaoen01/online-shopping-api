const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
router.use(bodyParser.json());

require('dotenv').config();
const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  database: process.env.MY_SQL_DB_NAME,
  password: process.env.MY_SQL_PQSSWORD
}).promise();

const JWT_SECRET = process.env.JWT_SECRET;

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

// 1. 註冊
router.post('/register', async (req, res) => {
  const { user_name, user_email, user_tel, user_password } = req.body;

  if (!user_name || !user_email || !user_tel || !user_password) {
    return res.status(400).send({ message: "所有欄位都是必填的。" });
  }

  // 生成 UUID
  const user_id = uuidv4();

  // 雜湊密碼
  const hashedPassword = await bcrypt.hash(user_password, 10);

  try {
    await pool.query(
      "INSERT INTO user (user_id, user_name, user_email, user_tel, user_password) VALUES (?, ?, ?, ?, ?)",
      [user_id, user_name, user_email, user_tel, hashedPassword]
    );
    res.status(201).send({ message: "用戶註冊成功。" });
  } catch (err) {
    res.status(500).send({ message: "數據庫錯誤。", error: err });
  }
});

// 2. 登入
router.post('/login', async (req, res) => {
  const { user_email, user_password } = req.body;

  if (!user_email || !user_password) {
    return res.status(400).send({ message: "Email 和密碼是必填的。" });
  }

  try {
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

    // 生成 JWT token
    const token = jwt.sign({ user_id: user.user_id }, JWT_SECRET, { expiresIn: '1h' });

    // 生成 CSRF token
    const csrfToken = uuidv4();

    // 將 JWT 存入 HttpOnly Cookie
    res.cookie('jwt', token, {
      httpOnly: true, // HttpOnly，前端無法讀取此 Cookie
      secure: process.env.NODE_ENV === 'production', // 僅在 HTTPS 中傳遞
      maxAge: 60 * 60 * 1000 // 1 小時
    });

    // 將 CSRF token 透過 Set-Cookie 或回應體傳送給前端
    res.cookie('csrfToken', csrfToken, {
      httpOnly: false, // 非 HttpOnly，前端可以讀取
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 1000 // 1 小時
    });

    res.status(200).send({
      message: "登入成功",
      csrfToken // 回應體中包含 CSRF token
    });
  } catch (err) {
    res.status(500).send({ message: "數據庫錯誤。", error: err });
  }
});


router.post('/logout', (req, res) => {
  // 清除 JWT token
  res.cookie('jwt', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0 // 删除 cookie
  });

  // 清除 CSRF token
  res.cookie('csrfToken', '', {
      httpOnly: false, // 可通过 JavaScript 清除
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0 // 删除 cookie
  });

  res.status(200).send({ message: "登出成功" });
});


// 範例：通過 ID 獲取用戶資料
router.get('/getUser/:id', async function(req, res) {
  const [userData] = await getQueryById(req.params.id);
  res.send(userData);
});

module.exports = router;