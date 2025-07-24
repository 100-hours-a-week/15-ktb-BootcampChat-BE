// backend/routes/api/files.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const fileController = require('../../controllers/fileController');
const { upload, errorHandler } = require('../../middleware/upload');

// S3 파일 메타데이터 저장 (새로운 방식)
router.post('/metadata',
  auth,
  fileController.saveFileMetadata
);

// 기존 파일 업로드 (하위 호환성 유지)
router.post('/upload',
  auth,
  upload.single('file'),
  errorHandler,
  fileController.uploadFile
);

// 파일 정보 조회 (S3 URL 반환)
router.get('/info/:filename',
  auth,
  fileController.getFileInfo
);

// 파일 다운로드 (S3 URL 반환)
router.get('/download/:filename',
  auth,
  fileController.downloadFile
);

// 파일 보기 (미리보기용 S3 URL 반환)
router.get('/view/:filename',
  auth,
  fileController.viewFile
);

// 파일 삭제
router.delete('/:id',
  auth,
  fileController.deleteFile
);

// API 상태 확인
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'File API is running',
    endpoints: {
      metadata: 'POST /metadata - S3 파일 메타데이터 저장',
      upload: 'POST /upload - 로컬 파일 업로드 (레거시)',
      info: 'GET /info/:filename - 파일 정보 조회',
      download: 'GET /download/:filename - 파일 다운로드 URL',
      view: 'GET /view/:filename - 파일 미리보기 URL',
      delete: 'DELETE /:id - 파일 삭제'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;