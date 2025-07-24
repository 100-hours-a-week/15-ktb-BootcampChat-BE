const File = require('../models/File');
const Message = require('../models/Message');
const Room = require('../models/Room');
const AWS = require('aws-sdk'); // AWS SDK 추가

// AWS S3 설정
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

// 개선된 파일 정보 조회 함수 (S3 URL 반환)
const getFileFromRequest = async (req) => {
  try {
    const filename = req.params.filename;
    const token = req.headers['x-auth-token'] || req.query.token;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    if (!filename) {
      throw new Error('Invalid filename');
    }

    if (!token || !sessionId) {
      throw new Error('Authentication required');
    }

    const file = await File.findOne({ filename: filename });
    if (!file) {
      throw new Error('File not found in database');
    }

    // 채팅방 권한 검증을 위한 메시지 조회
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      throw new Error('File message not found');
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id
    });

    if (!room) {
      throw new Error('Unauthorized access');
    }

    return { file, url: file.path }; // S3 URL 반환
  } catch (error) {
    console.error('getFileFromRequest error:', {
      filename: req.params.filename,
      error: error.message
    });
    throw error;
  }
};

// S3 업로드 후 파일 메타데이터 등록
exports.registerFile = async (req, res) => {
  try {
    const { url, filename, size, type } = req.body;

    if (!url || !filename || !size || !type) {
      return res.status(400).json({
        success: false,
        message: '필수 파일 메타데이터가 누락되었습니다.'
      });
    }

    const file = new File({
      filename: filename, // S3에 저장된 파일명 (key)
      originalname: filename, // 원본 파일명
      mimetype: type,
      size: size,
      user: req.user.id,
      path: url // S3 URL을 path 필드에 저장
    });

    await file.save();

    res.status(200).json({
      success: true,
      message: '파일 메타데이터 등록 성공',
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate,
        url: file.path // S3 URL 반환
      }
    });

  } catch (error) {
    console.error('File registration error:', error);
    res.status(500).json({
      success: false,
      message: '파일 메타데이터 등록 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 기존 파일 업로드 (더 이상 사용되지 않음)
/*
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 선택되지 않았습니다.'
      });
    }

    const safeFilename = generateSafeFilename(req.file.originalname);
    const currentPath = req.file.path;
    const newPath = path.join(uploadDir, safeFilename);

    const file = new File({
      filename: safeFilename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      user: req.user.id,
      path: newPath
    });

    await file.save();
    await fsPromises.rename(currentPath, newPath);

    res.status(200).json({
      success: true,
      message: '파일 업로드 성공',
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    if (req.file?.path) {
      try {
        await fsPromises.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Failed to delete uploaded file:', unlinkError);
      }
    }
    res.status(500).json({
      success: false,
      message: '파일 업로드 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};
*/

exports.downloadFile = async (req, res) => {
  try {
    const { file, url } = await getFileFromRequest(req);

    // S3 URL을 클라이언트에 반환
    res.status(200).json({
      success: true,
      message: '파일 다운로드 URL 제공',
      url: url,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

  } catch (error) {
    handleFileError(error, res);
  }
};

exports.viewFile = async (req, res) => {
  try {
    const { file, url } = await getFileFromRequest(req);

    if (!file.isPreviewable()) {
      return res.status(415).json({
        success: false,
        message: '미리보기를 지원하지 않는 파일 형식입니다.'
      });
    }

    // S3 URL을 클라이언트에 반환
    res.status(200).json({
      success: true,
      message: '파일 미리보기 URL 제공',
      url: url,
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

  } catch (error) {
    handleFileError(error, res);
  }
};

// const handleFileStream = (fileStream, res) => { // 더 이상 사용되지 않음
//   fileStream.on('error', (error) => {
//     console.error('File streaming error:', error);
//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: '파일 스트리밍 중 오류가 발생했습니다.'
//       });
//     }
//   });

//   fileStream.pipe(res);
// };

const handleFileError = (error, res) => {
  console.error('File operation error:', {
    message: error.message,
    stack: error.stack
  });

  // 에러 상태 코드 및 메시지 매핑
  const errorResponses = {
    'Invalid filename': { status: 400, message: '잘못된 파일명입니다.' },
    'Authentication required': { status: 401, message: '인증이 필요합니다.' },
    // 'Invalid file path': { status: 400, message: '잘못된 파일 경로입니다.' }, // 로컬 파일 경로 검증 불필요
    'File not found in database': { status: 404, message: '파일을 찾을 수 없습니다.' },
    'File message not found': { status: 404, message: '파일 메시지를 찾을 수 없습니다.' },
    'Unauthorized access': { status: 403, message: '파일에 접근할 권한이 없습니다.' },
    // 'ENOENT': { status: 404, message: '파일을 찾을 수 없습니다.' } // 로컬 파일 시스템 에러 불필요
  };

  const errorResponse = errorResponses[error.message] || {
    status: 500,
    message: '파일 처리 중 오류가 발생했습니다.'
  };

  res.status(errorResponse.status).json({
    success: false,
    message: errorResponse.message
  });
};

exports.deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    if (file.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '파일을 삭제할 권한이 없습니다.'
      });
    }

    const filePath = path.join(uploadDir, file.filename);

    if (!isPathSafe(filePath, uploadDir)) {
      return res.status(403).json({
        success: false,
        message: '잘못된 파일 경로입니다.'
      });
    }
    
    try {
      await fsPromises.access(filePath, fs.constants.W_OK);
      await fsPromises.unlink(filePath);
    } catch (unlinkError) {
      console.error('File deletion error:', unlinkError);
    }

    await file.deleteOne();

    res.json({
      success: true,
      message: '파일이 삭제되었습니다.'
    });
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      message: '파일 삭제 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};