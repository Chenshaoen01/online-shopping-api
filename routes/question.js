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

// 問題查詢（每頁10筆，依頁數顯示）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [questions] = await pool.query(
      `SELECT * FROM question ORDER BY question_sort LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ data: questions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 問題查詢（取得全部問題）
router.get('/getAll', async (req, res) => {
  try {
    const [questions] = await pool.query(`SELECT * FROM question ORDER BY question_sort`);
    res.json({ data: questions });
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
router.delete('/:question_id', async (req, res) => {
  const { question_id } = req.params;

  try {
    const [result] = await pool.query(
      `DELETE FROM question WHERE question_id = ?`,
      [question_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }

    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;