const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { verifyJWT, verifyAdmin } = require('@middlewares/auth')
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

// 取得所有參數資料（支援分頁）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 計算總數
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM parameters`);
    const lastPage = Math.ceil(total / limit);

    // 計算分頁範圍
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(lastPage, page + 2);

    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4);
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4);
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    // 查詢資料
    const [parameters] = await pool.query(
      `SELECT * FROM parameters ORDER BY param_id LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ dataList: parameters, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取得特定參數資料
router.get('/:param_id', async (req, res) => {
  const { param_id } = req.params;

  try {
    const [parameter] = await pool.query(`SELECT * FROM parameters WHERE param_id = ?`, [param_id]);

    if (parameter.length === 0) {
      res.json("");
    }

    res.json(parameter[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增參數
router.post('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { param_id, param_content } = req.body;

  if (!param_id) {
    return res.status(400).json({ error: 'param_id' });
  }

  try {
    // 檢查 param_id 是否重複
    const [[existingParam]] = await pool.query(`SELECT param_id FROM parameters WHERE param_id = ?`, [param_id]);
    if (existingParam) {
      return res.status(400).json({ error: 'param_id already exists' });
    }

    // 插入資料
    await pool.query(`INSERT INTO parameters (param_id, param_content) VALUES (?, ?)`, [param_id, param_content]);

    res.status(201).json({ message: 'Parameter added successfully', param_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改參數
router.put('/:param_id', verifyJWT, verifyAdmin, async (req, res) => {
  const { param_id } = req.params;
  const { param_content } = req.body;

  const newContent = !param_content? "" : param_content

  try {
    const [result] = await pool.query(
      `UPDATE parameters SET param_content = ? WHERE param_id = ?`,
      [newContent, param_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Parameter not found' });
    }

    res.json({ message: 'Parameter updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除參數
router.delete('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { param_ids } = req.body;

  if (!Array.isArray(param_ids) || param_ids.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of param_ids' });
  }

  try {
    const [result] = await pool.query(`DELETE FROM parameters WHERE param_id IN (?)`, [param_ids]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No parameters found to delete' });
    }

    res.json({ message: 'Parameters deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;