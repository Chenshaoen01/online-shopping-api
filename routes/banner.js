const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('@helpers/connection');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyJWT, verifyAdmin, verifyCsrfToken } = require('@middlewares/auth');
const AWS = require('aws-sdk');
require('dotenv').config();

// 初始化 Cloudflare R2 配置
const s3 = new AWS.S3({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: 'auto',
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Banner查詢（每頁10筆，依頁數顯示）
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM banner;`);
    const lastPage = Math.ceil(total / limit);

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

    const [banners] = await pool.query(
      `SELECT * FROM banner ORDER BY banner_sort ASC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

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
      return res.status(404).json({ message: '找不到對應的首頁輪播資料' });
    }

    res.json(banner[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BannerImg 新增
router.post('/bannerImg', upload.single('bannerImg'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '未提供檔案' });
  }

  try {
    const fileKey = `banner/${uuidv4()}-${req.file.originalname}`;

    // 上傳檔案到 R2
    await s3
      .upload({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
      .promise();

    res.status(201).json({
      message: '圖片新增成功',
      fileName: fileKey,
    });
  } catch (err) {
    console.error('Error uploading to R2:', err);
    res.status(500).json({ message: '圖片新增失敗' });
  }
});

// Banner 新增
router.post('/', async (req, res) => {
  const banner_id = uuidv4();
  const { new_banner_img, banner_link, banner_sort, new_mobile_banner_img } = req.body;

  try {
    await pool.query(
      `INSERT INTO banner (banner_id, banner_img, mobile_banner_img, banner_link, banner_sort)
      VALUES (?, ?, ?, ?, ?);`,
      [banner_id, new_banner_img, new_mobile_banner_img, banner_link, banner_sort]
    );

    res.status(201).json({ message: '首頁輪播資料新增成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Banner 修改
router.put('/:banner_id', async (req, res) => {
  const { banner_id } = req.params;
  const { banner_img, new_banner_img, mobile_banner_img, new_mobile_banner_img, banner_link, banner_sort } = req.body;

  try {
    const isNewImageExist = new_banner_img !== null && new_banner_img !== '' && new_banner_img !== undefined;
    const updateImg = isNewImageExist ? new_banner_img : banner_img;

    if (isNewImageExist) {
      // 刪除 Cloudflare R2 上的舊圖片
      await s3
        .deleteObject({
          Bucket: BUCKET_NAME,
          Key: banner_img,
        })
        .promise();
    }

    const isNewMobileImageExist = new_mobile_banner_img !== null && new_mobile_banner_img !== '' && new_mobile_banner_img !== undefined;
    const updateMobileImg = isNewMobileImageExist ? new_mobile_banner_img : mobile_banner_img;

    if (isNewMobileImageExist) {
      // 刪除 Cloudflare R2 上的舊圖片
      await s3
        .deleteObject({
          Bucket: BUCKET_NAME,
          Key: mobile_banner_img,
        })
        .promise();
    }


    await pool.query(
      `UPDATE banner SET banner_img = ?, mobile_banner_img = ?, banner_link = ?, banner_sort = ? WHERE banner_id = ?;`,
      [updateImg, updateMobileImg, banner_link, banner_sort, banner_id]
    );

    res.json({ message: '首頁輪播資料編輯成功' });
  } catch (err) {
    console.error('Error updating banner:', err);
    res.status(500).json({ error: err.message });
  }
});

// Banner 刪除（支援一次刪除多筆）
router.delete('/', async (req, res) => {
  const { banner_ids } = req.body;

  if (!Array.isArray(banner_ids) || banner_ids.length === 0) {
    return res.status(400).json({ message: '須指定欲刪除的首頁輪播資料' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT banner_img, mobile_banner_img FROM banner WHERE banner_id IN (?);`,
      [banner_ids]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: '找不到對應的首頁輪播資料' });
    }

    // 刪除 Cloudflare R2 上的圖片
    await Promise.all(
      rows.map((row) =>
        s3
          .deleteObject({
            Bucket: BUCKET_NAME,
            Key: row.banner_img,
          })
          .promise()
      )
    );

    await Promise.all(
      rows.map((row) =>
        s3
          .deleteObject({
            Bucket: BUCKET_NAME,
            Key: row.mobile_banner_img,
          })
          .promise()
      )
    );

    await pool.query(
      `DELETE FROM banner WHERE banner_id IN (?);`,
      [banner_ids]
    );

    res.json({ message: '首頁輪播資料刪除成功' });
  } catch (err) {
    console.error('Error deleting banners:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;