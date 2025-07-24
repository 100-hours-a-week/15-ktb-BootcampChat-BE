// backend/routes/api/files.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const fileController = require('../../controllers/fileController');
// const { upload, errorHandler } = require('../../middleware/upload'); // 더 이상 직접 파일 업로드에 사용되지 않음

// S3 업로드 후 파일 메타데이터 등록 (기존 /upload 엔드포인트 재활용 및 E2E 호환성 유지)
router.post('/upload',
  auth,
  fileController.registerFile // 이제 파일 자체를 받지 않고 메타데이터를 등록
);

// S3 업로드 후 파일 메타데이터 등록 (프론트엔드에서 직접 호출하는 경우)
router.post('/register',
  auth,
  fileController.registerFile
);

// 파일 다운로드
router.get('/download/:filename',
  auth,
  fileController.downloadFile
);

// 파일 보기 (미리보기용)
router.get('/view/:filename',
  auth,
  fileController.viewFile
);

// 파일 삭제
router.delete('/:id',
  auth,
  fileController.deleteFile
);

module.exports = router;