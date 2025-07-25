const AWS = require('aws-sdk');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET;

const deleteFileFromS3 = async (s3Key) => {
  if (!S3_BUCKET_NAME) {
    console.warn('S3 bucket name is not configured. Skipping S3 deletion.');
    return { success: false, message: 'S3 bucket not configured.' };
  }

  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: s3Key,
  };

  try {
    await s3.deleteObject(params).promise();
    console.log(`Successfully deleted ${s3Key} from S3.`);
    return { success: true, message: 'File deleted from S3.' };
  } catch (error) {
    console.error(`Error deleting ${s3Key} from S3:`, error);
    return { success: false, message: `Failed to delete file from S3: ${error.message}` };
  }
};

module.exports = {
  deleteFileFromS3,
  s3, // 필요한 경우 S3 인스턴스도 내보낼 수 있습니다.
  S3_BUCKET_NAME
};