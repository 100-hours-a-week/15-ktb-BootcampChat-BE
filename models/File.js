const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  filename: { 
    type: String, 
    required: true,
    index: true,
    validate: {
      validator: function(v) {
        // S3 key 형식 또는 기존 로컬 파일명 형식 모두 허용
        return /^[0-9]+_[a-f0-9]+\.[a-z0-9]+$/.test(v) || // 기존 로컬 형식
               /^[a-zA-Z0-9\/_.-]+$/.test(v); // S3 key 형식
      },
      message: '올바르지 않은 파일명 형식입니다.'
    }
  },
  originalname: { 
    type: String,
    required: true,
    set: function(name) {
      try {
        if (!name) return '';
        
        // 파일명에서 경로 구분자 제거
        const sanitizedName = name.replace(/[\/\\]/g, '');
        
        // 유니코드 정규화 (NFC)
        return sanitizedName.normalize('NFC');
      } catch (error) {
        console.error('Filename sanitization error:', error);
        return name;
      }
    },
    get: function(name) {
      try {
        if (!name) return '';
        
        // 유니코드 정규화된 형태로 반환
        return name.normalize('NFC');
      } catch (error) {
        console.error('Filename retrieval error:', error);
        return name;
      }
    }
  },
  mimetype: { 
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        const allowedMimeTypes = [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/webm', 'video/quicktime',
          'audio/mpeg', 'audio/wav', 'audio/ogg',
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'
        ];
        return allowedMimeTypes.includes(v);
      },
      message: '지원하지 않는 MIME 타입입니다.'
    }
  },
  size: { 
    type: Number,
    required: true,
    min: [0, '파일 크기는 0보다 작을 수 없습니다.'],
    max: [50 * 1024 * 1024, '파일 크기는 50MB를 초과할 수 없습니다.']
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true,
    index: true
  },
  path: { 
    type: String,
    required: true
  },
  
  // S3 관련 필드들
  s3Key: {
    type: String,
    sparse: true, // S3 파일만 가지는 필드
    index: true
  },
  url: {
    type: String,
    sparse: true, // S3 파일만 가지는 필드
    validate: {
      validator: function(v) {
        if (!v) return true; // 선택 필드이므로 빈 값 허용
        try {
          new URL(v);
          return true;
        } catch (error) {
          return false;
        }
      },
      message: '올바른 URL 형식이 아닙니다.'
    }
  },
  etag: {
    type: String,
    sparse: true // S3 파일만 가지는 필드
  },
  
  // 파일 저장소 타입 (local 또는 s3)
  storageType: {
    type: String,
    enum: ['local', 's3'],
    default: function() {
      return this.s3Key ? 's3' : 'local';
    },
    index: true
  },
  
  uploadDate: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  // 파일 상태
  status: {
    type: String,
    enum: ['active', 'deleted', 'quarantined'],
    default: 'active',
    index: true
  }
}, {
  timestamps: true,
  toJSON: { getters: true, virtuals: true },
  toObject: { getters: true, virtuals: true }
});

// 복합 인덱스
FileSchema.index({ filename: 1, user: 1 });
FileSchema.index({ s3Key: 1, user: 1 });
FileSchema.index({ storageType: 1, uploadDate: -1 });
FileSchema.index({ user: 1, status: 1, uploadDate: -1 });

// 파일 URL을 반환하는 가상 속성
FileSchema.virtual('fileUrl').get(function() {
  if (this.storageType === 's3' && this.url) {
    return this.url;
  }
  // 로컬 파일의 경우 API 엔드포인트 URL 반환
  return `/api/files/view/${this.filename}`;
});

// 파일 크기를 사람이 읽기 쉬운 형식으로 반환하는 가상 속성
FileSchema.virtual('humanReadableSize').get(function() {
  const bytes = this.size;
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// 파일 타입을 반환하는 가상 속성
FileSchema.virtual('fileType').get(function() {
  const mimeType = this.mimetype;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'document';
  if (mimeType.includes('document') || mimeType.includes('msword')) return 'document';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return 'archive';
  return 'other';
});

// 미리보기 가능 여부를 확인하는 메소드
FileSchema.methods.isPreviewable = function() {
  const previewableMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
    'application/pdf'
  ];
  return previewableMimeTypes.includes(this.mimetype);
};

// 다운로드 가능 여부를 확인하는 메소드
FileSchema.methods.isDownloadable = function() {
  return this.status === 'active';
};

// 파일 소유자 확인 메소드
FileSchema.methods.isOwnedBy = function(userId) {
  return this.user.toString() === userId.toString();
};

// 파일 삭제 전 처리
FileSchema.pre('remove', async function(next) {
  try {
    // 로컬 파일인 경우 물리적 파일 삭제
    if (this.storageType === 'local' && this.path) {
      const fs = require('fs').promises;
      try {
        await fs.unlink(this.path);
      } catch (error) {
        console.error('Physical file removal error:', error);
        // 물리적 파일 삭제 실패해도 계속 진행
      }
    }
    // S3 파일의 경우 별도 처리 없음 (비용 고려)
    next();
  } catch (error) {
    console.error('File pre-remove error:', error);
    next(error);
  }
});

// findByIdAndDelete 후킹
FileSchema.pre('findOneAndDelete', async function(next) {
  try {
    const doc = await this.model.findOne(this.getQuery());
    if (doc && doc.storageType === 'local' && doc.path) {
      const fs = require('fs').promises;
      try {
        await fs.unlink(doc.path);
      } catch (error) {
        console.error('Physical file removal error:', error);
      }
    }
    next();
  } catch (error) {
    console.error('File pre-findOneAndDelete error:', error);
    next(error);
  }
});

// 스키마 레벨 정적 메소드들
FileSchema.statics.findByS3Key = function(s3Key) {
  return this.findOne({ s3Key: s3Key, status: 'active' });
};

FileSchema.statics.findByUser = function(userId, limit = 50) {
  return this.find({ user: userId, status: 'active' })
             .sort({ uploadDate: -1 })
             .limit(limit);
};

FileSchema.statics.getStorageStats = async function() {
  const stats = await this.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$storageType',
        count: { $sum: 1 },
        totalSize: { $sum: '$size' }
      }
    }
  ]);
  
  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      count: stat.count,
      totalSize: stat.totalSize
    };
    return acc;
  }, {});
};

module.exports = mongoose.model('File', FileSchema);