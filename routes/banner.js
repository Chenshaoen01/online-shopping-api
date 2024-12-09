const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const { verifyJWT, verifyAdmin, verifyCsrfToken } = require('@middlewares/auth');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MY_SQL_PATH,
  user: process.env.MY_SQL_USER_NAME,
  password: process.env.MY_SQL_PQSSWORD,
  database: process.env.MY_SQL_DB_NAME
});

// Banner查詢（每頁10筆，依頁數顯示）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1; // 取得當前頁數，預設為第1頁
  const limit = 10; // 每頁顯示的筆數
  const offset = (page - 1) * limit; // 計算資料的起始位置

  try {
    // 查詢總 Banner 數量
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM banner;`);
    const lastPage = Math.ceil(total / limit); // 計算總頁數

    // 計算 pageList 的範圍
    let startPage = Math.max(1, page - 2); // 頁碼範圍的起始值
    let endPage = Math.min(lastPage, page + 2); // 頁碼範圍的結束值

    // 調整 pageList 確保最多顯示5個頁碼
    if (endPage - startPage < 4) {
      if (startPage === 1) {
        endPage = Math.min(lastPage, startPage + 4); // 從第1頁開始時向後擴展
      } else if (endPage === lastPage) {
        startPage = Math.max(1, endPage - 4); // 從最後一頁開始時向前擴展
      }
    }

    const pageList = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);

    // 查詢 Banner 資料
    const [banners] = await pool.query(
      `SELECT * FROM banner ORDER BY banner_sort ASC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // 回傳所需資料
    res.json({ dataList: banners, lastPage, pageList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner查詢（取得全部 Banner）
router.get('/getAll', async (req, res) => {
  try {
    const [banners] = await pool.query(`SELECT * FROM banner ORDER BY banner_sort ASC;`);
    res.json(banners);
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

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      cb(null, "public/images/banner"); // 設定檔案存放的目錄
    } catch (err) {
      console.error("Error in setting destination:", err.message);
      cb(err); // 傳遞錯誤給 multer，停止操作
    }
  },
  filename: function (req, file, cb) {
    try {
      const fileExtensionPattern = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/i;
      const extensionMatch = file.originalname.match(fileExtensionPattern);

      if (!extensionMatch) {
        throw new Error("Invalid file extension");
      }

      const extension = extensionMatch[0];
      const uniqueFileName = file.fieldname + "-" + Date.now() + extension;

      req.uploadedFileName = uniqueFileName; // 將檔案名稱存入 req，便於後續處理
      cb(null, uniqueFileName);
    } catch (err) {
      console.error("Error in setting filename:", err.message);
      cb(err); // 傳遞錯誤給 multer，停止操作
    }
  },
});

const upload = multer({ storage: storage });

// BannerImg 新增
router.post('/bannerImg', verifyJWT, verifyAdmin, upload.single('bannerImg'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // 從 req 中獲取檔案名稱
    const uploadedFileName = req.uploadedFileName;

    res.status(201).json({
      message: 'Banner image added successfully',
      fileName: uploadedFileName,
    });
  } catch (err) {
    console.error("Error in handling banner image upload:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Banner 新增
router.post('/', verifyJWT, verifyAdmin, async (req, res) => {
  const banner_id = uuidv4();
  const { new_banner_img, banner_link, banner_sort } = req.body;

  try {
    await pool.query(
      `INSERT INTO banner (banner_id, banner_img, banner_link, banner_sort)
      VALUES (?, ?, ?, ?);`,
      [banner_id, new_banner_img, banner_link, banner_sort]
    );

    res.status(201).json({ message: 'Banner added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner 修改
router.put('/:banner_id', verifyJWT, verifyAdmin, async (req, res) => {
  const { banner_id } = req.params;
  const { banner_img, new_banner_img, banner_link, banner_sort } = req.body;

  try {
    const isNewImageExist = new_banner_img !== null && new_banner_img !== "" && new_banner_img !== undefined;
    const updateImg = isNewImageExist ? new_banner_img : banner_img;

    // 如果有新圖片，先刪除原先的照片
    if (isNewImageExist) {
      const oldBannerImgPath = path.join(__dirname, '..', 'public', 'images', 'banner', banner_img);
      if (fs.existsSync(oldBannerImgPath)) {
        fs.unlinkSync(oldBannerImgPath);
      }
    }

    // 更新新的 banner_img
    const [result] = await pool.query(
      `UPDATE banner
      SET banner_img = ?, banner_link = ?, banner_sort = ?
      WHERE banner_id = ?;`,
      [updateImg, banner_link, banner_sort, banner_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    res.json({ message: 'Banner updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner 刪除（支援一次刪除多筆）
router.delete('/', verifyJWT, verifyAdmin, async (req, res) => {
  const { banner_ids } = req.body;

  if (!Array.isArray(banner_ids) || banner_ids.length === 0) {
    return res.status(400).json({ error: 'Please provide an array of banner IDs' });
  }

  try {
    // 查詢要刪除的 Banner 資料以取得圖片名稱
    const [rows] = await pool.query(
      `SELECT banner_img FROM banner WHERE banner_id IN (?)`,
      [banner_ids]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No banners found to delete' });
    }

    // 刪除相關圖片
    rows.forEach((row) => {
      const bannerImgPath = path.join(__dirname, '..', 'public', 'images', 'banner', row.banner_img);
      if (fs.existsSync(bannerImgPath)) {
        fs.unlinkSync(bannerImgPath);
      }
    });

    // 刪除資料庫中的 Banner
    const [result] = await pool.query(
      `DELETE FROM banner WHERE banner_id IN (?)`,
      [banner_ids]
    );

    res.json({ message: 'Banners deleted successfully', deletedCount: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
