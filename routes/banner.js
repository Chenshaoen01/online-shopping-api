const express = require('express');
const multer = require('multer')
const path = require('path');
const fs = require('fs');
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

// Banner查詢（每頁10筆，依頁數顯示）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [banners] = await pool.query(
      `SELECT * FROM banner LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ data: banners });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner查詢（取得全部 Banner）
router.get('/getAll', async (req, res) => {
  try {
    const [banners] = await pool.query(`SELECT * FROM banner`);
    res.json({ data: banners });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 依據 banner_id 取回特定 banner 資料
router.get('/:banner_id', async (req, res) => {
  const { banner_id } = req.params;

  try {
    const [banner] = await pool.query(
      `SELECT * FROM banner WHERE banner_id = ?`,
      [banner_id]
    );

    if (banner.length === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json(banner[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let fileName = ""
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/images/banner");
  },
  filename: function (req, file, cb) {
    const fileExtensionPatter = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/;
    const extension = file.originalname.match(fileExtensionPatter)[0];
    fileName = file.fieldname + "-" + Date.now() + extension
    cb(null, fileName);
  },
});

const upload = multer({storage: storage})

// Banner 新增
router.post('/', upload.single('banner'), async (req, res) => {
  const banner_id = uuidv4();
  const banner_img = fileName;
  try {
    await pool.query(
      `INSERT INTO banner (banner_id, banner_img)
       VALUES (?, ?)`,
      [banner_id, banner_img]
    );

    res.status(201).json({ message: 'Banner added successfully', banner_img });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner 修改
router.put('/:banner_id', upload.single('banner'), async (req, res) => {
  const { banner_id } = req.params;
  const banner_img = fileName;

  try {
    // 獲取原本的 banner_img
    const [rows] = await pool.query(
      `SELECT banner_img FROM banner WHERE banner_id = ?`,
      [banner_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    const oldBannerImg = rows[0].banner_img;
    const oldBannerImgPath = path.join(__dirname, '..', 'public', 'images', 'banner', oldBannerImg);
    // 刪除原先的照片
    if (fs.existsSync(oldBannerImgPath)) {
      fs.unlinkSync(oldBannerImgPath);
    }

    // 更新新的 banner_img
    const [result] = await pool.query(
      `UPDATE banner 
       SET banner_img = ?
       WHERE banner_id = ?`,
      [banner_img, banner_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json({ message: 'Banner updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner 刪除
router.delete('/:banner_id', async (req, res) => {
  const { banner_id } = req.params;

  try {
    const [result] = await pool.query(
      `DELETE FROM banner WHERE banner_id = ?`,
      [banner_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json({ message: 'Banner deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;