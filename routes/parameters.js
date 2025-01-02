const express = require('express');
const router = express.Router();
const pool = require('@helpers/connection');
const { verifyJWT, verifyAdmin, verifyCsrfToken } = require('@middlewares/auth')
require('dotenv').config();

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
router.post('/', verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
  const { param_id, param_content } = req.body;

  if (!param_id) {
    return res.status(400).json({ message: '參數編號為必填項目' });
  }

  try {
    // 檢查 param_id 是否重複
    const [[existingParam]] = await pool.query(`SELECT param_id FROM parameters WHERE param_id = ?`, [param_id]);
    if (existingParam) {
      return res.status(400).json({ message: '參數編號已被使用' });
    }

    // 插入資料
    await pool.query(`INSERT INTO parameters (param_id, param_content) VALUES (?, ?)`, [param_id, param_content]);

    res.status(201).json({ message: '參數新增成功', param_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改參數
router.put('/:param_id', verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
  const { param_id } = req.params;
  const { param_content } = req.body;

  const newContent = !param_content? "" : param_content

  try {
    const [result] = await pool.query(
      `UPDATE parameters SET param_content = ? WHERE param_id = ?`,
      [newContent, param_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的參數' });
    }

    res.json({ message: '參數編輯成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除參數
router.delete('/', verifyJWT, verifyAdmin, verifyCsrfToken, async (req, res) => {
  const { param_ids } = req.body;

  if (!Array.isArray(param_ids) || param_ids.length === 0) {
    return res.status(400).json({ message: '須提供欲刪除的參數編號' });
  }

  try {
    const [result] = await pool.query(`DELETE FROM parameters WHERE param_id IN (?)`, [param_ids]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的參數編號' });
    }

    res.json({ message: '參數刪除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;