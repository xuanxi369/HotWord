import { MAX_FILE_BYTES } from './schema';

export async function prepareImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请上传 PNG、JPG 或 WebP 图片。');
  if (file.size > MAX_FILE_BYTES) throw new Error('图片请控制在 10MB 以内。');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('图片分辨率过高，请先裁剪到会场座次图。');
    const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片。');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (png.length < 2_800_000) return png;
    const jpeg = canvas.toDataURL('image/jpeg', 0.88);
    if (jpeg.length > 2_800_000) throw new Error('图片仍然过大，请裁剪无关背景后上传。');
    return jpeg;
  } finally {
    bitmap.close();
  }
}
