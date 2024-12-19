const express = require('express');
const router = express.Router();
const pool = require('@helpers/connection');
const { v4: uuidv4 } = require('uuid');
const {verifyJWT, verifyAdmin} = require('@middlewares/auth')
require('dotenv').config();

// Question查詢（每頁10筆，依頁數顯示）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    // 查詢總問題數量
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM question`);
    const lastPage = Math.ceil(total / limit);

    // 計算 pageList
    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(lastPage, page + 2);

    // 調整 pageList 範圍以確保最多顯示5個頁碼
    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4);
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4);
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    // 查詢問題資料
    const [questions] = await pool.query(
      `SELECT * FROM question ORDER BY question_sort LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ dataList: questions, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題查詢（取得前三個問題）
router.get('/getTopThree', async (req, res) => {
  try {
    const [questions] = await pool.query(`SELECT * FROM question ORDER BY question_sort LIMIT 3`);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題查詢（取得全部問題）
router.get('/getAll', async (req, res) => {
  try {
    const [questions] = await pool.query(`SELECT * FROM question ORDER BY question_sort`);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 依據 question_id 取回特定問題資料
router.get('/:question_id', async (req, res) => {
  const { question_id } = req.params;

  try {
    const [question] = await pool.query(
      `SELECT * FROM question WHERE question_id = ?`,
      [question_id]
    );

    if (question.length === 0) {
      return res.status(404).json({ message: '找不到對應的問答' });
    }

    res.json(question[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題新增
router.post('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { question_title, question_description, question_sort } = req.body;
  const question_id = uuidv4();

  try {
    await pool.query(
      `INSERT INTO question (question_id, question_title, question_description, question_sort) 
       VALUES (?, ?, ?, ?)`,
      [question_id, question_title, question_description, question_sort]
    );

    res.status(201).json({ message: '問答新增成功', question_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題修改
router.put('/:question_id', verifyJWT, verifyAdmin, async (req, res) => {
  const { question_id } = req.params;
  const { question_title, question_description, question_sort } = req.body;

  try {
    const [result] = await pool.query(
      `UPDATE question 
       SET question_title = ?, question_description = ?, question_sort = ? 
       WHERE question_id = ?`,
      [question_title, question_description, question_sort, question_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的問答' });
    }

    res.json({ message: '問答編輯成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題刪除
router.delete('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { question_ids } = req.body;

  if (!Array.isArray(question_ids) || question_ids.length === 0) {
    return res.status(400).json({ message: '須提供欲刪除的問答編號' });
  }

  try {
    const [result] = await pool.query(
      `DELETE FROM question WHERE question_id IN (?)`,
      [question_ids]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '找不到對應的問答' });
    }

    res.json({ message: '問答刪除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;