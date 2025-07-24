const File = require('../models/File');
const Message = require('../models/Message');
const Room = require('../models/Room');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const crypto = require('crypto');
const { uploadDir } = require('../middleware/upload');

const fsPromises = {
  writeFile: promisify(fs.writeFile),
  unlink: promisify(fs.unlink),
  access: promisify(fs.access),
  mkdir: promisify(fs.mkdir),
  rename: promisify(fs.rename)
};

const isPathSafe = (filepath, directory) => {
  const resolvedPath = path.resolve(filepath);
  const resolvedDirectory = path.resolve(directory);
  return resolvedPath.startsWith(resolvedDirectory);
};

const generateSafeFilename = (originalname) => {
  try {
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(6).toString('hex');
    const sanitized = originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${timestamp}_${randomBytes}_${sanitized}`;
  } catch (error) {
    console.error('Filename generation error:', error);
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(6).toString('hex');
    return `${timestamp}_${randomBytes}_file`;
  }
};

// S3 파일 메타데이터 저장 (새로운 방식)
exports.saveFileMetadata = async (req, res) => {
  try {
    const { s3Key, url, originalname, mimetype, size, etag } = req.body;
    
    console.log('Received file metadata save request:', {
      s3Key,
      url,
      originalname,
      mimetype,
      size,
      etag,
      userId: req.user.id
    });

    // 필수 필드 검증
    if (!s3Key || !url || !originalname || !mimetype || !size) {
      const missingFields = [];
      if (!s3Key) missingFields.push('s3Key');
      if (!url) missingFields.push('url');
      if (!originalname) missingFields.push('originalname');
      if (!mimetype) missingFields.push('mimetype');
      if (!size) missingFields.push('size');
      
      console.error('Missing required fields:', missingFields);
      
      return res.status(400).json({
        success: false,
        message: '필수 파일 정보가 누락되었습니다.',
        required: ['s3Key', 'url', 'originalname', 'mimetype', 'size'],
        missing: missingFields
      });
    }

    // 파일 크기 검증
    if (size > 50 * 1024 * 1024) { // 50MB
      console.error('File size too large:', size);
      return res.status(413).json({
        success: false,
        message: '파일 크기는 50MB를 초과할 수 없습니다.'
      });
    }

    // MIME 타입 검증
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'
    ];

    if (!allowedMimeTypes.includes(mimetype)) {
      console.error('Unsupported MIME type:', {
        receivedType: mimetype,
        allowedTypes: allowedMimeTypes
      });
      
      return res.status(415).json({
        success: false,
        message: '지원하지 않는 파일 형식입니다.',
        allowedTypes: allowedMimeTypes,
        receivedType: mimetype
      });
    }

    console.log('File metadata validation passed');

    // 파일 메타데이터 저장 (S3 URL만 저장)
    const file = new File({
      filename: s3Key, // S3 key를 filename으로 사용
      originalname: originalname,
      mimetype: mimetype,
      size: size,
      user: req.user.id,
      path: url, // S3 URL을 path로 저장
      url: url, // S3 URL 저장 (메인)
      etag: etag, // S3 ETag 저장 (선택사항)
      storageType: 's3' // 명시적으로 S3 타입 지정
    });

    console.log('Saving file metadata to database:', {
      filename: file.filename,
      originalname: file.originalname,
      storageType: file.storageType,
      userId: file.user
    });

    await file.save();

    console.log('File metadata saved successfully:', {
      fileId: file._id,
      filename: file.filename,
      originalname: file.originalname
    });

    res.status(200).json({
      success: true,
      message: '파일 메타데이터 저장 성공',
      data: {
        file: {
          _id: file._id,
          filename: file.filename,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: file.url,
          s3Key: file.s3Key,
          storageType: file.storageType,
          uploadDate: file.uploadDate
        }
      }
    });

  } catch (error) {
    console.error('File metadata save error:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      userId: req.user?.id
    });
    
    // 중복 파일 에러 처리
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: '이미 등록된 파일입니다.'
      });
    }

    res.status(500).json({
      success: false,
      message: '파일 메타데이터 저장 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 파일 정보 조회 (S3/로컬 모두 지원)
exports.getFileInfo = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: '파일명이 제공되지 않았습니다.'
      });
    }

    // 파일 데이터베이스에서 조회
    const file = await File.findOne({ 
      $or: [
        { filename: filename },
        { s3Key: filename }
      ]
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    // 파일 메시지 조회 (권한 확인용)
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      return res.status(404).json({
        success: false,
        message: '파일 메시지를 찾을 수 없습니다.'
      });
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id
    });

    if (!room) {
      return res.status(403).json({
        success: false,
        message: '파일에 접근할 권한이 없습니다.'
      });
    }

    res.status(200).json({
      success: true,
      message: '파일 정보 조회 성공',
      data: {
        file: {
          _id: file._id,
          filename: file.filename,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: file.storageType === 's3' ? file.url : file.fileUrl,
          storageType: file.storageType,
          uploadDate: file.uploadDate
        }
      }
    });

  } catch (error) {
    console.error('File info retrieval error:', error);
    res.status(500).json({
      success: false,
      message: '파일 정보 조회 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 파일 다운로드 URL 제공
exports.downloadFile = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: '파일명이 제공되지 않았습니다.'
      });
    }

    // 파일 정보 조회 및 권한 확인
    const fileInfo = await this.getFileInfoInternal(filename, req.user.id);
    
    if (!fileInfo.success) {
      return res.status(fileInfo.statusCode || 500).json({
        success: false,
        message: fileInfo.message
      });
    }

    const file = fileInfo.file;

    // S3 파일인 경우 직접 URL 반환
    if (file.storageType === 's3') {
      res.status(200).json({
        success: true,
        message: '파일 다운로드 URL 제공',
        url: file.url,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
    } else {
      // 로컬 파일인 경우 기존 방식 유지
      const filePath = file.path;
      
      // 파일 존재 확인
      try {
        await fsPromises.access(filePath, fs.constants.R_OK);
      } catch (error) {
        return res.status(404).json({
          success: false,
          message: '파일을 찾을 수 없습니다.'
        });
      }

      // 파일 스트림으로 응답
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalname)}"`);
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', file.size);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }

  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({
      success: false,
      message: '파일 다운로드 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 파일 미리보기 URL 제공
exports.viewFile = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    if (!filename) {
      return res.status(400).json({
        success: false,
        message: '파일명이 제공되지 않았습니다.'
      });
    }

    // 파일 정보 조회 및 권한 확인
    const fileInfo = await this.getFileInfoInternal(filename, req.user.id);
    
    if (!fileInfo.success) {
      return res.status(fileInfo.statusCode || 500).json({
        success: false,
        message: fileInfo.message
      });
    }

    const file = fileInfo.file;

    // 미리보기 가능한 파일 타입 확인
    const previewableMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf'
    ];

    if (!previewableMimeTypes.includes(file.mimetype)) {
      return res.status(415).json({
        success: false,
        message: '미리보기를 지원하지 않는 파일 형식입니다.'
      });
    }

    // S3 파일인 경우 직접 URL 반환
    if (file.storageType === 's3') {
      res.status(200).json({
        success: true,
        message: '파일 미리보기 URL 제공',
        url: file.url,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
    } else {
      // 로컬 파일인 경우 기존 방식 유지
      const filePath = file.path;
      
      // 파일 존재 확인
      try {
        await fsPromises.access(filePath, fs.constants.R_OK);
      } catch (error) {
        return res.status(404).json({
          success: false,
          message: '파일을 찾을 수 없습니다.'
        });
      }

      // 파일 스트림으로 응답
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Length', file.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }

  } catch (error) {
    console.error('File view error:', error);
    res.status(500).json({
      success: false,
      message: '파일 미리보기 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

// 내부용 파일 정보 조회 함수
exports.getFileInfoInternal = async (filename, userId) => {
  try {
    // 파일 데이터베이스에서 조회
    const file = await File.findOne({ 
      $or: [
        { filename: filename },
        { s3Key: filename }
      ]
    });

    if (!file) {
      return {
        success: false,
        statusCode: 404,
        message: '파일을 찾을 수 없습니다.'
      };
    }

    // 파일 메시지 조회 (권한 확인용)
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      return {
        success: false,
        statusCode: 404,
        message: '파일 메시지를 찾을 수 없습니다.'
      };
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: userId
    });

    if (!room) {
      return {
        success: false,
        statusCode: 403,
        message: '파일에 접근할 권한이 없습니다.'
      };
    }

    return {
      success: true,
      file: file
    };

  } catch (error) {
    console.error('Internal file info retrieval error:', error);
    return {
      success: false,
      statusCode: 500,
      message: '파일 정보 조회 중 오류가 발생했습니다.'
    };
  }
};

// 기존 파일 업로드 (하위 호환성 유지)
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
      path: newPath,
      storageType: 'local'
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
        storageType: file.storageType,
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

// 파일 삭제
exports.deleteFile = async (req, res) => {
  try {
    const fileId = req.params.id;
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: '파일 ID가 제공되지 않았습니다.'
      });
    }

    const file = await File.findById(fileId);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    // 파일 소유자 확인
    if (file.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '파일을 삭제할 권한이 없습니다.'
      });
    }

    // 파일 메시지 확인
    const message = await Message.findOne({ file: file._id });
    if (message) {
      return res.status(400).json({
        success: false,
        message: '메시지에 첨부된 파일은 삭제할 수 없습니다.'
      });
    }

    // S3 파일인 경우 S3에서 삭제는 별도로 처리하지 않음 (비용 및 복잡성 고려)
    // 로컬 파일인 경우 물리적 파일 삭제
    if (file.storageType === 'local' && file.path) {
      try {
        await fsPromises.unlink(file.path);
      } catch (error) {
        console.error('Physical file deletion error:', error);
        // 물리적 파일 삭제 실패해도 데이터베이스에서는 삭제 진행
      }
    }

    // 데이터베이스에서 파일 메타데이터 삭제
    await File.findByIdAndDelete(fileId);

    res.status(200).json({
      success: true,
      message: '파일이 성공적으로 삭제되었습니다.'
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