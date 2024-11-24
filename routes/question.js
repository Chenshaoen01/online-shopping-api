const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

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
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json(question[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題新增
router.post('/', async (req, res) => {
  const { question_title, question_description, question_sort } = req.body;
  const question_id = uuidv4();

  try {
    await pool.query(
      `INSERT INTO question (question_id, question_title, question_description, question_sort) 
       VALUES (?, ?, ?, ?)`,
      [question_id, question_title, question_description, question_sort]
    );

    res.status(201).json({ message: 'Question added successfully', question_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題修改
router.put('/:question_id', async (req, res) => {
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
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ message: 'Question updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題刪除
router.delete('/', async (req, res) => {
  const { question_ids } = req.body;

  if (!Array.isArray(question_ids) || question_ids.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of question IDs' });
  }

  try {
    const [result] = await pool.query(
      `DELETE FROM question WHERE question_id IN (?)`,
      [question_ids]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No questions found to delete' });
    }

    res.json({ message: 'Questions deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;